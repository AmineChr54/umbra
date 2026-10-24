// Umbra Settings panel. All state lives in the host; this page renders it and posts changes back.
const bridge = window.chrome && window.chrome.webview;
const post = (msg) => bridge && bridge.postMessage(msg);
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Line icons (24x24, stroke). Rendered into every [data-icon] element.
const ICONS = {
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 2.8 5.6 3.1 5.6 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.2 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/>',
  bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-8M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2M9.5 4.5 11 6M14.5 4.5 13 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.75-1.4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 3 19.5h18zM12 10v4.5M12 17.2h.01"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 10.5h.01M11 10.5h.01M15 10.5h.01M17.5 10.5h.01M8 14h8"/>',
  palette: '<path d="M12 4a8 8 0 1 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.5-1-2.6 0-.9.7-1.7 1.7-1.7H16a4 4 0 0 0 4-4C20 6.7 16.4 4 12 4z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.6" r="1"/><circle cx="15.2" cy="8.4" r="1"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>',
};
function icons(root = document) {
  for (const el of $$("[data-icon]", root)) {
    const name = el.dataset.icon;
    if (!ICONS[name] || el.firstChild) continue;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  }
}

let state = null;      // { version, startup, repo, settings, widgets[] }
let catalog = null;    // [{ id, name, ..., installed, updateAvailable }]
let catalogError = null;
let themes = null;     // [{ id, name, tokens, installed, builtin, updateAvailable }]
let themesError = null;
const busy = new Map(); // id -> "install" | "remove"
let catalogLoading = false;
let browseFilter = "all"; // all | installed | updates
let updatingAll = null;   // { ids, index, total } while "Update all" runs

// ---------- navigation ----------
function show(page) {
  $$(".nav button").forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle("active", on);
    on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  });
  $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === page));
  $("#content").scrollTop = 0;
  if (page === "browse" && !catalog && !catalogLoading) loadCatalog();
  if (page === "themes" && !themes) loadThemes();
  if (page === "privacy") post({ type: "privacy" });
  post({ type: "page", page }); // the host remembers the last page for the next open
}
$$(".nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));

// ---------- toast ----------
let toastTimer;
// With an action ({ label, run }) the toast stays longer and shows a button (Undo).
function toast(text, error = false, action = null) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("error", error);
  t.classList.toggle("has-action", !!action);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => { t.classList.remove("show"); action.run(); });
    t.append(b);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), action ? 8000 : error ? 4200 : 1600);
}

// ---------- saving (debounced, so typing in a field doesn't save every keystroke) ----------
let saveTimer = null;
function save(immediate = false) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const send = () => { saveTimer = null; post({ type: "save", settings: state.settings }); toast("Saved"); };
  immediate ? send() : (saveTimer = setTimeout(send, 450));
}
// A debounced save still waiting for its timer (sent right away before the window closes).
function flushSave() { if (saveTimer) save(true); }

// ---------- links ----------
function openLink(key) {
  const repo = (state && state.repo) || "https://github.com/AmineChr54/umbra";
  const urls = { repo, issues: `${repo}/issues`, contribute: `${repo}/blob/main/CONTRIBUTING.md` };
  post({ type: "openUrl", url: urls[key] || key });
}
$("#reportIssue").addEventListener("click", () => post({ type: "reportIssue" }));
$("#copyDiagnostics").addEventListener("click", () => post({ type: "copyDiagnostics" }));
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-url]");
  if (b) openLink(b.dataset.url);
});

// ---------- General ----------
function renderGeneral() {
  const g = state.settings.general;
  window.prefsRender && prefsRender();
  $("#startup").checked = state.startup;
  $("#startup").disabled = !!state.portable;
  $("#startupSub").textContent = state.portable ? "Not available in portable mode." : "Your widgets appear on the desktop when you sign in.";
  $("#animations").checked = g.animations;
  $("#checkUpdates").checked = g.checkForUpdates !== false;
  $("#slowEnergySaver").checked = g.slowOnEnergySaver !== false;
  $("#hideFullscreen").checked = !!g.hideOnFullscreen;
  if (document.activeElement !== $("#peekSeconds")) $("#peekSeconds").value = g.peekSeconds || 5;
  $("#hideFullscreen").addEventListener("change", (e) => { state.settings.general.hideOnFullscreen = e.target.checked; save(true); });
$("#peekSeconds").addEventListener("change", (e) => {
  const v = Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 5)));
  e.target.value = v;
  state.settings.general.peekSeconds = v;
  save(true);
});
syncInterval(g.refreshSeconds);
  labelRows();
}
// Segmented control = radio group: the selected button is the one tab stop, arrows move and select.
function syncInterval(seconds) {
  const buttons = $$("#interval button");
  const on = buttons.find((b) => Number(b.dataset.v) === seconds);
  for (const b of buttons) {
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", b === on ? "true" : "false");
    b.tabIndex = b === on || (!on && b === buttons[0]) ? 0 : -1;
    b.classList.toggle("on", b === on);
  }
}
$("#startup").addEventListener("change", (e) => {
  post({ type: "setStartup", value: e.target.checked });
  toast(e.target.checked ? "Umbra will start with Windows" : "Umbra won't start with Windows");
});
$("#animations").addEventListener("change", (e) => { state.settings.general.animations = e.target.checked; save(true); });
$("#checkUpdates").addEventListener("change", (e) => { state.settings.general.checkForUpdates = e.target.checked; save(true); });
$("#slowEnergySaver").addEventListener("change", (e) => { state.settings.general.slowOnEnergySaver = e.target.checked; save(true); });
$$("#interval button").forEach((b) =>
  b.addEventListener("click", () => {
    state.settings.general.refreshSeconds = Number(b.dataset.v);
    renderGeneral();
    save(true);
  })
);

// Names for controls whose text lives in the row beside them, so a screen reader says "Start with Windows, switch, on"
// instead of an unnamed check box. Idempotent: runs after every render that can add rows.
let rowIds = 0;
function labelRows(root = document) {
  for (const row of $$(".row", root)) {
    const title = $(".row-title", row);
    if (!title) continue;
    const sub = $(".row-sub", row);
    for (const el of [title, sub]) if (el && !el.id) el.id = `row-t${++rowIds}`;
    for (const input of $$(".switch input", row)) {
      input.setAttribute("role", "switch");
      if (!input.hasAttribute("aria-label")) input.setAttribute("aria-labelledby", title.id);
      if (sub) input.setAttribute("aria-describedby", sub.id);
    }
    for (const group of $$(".segmented", row)) group.setAttribute("aria-labelledby", title.id);
  }
}

// Arrow keys move through a list of buttons (sidebar, segmented control). `pick` also selects the one reached.
function arrowNav(container, pick) {
  container.addEventListener("keydown", (e) => {
    const items = $$("button", container).filter((b) => !b.disabled);
    const i = items.indexOf(document.activeElement);
    if (i < 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length];
    target.focus();
    if (pick) target.click();
  });
}
arrowNav($("#nav"), false);
arrowNav($("#interval"), true);

