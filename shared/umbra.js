// Umbra widget SDK. Include with:
//   <script src="https://umbra.local/shared/umbra.js"></script>
// It talks to the host app through WebView2's postMessage bridge.
(() => {
  const bridge = window.chrome && window.chrome.webview;
  const post = (msg) => bridge && bridge.postMessage(msg);

  let settings = { refreshSeconds: 60, animations: true, locked: false, options: {} };
  let widget = { id: "", name: "" };
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

  bridge && bridge.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "init":
        widget = m.widget;
        settings = m.settings;
        applyMotion();
        resolveReady();
        break;
      case "settings":
        settings = m.settings;
        applyMotion();
        handlers.settings.forEach((fn) => fn(settings));
        break;
      case "refresh":
        handlers.refresh.forEach((fn) => fn());
        break;
      case "fetchResult":
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
  window.addEventListener("pointerup", () => (down = null));

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
