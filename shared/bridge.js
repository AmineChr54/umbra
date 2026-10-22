// The page <-> host message bridge for Umbra's own pages (Settings, crashed.html). Widgets get the same code
// inlined in umbra.js, between the BRIDGE markers (tests/sdk/bridge.test.mjs keeps the two identical).
// BRIDGE-START
  // WebView2 (Windows): window.chrome.webview. WebKitGTK (Linux): page -> host through
  // window.webkit.messageHandlers.umbra, host -> page by the host calling window.__umbraReceive(message).
  // Same message objects either way; null when the page runs outside Umbra.
  const umbraBridge = (() => {
    const wv = window.chrome && window.chrome.webview;
    if (wv) return { post: (m) => wv.postMessage(m), listen: (fn) => wv.addEventListener("message", (e) => fn(e.data)) };
    const wk = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.umbra;
    if (!wk) return null;
    const listeners = [];
    if (!("__umbraReceive" in window))
      Object.defineProperty(window, "__umbraReceive", { value: (m) => listeners.forEach((fn) => fn(m)) });
    return { post: (m) => wk.postMessage(m), listen: (fn) => listeners.push(fn) };
  })();
// BRIDGE-END
window.umbraBridge = umbraBridge;