// ---------- Updates (About) ----------
function renderUpdate() {
  const u = state.update || {};
  const a = u.available;
  $("#updateText").textContent = typeof u.error === "string" && u.error.startsWith("The update to") ? u.error
    : a && u.progress != null ? `Downloading Umbra v${a.version}: ${u.progress} %`
    : a && u.ready ? `Umbra v${a.version} is ready. Restart to update.`
    : a && u.error ? u.error
    : a ? `Umbra v${a.version} is available.`
    : u.error ? "Couldn't check for updates right now."
    : u.lastChecked ? "You're up to date."
    : u.enabled === false ? "Update checks are turned off in General." : "Checking for updates...";
  $("#update").classList.toggle("has-update", !!a);
  $("#updateInstall").hidden = !a;
  $("#updateInstall").lastChild.textContent = u.portable ? "Download" : u.ready ? "Restart to update" : "Update now";
  $("#aboutPortable").hidden = !state.portable;
  $("#aboutPortable").textContent = state.portable ? `Portable mode - data in ${state.dataDir}` : "";
  // Disabled from the click until Umbra quits (or the install fails), also while the download reports progress.
  const busy = !!(u.installing || u.progress != null);
  $("#updateInstall").disabled = busy;
  $("#updateCheck").disabled = busy;
  if (u.installing && a) $("#updateText").textContent = u.ready ? "Restarting Umbra to update..." : "Downloading the update. Umbra will restart when it's done...";
  $$(".nav button[data-page=about]").forEach((b) => b.classList.toggle("dot", !!a));
  renderWhatsNew();
}

// Release notes are untrusted text from GitHub: build DOM nodes with textContent only, never innerHTML. Only https
// links become clickable, and the host opens them in the browser.
const NOTE_LINK = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)|(https:\/\/[^\s<>()\[\]]{1,500})/g;
function noteInline(parent, text) {
  text = text.replace(/\*\*|__|`/g, "");
  let last = 0, m;
  NOTE_LINK.lastIndex = 0;
  while ((m = NOTE_LINK.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const url = m[2] || m[3].replace(/[.,;:!?]+$/, "");
    const a = document.createElement("a");
    a.textContent = m[1] || url;
    a.dataset.href = url;
    a.tabIndex = 0;
    a.setAttribute("role", "link");
    parent.append(a);
    last = m.index + (m[2] ? m[0].length : url.length);
    NOTE_LINK.lastIndex = last;
  }
  if (last < text.length) parent.append(text.slice(last));
}
function renderNotes(host, notes) {
  host.replaceChildren();
  let list = null;
  for (const raw of String(notes || "").replace(/<[^>]*>/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) host.append((list = document.createElement("ul")));
      noteInline(list.appendChild(document.createElement("li")), bullet[1]);
      continue;
    }
    list = null;
    if (!line) continue;
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    const el = document.createElement(head ? "h4" : "p");
    noteInline(el, head ? head[1] : line);
    host.append(el);
  }
}
function renderWhatsNew() {
  const w = state.update && state.update.whatsNew;
  $("#whatsNew").hidden = !w;
  if (!w) return;
  $("#whatsNewTitle").textContent = `What's new in Umbra ${w.version}`;
  const body = $("#whatsNewBody");
  if (body.dataset.src !== w.notes) { body.dataset.src = w.notes; renderNotes(body, w.notes); } // not on every state push: keeps the scroll position
  $("#whatsNewBody").hidden = !w.notes;
  $("#whatsNewFull").dataset.href = w.url;
}
$("#whatsNew").addEventListener("click", (e) => {
  const t = e.target.closest("[data-href]");
  if (t) post({ type: "openUrl", url: t.dataset.href });
});
$("#whatsNew").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.href) post({ type: "openUrl", url: e.target.dataset.href });
});
$("#updateCheck").addEventListener("click", () => { $("#updateCheck").disabled = true; $("#updateText").textContent = "Checking..."; post({ type: "checkUpdate" }); });
$("#updateInstall").addEventListener("click", () => {
  if (state.update && state.update.portable) { post({ type: "openUrl", url: state.update.available.url }); return; }
  $("#updateInstall").disabled = true;
  $("#updateText").textContent = state.update && state.update.ready ? "Restarting Umbra..." : "Downloading the update. Umbra will restart when it's done...";
  post({ type: "installUpdate" });
});

// ---------- Hotkeys ----------
const MODKEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);
let recording = null;
function comboFromEvent(e) {
  const k = e.key;
  const main = k.length === 1 ? (k === " " ? "Space" : k.toUpperCase())
    : /^Fd{1,2}$/.test(k) ? k : { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", " ": "Space" }[k] || k;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win", main].filter(Boolean).join("+");
}
function renderHotkeys() {
  const list = $("#hotkeyList");
  // The list is rebuilt after each change; put keyboard focus back on the same shortcut.
  const refocus = list.contains(document.activeElement) ? document.activeElement.dataset.action : null;
  list.replaceChildren();
  for (const h of state.hotkeys || []) {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = h.label;
    text.append(title);
    if (h.error) {
      const sub = document.createElement("div");
      sub.className = "row-sub";
      sub.style.color = "#ff6b6b";
      sub.textContent = "Not active: " + h.error;
      text.append(sub);
    }
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.dataset.action = h.action;
    btn.textContent = recording === h.action ? "Press keys..." : h.keys || "Off";
    btn.setAttribute("aria-label", recording === h.action ? `${h.label}: press the new shortcut. Escape cancels, Backspace turns it off.`
      : `${h.label}: ${h.keys || "off"}. Press Enter to change.`);
    btn.addEventListener("click", () => { recording = h.action; renderHotkeys(); btn.focus(); });
    btn.addEventListener("blur", () => { if (recording === h.action) { recording = null; renderHotkeys(); } });
    btn.addEventListener("keydown", (e) => {
      if (recording !== h.action) return;
      e.preventDefault();
      if (MODKEYS.has(e.key)) return;
      recording = null;
      if (e.key === "Escape") return renderHotkeys();
      post({ type: "setHotkey", action: h.action, keys: e.key === "Backspace" && !(e.ctrlKey || e.altKey || e.metaKey) ? "" : comboFromEvent(e) });
    });
    row.append(text, btn);
    list.append(row);
    if (refocus === h.action) btn.focus();
  }
}
$("#hotkeyReset").addEventListener("click", () => post({ type: "resetHotkeys" }));

