import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const block = (src) => src.slice(src.indexOf("// BRIDGE-START"), src.indexOf("// BRIDGE-END"));

/** Runs shared/bridge.js against a fake window and returns that window. */
function load(window) {
  window.window = window;
  vm.runInNewContext(read("shared/bridge.js"), window);
  return window;
}

test("umbra.js inlines exactly the shared bridge", () => {
  assert.equal(block(read("shared/umbra.js")), block(read("shared/bridge.js")));
});

test("WebView2: posts and receives through chrome.webview", () => {
  const sent = [];
  let onMessage;
  const w = load({ chrome: { webview: { postMessage: (m) => sent.push(m), addEventListener: (t, fn) => { assert.equal(t, "message"); onMessage = fn; } } } });
  const got = [];
  w.umbraBridge.listen((m) => got.push(m));
  w.umbraBridge.post({ type: "ready" });
  onMessage({ data: { type: "init" } });
  assert.deepEqual(sent, [{ type: "ready" }]);
  assert.deepEqual(got, [{ type: "init" }]);
  assert.equal("__umbraReceive" in w, false);
});

test("WebKitGTK: posts through messageHandlers.umbra, the host replies via __umbraReceive", () => {
  const sent = [];
  const w = load({ webkit: { messageHandlers: { umbra: { postMessage: (m) => sent.push(m) } } } });
  const got = [];
  w.umbraBridge.listen((m) => got.push(m));
  w.umbraBridge.post({ type: "ready" });
  w.__umbraReceive({ type: "init" });
  assert.deepEqual(sent, [{ type: "ready" }]);
  assert.deepEqual(got, [{ type: "init" }]);
  // The page can't swap the receiver out from under the SDK.
  assert.throws(() => { w.__umbraReceive = () => {}; }, TypeError);
  w.__umbraReceive({ type: "settings" });
  assert.deepEqual(got, [{ type: "init" }, { type: "settings" }]);
});

test("Outside Umbra there is no bridge", () => {
  assert.equal(load({}).umbraBridge, null);
});
