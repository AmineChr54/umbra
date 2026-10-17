// Umbra widget SDK. Include with:
//   <script src="https://umbra.local/shared/umbra.js"></script>
// It talks to the host app through WebView2's postMessage bridge.
(() => {
  const bridge = window.chrome && window.chrome.webview;
  const post = (msg) => bridge && bridge.postMessage(msg);

  let settings = { refreshSeconds: 60, animations: true, locked: false, scale: 1, locale: "en-US", hour12: false, editMode: false, options: {} };
  let widget = { id: "", instance: "", name: "" }; // instance = id of this copy ("sp500", "sp500#2")
  const handlers = { settings: [], refresh: [], store: [], status: [] };
  const pending = new Map();
  let nextId = 1;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function applyMotion() {
    document.documentElement.dataset.motion = settings.animations && !reducedMotion.matches ? "on" : "off";
  }
  reducedMotion.addEventListener("change", applyMotion);

  // The active theme arrives as one generated ":root{--token:value;...}" rule from the host. It is applied after
  // umbra.css, so every widget picks it up without changes. Anything that isn't plain tokens is ignored.
  const THEME_CSS = /^:root\{(?:--[a-z0-9-]+:[#a-z0-9.,%() \/-]+;)+\}$/i;
  function applyTheme() {
    const css = settings.themeCss && THEME_CSS.test(settings.themeCss) ? settings.themeCss : "";
    let el = document.getElementById("umbra-theme");
    if (!css) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = "umbra-theme"; document.head.append(el); }
    if (el.textContent !== css) el.textContent = css;
  }

  // Appearance options from Settings (corner radius, calm motion) arrive as one more :root rule, applied after the theme.
  function applyAppearance() {
    const css = settings.appearanceCss && THEME_CSS.test(settings.appearanceCss) ? settings.appearanceCss : "";
    let el = document.getElementById("umbra-appearance");
    if (!css) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = "umbra-appearance"; document.head.append(el); }
    if (el.textContent !== css) el.textContent = css;
  }

  bridge && bridge.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "init":
        widget = m.widget;
        settings = m.settings;
        applyMotion();
        applyEdit();
        applyTheme(); applyAppearance();
        resolveReady();
        break;
      case "settings":
        settings = m.settings;
        applyMotion();
        applyEdit();
        applyTheme(); applyAppearance();
        updateStatus(); // the stale threshold follows the refresh interval
        handlers.settings.forEach((fn) => fn(settings));
        break;
      case "editScale": // live scale while the corner handle is dragged; keeps the overlay's outline size steady
        if (overlay && typeof m.scale === "number" && m.scale > 0) overlay.style.setProperty("--k", String(1 / m.scale));
        break;
      case "refresh":
        handlers.refresh.forEach((fn) => fn());
        break;
      case "fetchResult":
      case "runResult":
      case "systemResult":
      case "notifyResult":
      case "mediaResult":
      case "storeResult": {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || "Request failed"));
        break;
      }
      case "storeChanged":
        handlers.store.forEach((fn) => fn(m.key ?? null));
        break;
    }
  });

  /** Send a request to the host and resolve with its reply's data. */
  function request(msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      post({ ...msg, id });
    });
  }

  // Data freshness. Every fetchJson/fetchText outcome is tracked, so a widget that fetches gets a shared
  // "Updated 3 min ago" / "Offline" state for free; ok() and failed(err) override it for data that arrives another way.
  // States: none (nothing fetched yet), live, stale (data older than 3x the refresh interval), offline (2+ failures in a
  // row, or a failure with nothing loaded since the widget started). <html data-stale> is set for stale and offline.
  const STALE_AFTER = 3;  // x refreshSeconds
  let lastData = null;    // when the data on screen was fetched (restored data counts, see ok(at))
  let sessionOk = false;  // a fetch succeeded since the widget started
  let failures = 0;       // consecutive failures
  let lastError = null;
  let statusState = "none";
  let statusTimer = 0;
  const statusEls = new Set();

  const clock = (d) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: !!settings.hour12 });
  function ago(d) {
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    return m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
  }
  function computeStatus() {
    if (!lastData && !failures) return "none";
    if (failures >= 2 || (failures >= 1 && !sessionOk)) return "offline";
    if (lastData && Date.now() - lastData.getTime() > STALE_AFTER * (settings.refreshSeconds || 60) * 1000) return "stale";
    return "live";
  }
  function paintStatus(el) {
    el.dataset.state = statusState;
    const text = statusState === "offline" ? (lastData ? `Offline · last data ${clock(lastData)}` : "Offline")
      : lastData ? `Updated ${ago(lastData)}` : "";
    const label = el.lastElementChild;
    if (label && label.textContent !== text) label.textContent = text;
  }
  function updateStatus() {
    const next = computeStatus();
    const changed = next !== statusState;
    statusState = next;
    document.documentElement.toggleAttribute("data-stale", next === "stale" || next === "offline");
    statusEls.forEach(paintStatus);
    if (changed) handlers.status.forEach((fn) => fn(next));
  }
  function markStatus() {
    if (!statusTimer) statusTimer = setInterval(updateStatus, 30000); // ages the label, flips live to stale
    updateStatus();
  }
  const status = {
    /** Data arrived (fetchJson/fetchText call this). Pass a Date only to show data restored from umbra.store as "last data". */
    ok(at) {
      if (at instanceof Date && !isNaN(at)) {
        if (!lastData || at > lastData) lastData = at;
      } else {
        lastData = new Date(); sessionOk = true; failures = 0; lastError = null;
      }
      markStatus();
    },
    /** Loading failed: the request, or a response you couldn't use. The Error fetchJson rejected with is only counted once. */
    failed(err) {
      if (err != null && err === lastError) return;
      lastError = err ?? new Error("Failed");
      failures++;
      markStatus();
    },
    /** "none" | "live" | "stale" | "offline" */
    get state() { return statusState; },
    /** When the data on screen was fetched, or null. */
    get lastOk() { return lastData; },
    /** Failures in a row since the last success. */
    get failures() { return failures; },
    /** fn(state) runs whenever the state changes. */
    onChange: (fn) => handlers.status.push(fn),
  };

  /** <umbra-status>: a small dot. Hover for "Updated 3 min ago"; "Offline, last data 10:42" stays visible when offline. Styled in umbra.css. */
  class UmbraStatus extends HTMLElement {
    connectedCallback() {
      if (!this.firstElementChild) this.innerHTML = '<i aria-hidden="true"></i><span></span>';
      if (!this._hover) { this._hover = () => paintStatus(this); this.addEventListener("pointerenter", this._hover); }
      statusEls.add(this);
      paintStatus(this);
    }
    disconnectedCallback() { statusEls.delete(this); }
  }
  if (!customElements.get("umbra-status")) customElements.define("umbra-status", UmbraStatus);

  const tracked = (p) => p.then((v) => { status.ok(); return v; }, (e) => { status.failed(e); throw e; });

  /** Fetch JSON through the host (bypasses CORS). The host must be listed in widget.json permissions.hosts. */
  const fetchJson = (url) => tracked(request({ type: "fetchJson", url }, 25000));

  /**
   * Run one of the commands declared in widget.json permissions.commands. Only the id and string params are sent;
   * the host owns the program and arguments, asks the user to approve the first run, and caps time and output.
   * Resolves { exitCode, stdout, stderr, timedOut, truncated, durationMs }; rejects when not declared, not approved, or invalid.
   */
  const run = (command, params) => request({ type: "run", command, params: params ?? undefined }, 300000);
  /** Machine totals declared in widget.json permissions.system: { cpu:{percent}, memory:{totalBytes,usedBytes,percent}, network:{downBytesPerSec,upBytesPerSec} }. */
  const system = () => request({ type: "system" }, 10000);
  /** Windows notification from this widget. Needs permissions.notifications and the user's per-widget switch; 5 per 10 minutes. Clicking opens url (http/https). */
  const notify = ({ title, body, url }) => request({ type: "notify", title, body, url }, 10000);
  /** Windows media session. nowPlaying() needs permissions.media "read": { title, artist, album, app, status, playing, canPlay, canPause, canNext, canPrevious, art? (data URL) } or null. */
  const media = {
    nowPlaying: () => request({ type: "media", action: "get" }, 10000),
    /** command: play | pause | toggle | next | previous. Needs "control" and a click on the widget just before. */
    control: (command) => request({ type: "media", action: "control", command }, 10000),
  };
  /** Fetch plain text (up to 2 MB, e.g. Markdown or CSV) through the host, same rules as fetchJson. */
  const fetchText = (url) => tracked(request({ type: "fetchText", url }, 25000));

  /** This widget's own saved data (any JSON per key), kept by the host across restarts. */
  const store = {
    async get(key, fallback) {
      const r = await request({ type: "store", op: "get", key }, 5000);
      return r.found ? r.value : fallback;
    },
    set: (key, value) => request({ type: "store", op: "set", key, value: value === undefined ? null : value }, 5000),
    remove: (key) => request({ type: "store", op: "remove", key }, 5000),
    keys: () => request({ type: "store", op: "keys" }, 5000),
    /** fn(key) runs when the data was changed from outside the widget (umbractl data, MCP); key is null for "everything". */
    onChange: (fn) => handlers.store.push(fn),
  };

  /**
   * Run fn now and then every refreshSeconds (re-scheduled when the user changes the interval).
   * While the PC is locked or the display is off (settings.paused) nothing runs; fn runs once when it resumes.
   */
  function every(fn) {
    let timer;
    let wasPaused = false;
    const schedule = () => {
      clearTimeout(timer);
      if (settings.paused) return;
      timer = setTimeout(async () => { await run(); }, settings.refreshSeconds * 1000);
    };
    const run = async () => {
      if (settings.paused) return;
      try { await fn(); } catch (err) { console.error(err); }
      schedule();
    };
    handlers.refresh.push(run);
    handlers.settings.push(() => {
      const resumed = wasPaused && !settings.paused;
      wasPaused = !!settings.paused;
      if (resumed) run(); // one refresh on resume, then the normal interval
      else schedule();
    });
    ready.then(() => { wasPaused = !!settings.paused; run(); });
  }

  // Drag anywhere to move the widget: once the pointer travels a few pixels with the
  // button held, the host starts a native window move. A plain click stays a click.
  // Text fields need the keyboard, which widgets only get right after the user presses the mouse
  // on them (the host checks the physical button state). Editable elements never start a drag.
  const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  let down = null;
  window.addEventListener("pointerdown", (e) => {
    if (grip && e.composedPath().includes(grip)) {
      // Edit-mode corner handle: the host runs a native resize (aspect ratio kept) and zooms the page to match.
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) post({ type: "resize" });
      return;
    }
    const editable = e.target.closest(EDITABLE);
    post({ type: editable ? "focus" : "pointer" });
    if (e.button !== 0 || editable || e.target.closest("[data-no-drag]")) return;
    down = { x: e.screenX, y: e.screenY };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!down || !(e.buttons & 1) || settings.locked) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down = null;
      post({ type: "drag" });
    }
  });
  window.addEventListener("pointerup", () => (down = null), true);

  // Edit mode (app-wide, switched from the tray or Settings): an unlocked widget gets an outline and a corner
  // handle. The overlay covers the page, so mouse presses anywhere move the widget and its own controls don't
  // react to them (capture-phase listeners and keyboard events can still reach the page).
  // Ctrl+wheel zooms in 10 % steps. The host checks edit mode, the lock and the physical mouse/keyboard state.
  let overlay = null;
  let grip = null;
  const editing = () => !!(settings.editMode && !settings.locked);
  function applyEdit() {
    if (!editing()) {
      if (overlay) overlay.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement("umbra-edit");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:block;cursor:move;";
      const root = overlay.attachShadow({ mode: "open" });
      // Sizes are multiplied by --k = 1 / scale, so the outline and handle look the same at any zoom.
      root.innerHTML = `<style>
        .frame { position: absolute; inset: 0; pointer-events: none; border-radius: calc(8px * var(--k));
                 background: rgba(139, 147, 255, 0.05); box-shadow: inset 0 0 0 calc(1.5px * var(--k)) rgba(139, 147, 255, 0.75); }
        .grip { position: absolute; right: 0; bottom: 0; width: calc(24px * var(--k)); height: calc(24px * var(--k)); cursor: nwse-resize; }
        .grip svg { position: absolute; right: calc(5px * var(--k)); bottom: calc(5px * var(--k)); width: calc(11px * var(--k)); height: calc(11px * var(--k)); }
        /* Windows contrast themes drop box-shadows and backgrounds, so draw the frame as a real border. */
        @media (forced-colors: active) {
          .frame { background: none; box-shadow: none; border: calc(2px * var(--k)) solid Highlight; }
          .grip { background: Highlight; }
          .grip svg { stroke: HighlightText; }
        }
      </style><div class="frame"></div><div class="grip" title="Drag to resize"><svg viewBox="0 0 11 11" fill="none"
        stroke="#aab0ff" stroke-width="1.6" stroke-linecap="round"><path d="M10 2 2 10M10 6.5 6.5 10"/></svg></div>`;
      grip = root.querySelector(".grip");
      // Clicks on the overlay are Umbra's, not the widget's.
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"])
        overlay.addEventListener(type, (e) => e.stopPropagation());
    }
    overlay.style.setProperty("--k", String(1 / (settings.scale || 1)));
    if (!overlay.isConnected) document.documentElement.append(overlay);
  }

  let wheelSum = 0;
  let wheelTimer;
  window.addEventListener("wheel", (e) => {
    if (!editing() || !e.ctrlKey) return;
    e.preventDefault();
    wheelSum += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => (wheelSum = 0), 250);
    // At most one step per event, and about half a mouse-wheel notch per step so touchpads don't race through
    // the sizes. Chromium may report deltas divided by the display scale and zoom, hence devicePixelRatio.
    if (Math.abs(wheelSum) >= 50 / (window.devicePixelRatio || 1)) {
      post({ type: "zoom", steps: wheelSum < 0 ? 1 : -1 });
      wheelSum = 0;
    }
  }, { passive: false, capture: true });

  /** Animate a number from a to b with ease-out-cubic: f(t) = 1 - (1 - t)^3. */
  function tween(from, to, ms, onFrame) {
    // requestAnimationFrame doesn't run while the window is covered, so jump straight to the value.
    if (document.documentElement.dataset.motion === "off" || document.visibilityState !== "visible" || !isFinite(from) || from === to) {
      onFrame(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      onFrame(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The Windows region format (Settings > Region), sent by the host as a BCP-47 tag. A tag Intl rejects falls back to en-US.
  function locale() {
    const tag = settings.locale;
    if (typeof tag === "string" && tag) {
      try { return Intl.getCanonicalLocales(tag)[0]; } catch { /* fall through */ }
    }
    return "en-US";
  }

  const formatters = new Map();
  /** 7744.06 -> "7,744.06" (or "7.744,06" etc. in the user's Windows region) */
  function fmt(n, decimals = 2) {
    const key = locale() + "|" + decimals;
    if (!formatters.has(key))
      formatters.set(key, new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
    return formatters.get(key).format(n);
  }

  window.umbra = {
    ready,
    get settings() { return settings; },
    get options() { return settings.options || {}; },
    get widget() { return widget; },
    /** The user's Windows region format as a BCP-47 tag, e.g. "de-DE". Pass it to Intl or toLocale*String. */
    get locale() { return locale(); },
    /** True when Windows (Region > Time format) uses a 12-hour clock. Pass it as `hour12` to Intl.DateTimeFormat. */
    get hour12() { return !!settings.hour12; },
    onSettings: (fn) => handlers.settings.push(fn),
    fetchJson,
    run,
    system,
    notify,
    media,
    fetchText,
    status,
    store,
    every,
    openUrl: (url) => post({ type: "openUrl", url }),
    /** Ask for keyboard focus, e.g. before focusing an input from a double-click. Only works right after a click on the widget. */
    requestFocus: () => post({ type: "focus" }),
    /** Call after the first real frame is drawn; screenshots (umbractl capture) wait for it. */
    rendered: () => post({ type: "rendered" }),
    tween,
    fmt,
  };

  applyMotion();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => post({ type: "ready" }));
  else post({ type: "ready" });
})();