// ---------- My widgets ----------
function field(wid, key, spec, value) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const id = `f-${wid}-${key}`;
  const label = Object.assign(document.createElement("label"), { htmlFor: id, textContent: spec.label || key });
  wrap.append(label);

  const set = (v) => { state.settings.widgets[wid].options[key] = v; save(); };
  let input;
  if (spec.type === "select") {
    input = Object.assign(document.createElement("select"), { className: "select", id });
    for (const c of spec.choices || []) input.append(new Option(c.label, c.value, false, c.value === value));
    input.addEventListener("change", () => set(input.value));
  } else if (spec.type === "toggle") {
    input = document.createElement("label");
    input.className = "switch";
    input.innerHTML = `<input type="checkbox" id="${id}"><span></span>`;
    $("input", input).setAttribute("role", "switch");
    $("input", input).checked = !!value;
    $("input", input).addEventListener("change", (e) => set(e.target.checked));
  } else {
    input = Object.assign(document.createElement("input"), {
      className: "input", id, type: spec.type === "number" ? "number" : "text", value: value ?? "", spellcheck: false,
    });
    for (const k of ["min", "max", "step"]) if (spec.type === "number" && spec[k] !== undefined) input[k] = spec[k];
    input.addEventListener("input", () => set(spec.type === "number" ? Number(input.value) : input.value));
  }
  wrap.append(input);
  if (spec.hint) wrap.append(Object.assign(document.createElement("div"), { className: "hint-text", textContent: spec.hint }));
  return wrap;
}

// A collapsed section for options with the same `group` (or `advanced: true`). <details> gives keyboard
// folding for free; which sections are open is remembered per widget copy in this browser profile.
function optionSection(wid, name, els) {
  const key = `${wid}\n${name}`;
  let open = [];
  try { open = JSON.parse(localStorage.getItem("openOptionSections") || "[]"); } catch { /* ignore */ }
  const box = Object.assign(document.createElement("details"), { className: "optsection", open: open.includes(key) });
  const summary = Object.assign(document.createElement("summary"), { textContent: name });
  summary.prepend(Object.assign(document.createElement("span"), { className: "ico" }));
  summary.firstChild.dataset.icon = "chevron";
  const body = Object.assign(document.createElement("div"), { className: "optsection-body" });
  body.append(...els);
  box.append(summary, body);
  box.addEventListener("toggle", () => {
    try {
      const set = new Set(JSON.parse(localStorage.getItem("openOptionSections") || "[]"));
      if (box.open) set.add(key); else set.delete(key);
      localStorage.setItem("openOptionSections", JSON.stringify([...set]));
    } catch { /* storage unavailable */ }
  });
  return box;
}

function thumb(el, w) {
  if (w.preview) el.style.backgroundImage = `url("${w.preview}")`;
  else { el.classList.add("fallback"); el.textContent = (w.name || "?").trim()[0]; }
}

function renderInstalled() {
  const list = $("#installed");
  list.textContent = "";
  $("#count").textContent = state.widgets.length || "";
  if (!state.widgets.length) {
    list.innerHTML = '<div class="empty">No widgets yet.<br><br><button class="btn primary" id="goBrowse">Browse widgets</button></div>';
    $("#goBrowse").addEventListener("click", () => show("browse"));
    return;
  }
  for (const w of state.widgets) {
    const ws = state.settings.widgets[w.id];
    const card = $("#tpl-installed").content.firstElementChild.cloneNode(true);
    thumb($(".thumb", card), w);
    $(".wname", card).textContent = w.name; // "Name (2)" for extra copies
    const badge = $(".badge", card);
    badge.textContent = w.source === "builtin" ? "Built-in" : w.private ? "Private" : "Community";
    badge.classList.add(w.private && w.source !== "builtin" ? "private" : w.source);
    $(".wmeta", card).textContent = [w.author && `by ${w.author}`, `v${w.version}`].filter(Boolean).join("  ·  ");
    $(".wdesc", card).textContent = w.description;

    // Look the settings up on each change: the host may have sent a newer state (a zoom on the desktop)
    // while this list wasn't rebuilt, and writing to the old `ws` would be lost.
    const cur = () => state.settings.widgets[w.id];
    card.setAttribute("aria-label", w.name);
    const enabled = $(".enabled", card);
    enabled.setAttribute("role", "switch");
    enabled.setAttribute("aria-label", `${w.name} enabled`);
    enabled.checked = ws.enabled;
    card.classList.toggle("off", !ws.enabled);
    enabled.addEventListener("change", () => {
      cur().enabled = enabled.checked;
      card.classList.toggle("off", !enabled.checked);
      save(true);
    });

    // Tab group: widgets in one group share a spot and show one at a time.
    {
      const here = (state.groups || []).find((g) => g.members.includes(w.id));
      const sel = document.createElement("select");
      sel.className = "select";
      sel.setAttribute("aria-label", `${w.name} tab group`);
      sel.append(new Option("No group", ""));
      for (const g of state.groups || []) sel.append(new Option(g.name, "g:" + g.id));
      sel.append(new Option("New group…", "new"));
      sel.value = here ? "g:" + here.id : "";
      sel.addEventListener("change", () => {
        if (sel.value === "") post({ type: "group", op: "leave", id: w.id });
        else if (sel.value === "new") post({ type: "group", op: "create", name: w.name, id: w.id });
        else post({ type: "group", op: "join", group: sel.value.slice(2), id: w.id });
      });
      const row = document.createElement("label");
      row.className = "grouprow";
      row.append(Object.assign(document.createElement("span"), { textContent: "Tab group" }), sel);
      $(".fields", card).before(row);
    }

    // Fold/unfold the options. Remembered per widget in this browser profile.
    const fold = $(".fold", card);
    const setFolded = (folded, remember) => {
      card.classList.toggle("folded", folded);
      fold.setAttribute("aria-expanded", String(!folded));
      fold.setAttribute("aria-label", `${folded ? "Show" : "Hide"} ${w.name} options`);
      if (!remember) return;
      try {
        const set = new Set(JSON.parse(localStorage.getItem("foldedCards") || "[]"));
        if (folded) set.add(w.id); else set.delete(w.id);
        localStorage.setItem("foldedCards", JSON.stringify([...set]));
      } catch { /* storage unavailable */ }
    };
    let wasFolded = false;
    try { wasFolded = JSON.parse(localStorage.getItem("foldedCards") || "[]").includes(w.id); } catch { /* ignore */ }
    setFolded(wasFolded, false);
    fold.addEventListener("click", () => setFolded(!card.classList.contains("folded"), true));

    renderCommands($(".cmds", card), w);
    window.prefsCard && prefsCard(card, w);

    const fields = $(".fields", card);
    const order = w.optionOrder && w.optionOrder.length ? w.optionOrder : Object.keys(w.options || {});
    const sections = new Map(); // `group` (or "Advanced") -> its fields, in order of first appearance
    for (const key of order) {
      const spec = w.options[key];
      if (!spec) continue;
      const el = field(w.id, key, spec, ws.options[key]);
      const name = typeof spec.group === "string" && spec.group.trim() ? spec.group.trim() : spec.advanced === true ? "Advanced" : null;
      if (!name) { fields.append(el); continue; }
      if (!sections.has(name)) sections.set(name, []);
      sections.get(name).push(el);
    }
    for (const [name, els] of sections) fields.append(optionSection(w.id, name, els));

    // Size: 50-300 %.
    const scale = $(".scale", card);
    const scaleVal = $(".size-val", card);
    const showScale = (pct) => {
      scaleVal.textContent = `${Math.round(pct)}%`;
      scale.setAttribute("aria-valuetext", `${Math.round(pct)}%`);
      scale.style.setProperty("--p", `${((pct - 50) / 250) * 100}%`);
    };
    // The slider sets a proportional size, so it replaces a free width/height dragged by hand.
    const setScale = (pct) => { cur().scale = pct / 100; cur().useDefaultScale = false; cur().width = cur().height = null; scale.value = pct; showScale(pct); save(true); };
    scale.setAttribute("aria-label", `${w.name} size`);
    scaleVal.setAttribute("aria-label", `Reset ${w.name} size to the default`);
    scale.value = Math.round((ws.scale || 1) * 100);
    showScale((ws.scale || 1) * 100);
    scale.addEventListener("input", () => showScale(Number(scale.value)));
    scale.addEventListener("change", () => setScale(Number(scale.value)));
    // Let go of focus after a mouse drag so later updates from the desktop can re-render this list.
    scale.addEventListener("pointerup", () => setTimeout(() => scale.blur()));
    scaleVal.addEventListener("click", () => { // back to the default size (General)
      const d = Math.round((state.settings.general.defaultScale || 1) * 100);
      setScale(d); cur().useDefaultScale = true; scaleVal.blur();
    });

    const notif = $(".notif", card);
    notif.parentElement.hidden = true; // the tri-state default/allowed/blocked select in prefs.js replaces it
    notif.checked = !!ws.notifications;
    notif.addEventListener("change", () => { cur().notifications = notif.checked; save(true); });

    const mon = $(".monitor", card);
    const mons = state.monitors || [];
    mon.parentElement.hidden = mons.length < 2;
    for (const m of mons) mon.append(new Option(m.label, m.name));
    if (w.monitor && mons.some((m) => m.name === w.monitor)) mon.value = w.monitor;
    else mon.selectedIndex = Math.max(0, mons.findIndex((m) => /primary/.test(m.label)));
    mon.addEventListener("change", () => { post({ type: "setMonitor", id: w.id, monitor: mon.value }); toast("Moved to " + mon.selectedOptions[0].textContent); });

    $(".reset", card).setAttribute("aria-label", `Reset position of ${w.name}`);
    $(".reset", card).addEventListener("click", () => { post({ type: "resetPosition", id: w.id }); toast("Position reset"); });
    // Copies: the first copy can add more (each with its own options, position and data), extra copies can be removed.
    const extra = w.instance > 1;
    const copy = $(".copy", card);
    const removeCopy = $(".removecopy", card);
    copy.setAttribute("aria-label", `Add another copy of ${w.name}`);
    removeCopy.setAttribute("aria-label", `Remove ${w.name}`);
    if (extra) copy.remove();
    else copy.addEventListener("click", () => { post({ type: "addInstance", id: w.widget }); toast(`Added another ${w.name}`); });
    if (!extra) removeCopy.remove();
    else removeCopy.addEventListener("click", () => { post({ type: "removeInstance", id: w.id }); toast(`${w.name} removed`); });
    card.dataset.instance = w.id;
    const remove = $(".remove", card);
    remove.setAttribute("aria-label", `Remove ${w.name}`);
    if (w.source === "builtin" || extra) remove.remove();
    else remove.addEventListener("click", () => job(w.widget, "remove", remove));

    icons(card);
    labelRows(card);
    list.append(card);
  }
  applyFocus();
}

