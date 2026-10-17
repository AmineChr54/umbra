// Umbra widget SDK. Include with:
//   <script src="https://umbra.local/shared/umbra.js"></script>
// It talks to the host app through WebView2's postMessage bridge.
(() => {
  const bridge = window.chrome && window.chrome.webview;
  const post = (msg) => bridge && bridge.postMessage(msg);

  let settings = { refreshSeconds: 60, animations: true, locked: false, scale: 1, editMode: false, options: {} };
  let widget = { id: "", instance: "", name: "" }; // instance = id of this copy ("sp500", "sp500#2")
  const handlers = { settings: [], refresh: [], store: [] };
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

  /** Fetch JSON through the host (bypasses CORS). The host must be listed in widget.json permissions.hosts. */
  const fetchJson = (url) => request({ type: "fetchJson", url }, 25000);

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
  const fetchText = (url) => request({ type: "fetchText", url }, 25000);

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

  /** Run fn now and then every refreshSeconds (re-scheduled when the user changes the interval). */
  function every(fn) {
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { await run(); }, settings.refreshSeconds * 1000);
    };
    const run = async () => {
      try { await fn(); } catch (err) { console.error(err); }
      schedule();
    };
    handlers.refresh.push(run);
    handlers.settings.push(schedule);
    ready.then(run);
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

  // Right-click opens the host's widget menu (Refresh, Options, Lock...). A page that calls preventDefault() on
  // "contextmenu" keeps its own menu; Shift+right-click always reaches the host, so the page never sees that event.
  window.addEventListener("contextmenu", (e) => { if (e.shiftKey) e.stopImmediatePropagation(); }, true);

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

  const formatters = new Map();
  /** 7744.06 -> "7,744.06" */
  function fmt(n, decimals = 2) {
    if (!formatters.has(decimals))
      formatters.set(decimals, new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
    return formatters.get(decimals).format(n);
  }

  window.umbra = {
    ready,
    get settings() { return settings; },
    get options() { return settings.options || {}; },
    get widget() { return widget; },
    onSettings: (fn) => handlers.settings.push(fn),
    fetchJson,
    run,
    system,
    notify,
    media,
    fetchText,
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
