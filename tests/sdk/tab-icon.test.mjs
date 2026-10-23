import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Loads shared/umbra.js against a stub of the WebView2 bridge and records what the page posts to the host.
function load() {
  const posted = [];
  const el = () => ({ dataset: {}, toggleAttribute() {}, append() {}, remove() {}, addEventListener() {} });
  const window = {
    chrome: { webview: { postMessage: (m) => posted.push(m), addEventListener() {} } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    devicePixelRatio: 1,
  };
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    documentElement: el(),
    head: el(),
    getElementById: () => null,
    createElement: () => el(),
    addEventListener() {},
  };
  window.window = window;
  vm.runInNewContext(readFileSync(new URL("../../shared/umbra.js", import.meta.url), "utf8"), {
    window, document, console, setInterval() {}, setTimeout, Intl, Date, Math,
    HTMLElement: class {}, customElements: { get: () => undefined, define() {} },
  });
  return { umbra: window.umbra, posted };
}

// Messages are cloned through JSON: objects built inside the vm context have another Object prototype.
const tabIcons = (posted) => JSON.parse(JSON.stringify(posted)).filter((m) => m.type === "tabIcon");

test("setTabIcon posts the name", () => {
  const { umbra, posted } = load();
  umbra.setTabIcon("chart-line");
  assert.deepEqual(tabIcons(posted), [{ type: "tabIcon", name: "chart-line" }]);
});

test("setTabIcon with null or a non-string clears the suggestion and sends nothing else", () => {
  const { umbra, posted } = load();
  umbra.setTabIcon(null);
  umbra.setTabIcon(undefined);
  umbra.setTabIcon({ toString: () => "rocket" });
  umbra.setTabIcon(42);
  assert.deepEqual(tabIcons(posted).map((m) => m.name), [null, null, null, null]);
});