// "Options..." in a widget's right-click menu: the host asks for this copy's card. State may arrive after the
// request (Settings was just opened), so the request lasts a moment and renderInstalled applies it again.
let focusId = null;
let focusUntil = 0;
let focusScrolled = false;
function focusWidget(id) {
  show("widgets");
  focusId = id;
  focusUntil = Date.now() + 2500;
  focusScrolled = false;
  applyFocus();
}
function applyFocus() {
  if (!focusId || Date.now() > focusUntil) { focusId = null; return; }
  const card = $$("#installed .wcard").find((c) => c.dataset.instance === focusId);
  if (!card) return;
  card.classList.add("focus");
  if (!focusScrolled) { focusScrolled = true; card.scrollIntoView({ block: "center" }); }
  setTimeout(() => card.classList.remove("focus"), Math.max(0, focusUntil - Date.now()));
}

// Local programs a widget may run. The host re-checks everything: this only shows the exact command line and
// sends back ids (and the hash it showed, so a command that changed meanwhile is not approved blind).
function renderCommands(root, w) {
  if (w.camera) {
    // Granted only by the host's prompt after a click on the widget; this row can only take it away.
    const row = Object.assign(document.createElement("div"), { className: "cmd" });
    const desc = Object.assign(document.createElement("div"), { className: "cmd-desc" });
    desc.append(Object.assign(document.createElement("span"), {
      className: `cmd-status ${w.cameraApproved ? "approved" : "pending"}`,
      textContent: w.cameraApproved ? "Approved" : "Asked on first use",
    }), "Records webcam timelapses (red dot while recording)");
    row.append(Object.assign(document.createElement("div"), { className: "cmd-line", textContent: "Camera" }), desc);
    if (w.cameraApproved) {
      const btn = Object.assign(document.createElement("button"), { className: "btn small danger", textContent: "Revoke" });
      btn.setAttribute("aria-label", `Revoke camera access for ${w.name}`);
      btn.addEventListener("click", () => post({ type: "revokeCamera", widget: w.id }));
      row.append(btn);
    }
    root.append(row);
  }
  const cmds = w.commands || [];
  if (!cmds.length) return;
  root.append(Object.assign(document.createElement("div"), { className: "cmds-title", textContent: "Runs programs on this PC" }));
  for (const c of cmds) {
    const row = document.createElement("div");
    row.className = "cmd";
    const line = Object.assign(document.createElement("div"), { className: "cmd-line", textContent: c.line });
    const desc = Object.assign(document.createElement("div"), { className: "cmd-desc" });
    const status = Object.assign(document.createElement("span"), {
      className: `cmd-status ${c.status}`,
      textContent: c.status === "approved" ? "Approved" : c.status === "changed" ? "Changed, needs approval" : "Not approved",
    });
    desc.append(status, c.description || "");
    const btn = document.createElement("button");
    btn.className = "btn small" + (c.status === "approved" ? " danger" : " primary");
    btn.textContent = c.status === "approved" ? "Revoke" : "Approve";
    btn.setAttribute("aria-label", `${btn.textContent} ${c.line}`);
    btn.addEventListener("click", () =>
      post({ type: c.status === "approved" ? "revokeCommand" : "approveCommand", widget: w.id, command: c.id, hash: c.hash }));
    row.append(line, desc, btn);
    root.append(row);
  }
}

// Arrange widgets (edit mode) is the one global lock (#234). The host owns it (general.lockAll), so it has its own message.
$("#safeOff").addEventListener("click", () => post({ type: "setSafeMode", value: false }));
$("#editMode").addEventListener("change", (e) => {
  post({ type: "setEditMode", value: e.target.checked });
  showArrange(e.target.checked);
  toast(e.target.checked ? "Widgets unlocked: drag to move, drag the corner or Ctrl+scroll to resize" : "Widgets locked");
});
function showArrange(on) {
  $("#editMode").checked = on;
  $("#arrangeBox").classList.toggle("on", on);
  $("#arrangeState").textContent = on ? "Unlocked: drag, resize, then turn off" : "Locked";
  const ico = $(".arrange-ico");
  if (ico.dataset.icon !== (on ? "unlock" : "lock")) { ico.dataset.icon = on ? "unlock" : "lock"; ico.textContent = ""; icons(ico.parentElement); }
}

// ---------- Layouts ----------
function renderGroups() {
  const list = $("#groupList");
  list.replaceChildren();
  $("#groupBox").hidden = !(state.groups || []).length;
  const label = (inst) => (state.widgets.find((x) => x.id === inst) || { name: inst }).name;
  for (const g of state.groups || []) {
    const row = document.createElement("div");
    row.className = "row grouprow-full";
    const text = document.createElement("div");
    text.className = "row-text";
    const name = document.createElement("input");
    name.className = "input name";
    name.value = g.name;
    name.maxLength = 40;
    name.spellcheck = false;
    name.setAttribute("aria-label", "Group name");
    name.addEventListener("change", () => post({ type: "group", op: "configure", group: g.id, name: name.value }));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

    const tabs = document.createElement("div");
    tabs.className = "tabchips";
    g.members.forEach((inst, i) => {
      const chip = document.createElement("span");
      chip.className = "tabchip" + (inst === g.active ? " on" : "");
      const pick = Object.assign(document.createElement("button"), { className: "tabpick", textContent: label(inst) });
      pick.title = "Show this tab";
      pick.addEventListener("click", () => post({ type: "group", op: "activate", group: g.id, id: inst }));
      const ic = Object.assign(document.createElement("button"), { className: "tabicon", title: "Choose tab icon" });
      ic.setAttribute("aria-label", `Choose tab icon for ${label(inst)}`);
      const cur = (g.icons || {})[inst];
      if (cur) ic.append(Object.assign(document.createElement("img"), { src: ICON_BASE + cur + ".png", alt: "" }));
      else ic.textContent = "◇";
      ic.addEventListener("click", () => openIconPicker(inst, ic));
      chip.append(ic, pick);
      if (i > 0) {
        const left = Object.assign(document.createElement("button"), { textContent: "‹", title: "Move earlier" });
        left.setAttribute("aria-label", `Move ${label(inst)} earlier`);
        left.addEventListener("click", () => post({ type: "group", op: "reorder", group: g.id, id: inst, index: i - 1 }));
        chip.append(left);
      }
      const out = Object.assign(document.createElement("button"), { textContent: "×", title: "Remove from group" });
      out.setAttribute("aria-label", `Remove ${label(inst)} from group`);
      out.addEventListener("click", () => post({ type: "group", op: "leave", id: inst }));
      chip.append(out);
      tabs.append(chip);
    });
    text.append(name, tabs);

    const cycle = document.createElement("input");
    cycle.className = "input";
    cycle.type = "number";
    cycle.min = 0;
    cycle.max = 3600;
    cycle.value = g.cycleSeconds || "";
    cycle.placeholder = "Cycle (s)";
    cycle.title = "Switch to the next tab every this many seconds (5–3600); empty = off";
    cycle.setAttribute("aria-label", "Cycle every seconds");
    cycle.style.width = "92px";
    cycle.addEventListener("change", () => post({ type: "group", op: "configure", group: g.id, cycleSeconds: Math.max(0, Math.round(Number(cycle.value) || 0)) }));

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.title = "Ungroup (the widgets stay)";
    del.innerHTML = '<span class="ico" data-icon="trash"></span>';
    del.addEventListener("click", () => post({ type: "group", op: "delete", group: g.id }));
    row.append(text, cycle, del);
    list.append(row);
  }
  icons(list);
}

// ---------- Tab icon picker ----------
const ICON_BASE = "https://umbra.local/shared/tabicons/";
let iconIndex = null;

async function openIconPicker(inst, anchor) {
  document.querySelector(".iconpop")?.remove();
  if (!iconIndex) {
    try { iconIndex = await (await fetch(ICON_BASE + "index.json")).json(); }
    catch { toast("Could not load the icon list", true); return; }
  }
  const pop = document.createElement("div");
  pop.className = "iconpop";
  const search = Object.assign(document.createElement("input"), { className: "input", type: "search", placeholder: "Search icons" });
  search.setAttribute("aria-label", "Search icons");
  const grid = document.createElement("div");
  grid.className = "icongrid";
  const close = () => { pop.remove(); document.removeEventListener("mousedown", away, true); };
  const away = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const choose = (name) => { post({ type: "group", op: "icon", id: inst, icon: name }); close(); };
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren();
    const none = Object.assign(document.createElement("button"), { className: "iconcell wide", textContent: "Default" });
    none.addEventListener("click", () => choose(""));
    grid.append(none);
    for (const it of iconIndex) {
      if (q && !it.name.includes(q) && !it.tags.some((t) => t.includes(q))) continue;
      const b = document.createElement("button");
      b.className = "iconcell";
      b.title = it.name;
      b.setAttribute("aria-label", it.name);
      b.append(Object.assign(document.createElement("img"), { src: ICON_BASE + it.name + ".png", alt: "", loading: "lazy" }));
      b.addEventListener("click", () => choose(it.name));
      grid.append(b);
    }
  };
  search.addEventListener("input", fill);
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  fill();
  pop.append(search, grid);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)) + "px";
  document.addEventListener("mousedown", away, true);
  search.focus();
}

function renderLayouts() {
  $("#autoLayouts").checked = !!state.settings.general.autoSwitchLayouts;
  const list = $("#layoutList");
  list.replaceChildren();
  for (const l of state.layouts || []) {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const name = document.createElement("input");
    name.className = "input name";
    name.value = l.name;
    name.maxLength = 40;
    name.spellcheck = false;
    name.setAttribute("aria-label", "Layout name");
    const rename = () => {
      const to = name.value.trim();
      if (!to || to === l.name) { name.value = l.name; return; }
      post({ type: "renameLayout", name: l.name, to });
    };
    name.addEventListener("change", rename);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
      if (e.key === "Escape") { name.value = l.name; name.blur(); }
    });
    const sub = document.createElement("div");
    sub.className = "row-sub";
    const pin = !l.pinned ? "not pinned to a monitor setup"
      : l.matchesNow ? "pinned to the monitors connected now"
      : `pinned to a setup with ${l.pinnedMonitors} monitor${l.pinnedMonitors === 1 ? "" : "s"}`;
    sub.textContent = `${l.enabled} of ${l.widgets} widgets on \u00b7 ${pin}`;
    text.append(name, sub);

    const apply = Object.assign(document.createElement("button"), { className: "btn small", textContent: "Apply" });
    apply.addEventListener("click", () => post({ type: "applyLayout", name: l.name })); // the host answers with a notice or a commandError
    const pinBtn = Object.assign(document.createElement("button"), {
      className: "btn small ghost",
      textContent: l.matchesNow ? "Unpin" : "Pin to these monitors",
      title: l.matchesNow ? "Stop applying this layout automatically" : "Apply this layout automatically when exactly the monitors connected now are in use",
    });
    pinBtn.addEventListener("click", () => post({ type: "pinLayout", name: l.name, pinned: !l.matchesNow }));
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.title = "Delete layout";
    del.innerHTML = '<span class="ico" data-icon="trash"></span>';
    del.addEventListener("click", () => post({ type: "deleteLayout", name: l.name })); // the host answers with layoutDeleted or a commandError
    row.append(text, apply, pinBtn, del);
    list.append(row);
  }
  icons(list);
}
$("#autoLayouts").addEventListener("change", (e) => {
  state.settings.general.autoSwitchLayouts = e.target.checked;
  save(true);
});
$("#layoutSave").addEventListener("click", () => {
  const name = $("#layoutName").value.trim();
  if (!name) { $("#layoutName").focus(); return; }
  post({ type: "saveLayout", name });
  $("#layoutName").value = "";
  toast(`Saved layout ${name}`);
});
$("#layoutName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#layoutSave").click(); });

// ---------- Browse ----------
function loadCatalog() {
  catalog = null;
  catalogError = null;
  catalogLoading = true;
  renderCatalog();
  post({ type: "catalog" });
}
$("#reloadCatalog").addEventListener("click", loadCatalog);
$("#search").addEventListener("input", renderCatalog);
$$("#browseFilter button").forEach((b) => b.addEventListener("click", () => { browseFilter = b.dataset.filter; renderCatalog(); }));
$("#updateAll").addEventListener("click", () => {
  const ids = (catalog || []).filter((w) => w.updateAvailable).map((w) => w.id);
  if (!ids.length || updatingAll) return;
  updatingAll = { ids, index: 0, total: ids.length };
  for (const id of ids) busy.set(id, "install");
  renderCatalog();
  post({ type: "updateAll" });
});

// Filter chips, the Browse badge in the sidebar and the Update all button, all derived from the catalog the host last sent
// (the host re-sends it after any install/remove, wherever it was started from, so the counts stay right).
function renderBrowseBar() {
  const n = (catalog || []).filter((w) => w.updateAvailable).length;
  $("#updatesCount").textContent = n ? ` (${n})` : "";
  $("#browseCount").textContent = n || "";
  $$("#browseFilter button").forEach((b) => b.classList.toggle("on", b.dataset.filter === browseFilter));
  const all = $("#updateAll");
  all.hidden = !n && !updatingAll;
  all.disabled = !!updatingAll;
  all.lastChild.textContent = updatingAll ? "Updating..." : n === 1 ? "Update 1 widget" : `Update all (${n})`;
  $("#updateStatus").textContent = updatingAll && updatingAll.index ? `Updating ${updatingAll.index} of ${updatingAll.total}...` : "";
}

const expandedCards = new Set(); // catalog ids whose description and commands are shown in full

function renderCatalog() {
  const grid = $("#catalog");
  grid.textContent = "";
  renderBrowseBar();
  if (catalogError) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Couldn't reach the community catalog.<br><small>${escapeHtml(catalogError)}</small></div>`;
    return;
  }
  if (!catalog) {
    for (let i = 0; i < 3; i++) grid.append(Object.assign(document.createElement("div"), { className: "skeleton" }));
    return;
  }
  const q = $("#search").value.trim().toLowerCase();
  const inFilter = (w) => browseFilter === "updates" ? w.updateAvailable : browseFilter === "installed" ? w.installed : true;
  const items = catalog.filter((w) => inFilter(w) && (!q || [w.name, w.description, w.author, w.id].join(" ").toLowerCase().includes(q)));
  if (!items.length) {
    const none = q ? "No widgets match your search."
      : browseFilter === "updates" ? "Everything is up to date."
      : browseFilter === "installed" ? "No community widgets installed yet."
      : "The catalog is empty. Be the first to submit one!";
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${none}</div>`;
    return;
  }
  for (const w of items) {
    const card = $("#tpl-catalog").content.firstElementChild.cloneNode(true);
    const th = $(".cthumb", card);
    $(".initial", card).textContent = (w.name || "?").trim()[0];
    if (w.previewUrl) {
      const img = new Image();
      img.onload = () => { th.style.backgroundImage = `url("${w.previewUrl}")`; th.classList.add("has-img"); };
      img.src = w.previewUrl;
    }
    $(".cname", card).textContent = w.name;
    $(".cver", card).textContent = `v${w.version}`;
    $(".cauthor", card).textContent = w.author ? `by ${w.author}` : "";
    $(".cdesc", card).textContent = w.description || "";
    const chips = $(".chips", card);
    const hosts = w.hosts || [];
    if (!hosts.length) chips.innerHTML = '<span class="chip"><span class="ico" data-icon="lock"></span>No network access</span>';
    for (const h of hosts) {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = '<span class="ico" data-icon="lock"></span>';
      c.append(h);
      chips.append(c);
    }
    for (const k of w.media || []) {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = '<span class="ico" data-icon="lock"></span>';
      c.append(k === "control" ? "Controls media playback" : "Reads now playing");
      chips.append(c);
    }
    if (w.notifications) {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = '<span class="ico" data-icon="lock"></span>';
      c.append("Can show notifications");
      chips.append(c);
    }
    if (w.camera) {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = '<span class="ico" data-icon="lock"></span>';
      c.append("Uses your camera (timelapses)");
      chips.append(c);
    }
    for (const s of w.system || []) {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = '<span class="ico" data-icon="lock"></span>';
      c.append(`Reads ${s} usage`);
      chips.append(c);
    }
    // A widget that can start programs on this PC is flagged with the exact commands (you approve each one on first use).
    // Collapsed cards show one summary chip; "Read more" lists every command in full.
    const cmds = w.commands || [];
    const open = expandedCards.has(w.id);
    // Only a lot of command text is folded away; one short command stays visible as it is.
    const longCmds = cmds.length > 1 || cmds.some((c) => (c.run || "").length > 60);
    if (longCmds && !open) {
      const c = document.createElement("span");
      c.className = "chip warn";
      c.innerHTML = '<span class="ico" data-icon="alert"></span>';
      c.append(cmds.length === 1 ? "Runs 1 program (asks first)" : `Runs ${cmds.length} programs (asks first)`);
      chips.append(c);
    } else {
      for (const cmd of cmds) {
        const c = document.createElement("span");
        c.className = "chip warn";
        c.title = `${cmd.description || ""}\nAsks permission before it runs.`.trim();
        c.innerHTML = '<span class="ico" data-icon="alert"></span>';
        c.append(`Runs: ${cmd.run}`);
        chips.append(c);
      }
    }
    const desc = $(".cdesc", card);
    desc.classList.toggle("open", open);
    const more = $(".cmore", card);
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Show less" : "Read more…";
    more.addEventListener("click", () => {
      if (expandedCards.has(w.id)) expandedCards.delete(w.id); else expandedCards.add(w.id);
      renderCatalog();
    });
    // Shown only for a lot of text: commands that were folded away, an open card, or a description cut off by the line clamp (checked once the card is in the page).
    more.hidden = !(longCmds || open);
    const checkClamp = () => { if (!open && !longCmds) more.hidden = desc.scrollHeight <= desc.clientHeight + 1; };

    card.setAttribute("aria-label", w.name);
    const btn = $(".action", card);
    if (busy.has(w.id)) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Working';
    } else if (w.builtin) {
      btn.classList.add("done");
      btn.innerHTML = '<span class="ico" data-icon="check"></span>Built in';
    } else if (w.updateAvailable) {
      btn.classList.add("primary");
      btn.innerHTML = `<span class="ico" data-icon="download"></span>Update to v${escapeHtml(w.version)}`;
      btn.addEventListener("click", () => job(w.id, "install", btn));
    } else if (w.installed) {
      btn.classList.add("danger");
      btn.innerHTML = '<span class="ico" data-icon="trash"></span>Remove';
      btn.addEventListener("click", () => job(w.id, "remove", btn));
    } else if (w.incompatible) {
      // Made for a newer Umbra (manifestVersion / minUmbraVersion): greyed out with the reason.
      btn.disabled = true;
      btn.textContent = "Needs a newer Umbra";
      btn.title = w.incompatible;
    } else {
      btn.classList.add("primary");
      btn.innerHTML = '<span class="ico" data-icon="download"></span>Install';
      btn.addEventListener("click", () => job(w.id, "install", btn));
    }
    btn.setAttribute("aria-label", `${btn.textContent.trim()} ${w.name}`);
    icons(card);
    grid.append(card);
    checkClamp();
  }
}

// ---------- Themes ----------
// The host sends the active theme as one generated :root rule (validated tokens only); apply it to this page too.
function applyTheme(css) {
  let el = document.getElementById("umbra-theme");
  if (!css) { el && el.remove(); return; }
  if (!el) { el = document.createElement("style"); el.id = "umbra-theme"; document.head.append(el); }
  if (el.textContent !== css) el.textContent = css;
}

// The accent from Appearance (a picked color, or the Windows accent) is one more :root rule, applied after the theme.
function applyAccent(css) {
  let el = document.getElementById("umbra-accent");
  if (!css) { el && el.remove(); return; }
  if (!el) { el = document.createElement("style"); el.id = "umbra-accent"; document.head.append(el); }
  if (el.textContent !== css) el.textContent = css;
}

function loadThemes() {
  themes = null;
  themesError = null;
  renderThemes();
  post({ type: "themes" });
}
$("#reloadThemes").addEventListener("click", loadThemes);

function renderThemes() {
  const grid = $("#themeGrid");
  grid.textContent = "";
  if (!themes) {
    for (let i = 0; i < 3; i++) grid.append(Object.assign(document.createElement("div"), { className: "skeleton" }));
    return;
  }
  const active = (state && state.settings.general.theme) || "default";
  if (themesError) grid.append(Object.assign(document.createElement("div"), {
    className: "empty", textContent: `Couldn't reach the theme catalog (${themesError}). Installed themes still work.`,
  }));
  for (const t of themes) {
    const card = $("#tpl-theme").content.firstElementChild.cloneNode(true);
    const tk = t.tokens || {};
    // Swatch colors come from validated tokens (host side); the fallbacks are the default look.
    const sw = $(".swatch", card);
    for (const [prop, token] of [["--t-bg", "--bg"], ["--t-surface", "--surface-2"], ["--t-line", "--line-strong"], ["--t-text", "--text"], ["--t-text2", "--text-3"], ["--t-accent", "--accent"], ["--t-radius", "--radius-m"]])
      if (tk[token]) sw.style.setProperty(prop, tk[token]);
    $(".cname", card).textContent = t.name;
    $(".cver", card).textContent = t.builtin ? "" : `v${t.version}`;
    $(".cauthor", card).textContent = t.author ? `by ${t.author}` : "";
    $(".cdesc", card).textContent = t.description || "";
    card.classList.toggle("active", t.id === active);

    card.setAttribute("aria-label", t.name);
    const btn = $(".action", card);
    const remove = $(".remove", card);
    remove.setAttribute("aria-label", `Remove theme ${t.name}`);
    if (!t.installed || t.builtin || t.id === "") remove.remove();
    else remove.addEventListener("click", () => job(t.id, "removeTheme", remove));
    if (busy.has(t.id)) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Working';
    } else if (!t.installed) {
      btn.classList.add("primary");
      btn.innerHTML = '<span class="ico" data-icon="download"></span>Install';
      btn.addEventListener("click", () => job(t.id, "installTheme", btn));
    } else if (t.updateAvailable) {
      btn.classList.add("primary");
      btn.innerHTML = `<span class="ico" data-icon="download"></span>Update to v${escapeHtml(t.version)}`;
      btn.addEventListener("click", () => job(t.id, "installTheme", btn));
    } else if (t.id === active) {
      btn.classList.add("done");
      btn.innerHTML = '<span class="ico" data-icon="check"></span>In use';
    } else {
      btn.classList.add("primary");
      btn.textContent = "Use theme";
      btn.addEventListener("click", () => { post({ type: "setTheme", id: t.id }); toast(`${t.name} applied`); });
    }
    btn.setAttribute("aria-label", `${btn.textContent.trim()} ${t.name}`);
    icons(card);
    grid.append(card);
  }
}

function job(id, type, btn) {
  busy.set(id, type);
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.innerHTML = '<span class="spin"></span>Working'; }
  post({ type, id });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- messages from the host ----------
bridge && bridge.addEventListener("message", (e) => {
  const m = e.data;
  switch (m.type) {
    case "state":
      state = m;
      $("#ver").textContent = `Version ${m.version}`;
      $("#aboutVer").textContent = `Version ${m.version}`;
      applyTheme(m.themeCss);
      applyAccent(m.accentCss);
      renderGeneral();
      if (!catalog && !catalogLoading && !catalogError && m.settings.general.checkForUpdates !== false) loadCatalog();
      if (!recording) renderHotkeys();
      if (themes) renderThemes();
      renderUpdate();
      showArrange(!!m.editMode);
      $("#safeBanner").hidden = !m.safeMode;
      // Same for the layout names: don't rebuild while one is being renamed.
      // Only a layout name being edited blocks the redraw; a clicked button (Apply, Pin, Delete) must see the new state.
      { const a = document.activeElement; if (!(a && a.tagName === "INPUT" && $("#layoutList").contains(a))) renderLayouts(); }
      // Don't rebuild the widget list while the user is typing in it.
      if (!document.activeElement || !$("#installed").contains(document.activeElement)) renderInstalled();
      { const a = document.activeElement; if (!(a && a.tagName === "INPUT" && $("#groupList").contains(a))) renderGroups(); }
      break;
    case "privacy":
      renderPrivacy(m.widgets);
      break;
    case "notice":
      toast(m.text);
      break;
    case "layoutDeleted":
      toast(`Deleted layout ${m.name}`, false, { label: "Undo", run: () => post({ type: "undoDeleteLayout" }) });
      break;
    case "commandError":
      toast(m.error, true);
      break;
    case "updateError":
      toast(`Update failed: ${m.error}`, true);
      renderUpdate();
      break;
    case "catalog":
      catalogLoading = false;
      catalogError = m.error;
      catalog = m.error && !m.widgets.length ? null : m.widgets;
      renderCatalog();
      break;
    case "themes":
      themesError = m.error;
      themes = m.error && !m.themes.length ? null : m.themes;
      renderThemes();
      break;
    case "updateProgress":
      if (updatingAll) { updatingAll.index = m.index; renderBrowseBar(); }
      break;
    case "updateAllDone": {
      for (const id of updatingAll ? updatingAll.ids : []) busy.delete(id);
      updatingAll = null;
      const r = m.result || { updated: [], failed: [] };
      if (m.error) toast(`Update all failed: ${m.error}`, true);
      else if (r.failed.length) toast(`Updated ${r.updated.length}, failed: ${r.failed.map((f) => `${f.id} (${f.error})`).join("; ")}`, true);
      else toast(r.updated.length ? `Updated ${r.updated.length} widget${r.updated.length === 1 ? "" : "s"}` : "Everything is up to date");
      renderCatalog();
      break;
    }
    case "jobDone": {
      const kind = busy.get(m.id);
      busy.delete(m.id);
      const isTheme = kind === "installTheme" || kind === "removeTheme";
      const name = ((isTheme ? themes : catalog) || []).find((w) => w.id === m.id)?.name || m.id;
      if (m.error) toast(`${name}: ${m.error}`, true);
      else if (kind === "remove" && m.undo) toast(`${name} removed`, false, { label: "Undo", run: () => post({ type: "undoRemove", id: m.undo }) });
      else toast(kind === "remove" || kind === "removeTheme" ? `${name} removed` : `${name} installed`);
      break;
    }
    case "undoDone":
      m.error ? toast(m.error, true) : toast(`${m.name || "Widget"} restored`);
      break;
  }
});

// About logo = the sidebar logo
$(".about-logo").replaceWith(Object.assign($(".logo").cloneNode(true), { classList: "about-logo" }));
function renderPrivacy(list) {
  const root = $("#privacyList");
  root.textContent = "";
  const fmt = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);
  for (const w of list) {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const title = Object.assign(document.createElement("div"), { className: "row-title", textContent: w.widget });
    const sub = (t) => Object.assign(document.createElement("div"), { className: "row-sub", textContent: t });
    text.append(
      title,
      sub(w.hosts.length ? `Can reach: ${w.hosts.join(", ")}` : "Can reach no internet hosts"),
      ...(w.camera?.declared ? [sub(`Camera: timelapses (${w.camera.approved ? "approved" : "not approved yet"})`)] : []),
      sub(w.commands.length ? "Commands: " + w.commands.map((c) => `${c.line} (${c.status})`).join("; ") : "Runs no commands"),
      sub(`Saved data: ${fmt(w.data.bytes)}` + (w.blocked.count ? ` \u00b7 ${w.blocked.count} blocked request(s), latest ${w.blocked.recent[w.blocked.recent.length - 1]}` : "")));
    if (w.crashes?.stopped) text.append(sub("Stopped working: its page kept crashing, so Umbra stopped reloading it. Use Reload on the widget."));
    else if (w.crashes?.count) text.append(sub(`Crashed ${w.crashes.count} time(s) recently (see umbra.log); Umbra reloaded it.`));
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete data";
    del.setAttribute("aria-label", `Delete saved data of ${w.widget}`);
    del.disabled = !w.data.bytes;
    del.addEventListener("click", () => post({ type: "deleteData", widget: w.widget }));
    row.append(text, del);
    root.append(row);
  }
  if (!list.length) root.append(Object.assign(document.createElement("div"), { className: "row", textContent: "No widgets installed." }));
}
$("#exportBackup").addEventListener("click", () => post({ type: "exportBackup" }));
$("#importBackup").addEventListener("click", () => post({ type: "importBackup" }));
// The host shows the picker and the access prompt; the page never passes a path.
$("#installFile").addEventListener("click", () => post({ type: "installLocal", kind: "file" }));
$("#installFolder").addEventListener("click", () => post({ type: "installLocal", kind: "folder" }));
$("#openDataFolder").addEventListener("click", () => post({ type: "openDataFolder" }));
$("#openLogBtn").addEventListener("click", () => post({ type: "openLog" }));
$("#resetAll").addEventListener("click", () => post({ type: "resetAll" }));

// ---------- keyboard ----------
// Esc closes the window, Ctrl+F or / jumps to the Browse search, Ctrl+1..7 switch pages. A hotkey being recorded
// handles (and cancels) its own keys first; the arrow keys of the sidebar and segmented control are in arrowNav().
const typing = (el) => !!el && (el.isContentEditable || el.matches("textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=color])"));
function focusSearch() {
  show("browse");
  $("#search").focus();
  $("#search").select();
}
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || recording) return;
  const noMods = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (e.key === "Escape" && noMods && !e.shiftKey) {
    const search = $("#search");
    if (document.activeElement === search && search.value) { search.value = ""; renderCatalog(); return; }
    e.preventDefault();
    // Commit a field being edited and any save still waiting on its timer, then let the host close the window.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    flushSave();
    post({ type: "close" });
  } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    focusSearch();
  } else if (e.key === "/" && noMods && !typing(document.activeElement)) {
    e.preventDefault();
    focusSearch();
  } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    const b = $$(".nav button")[Number(e.key) - 1];
    if (b) { e.preventDefault(); show(b.dataset.page); }
  }
});

icons();
labelRows();
post({ type: "load" });
