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
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};
function icons(root = document) {
  for (const el of $$("[data-icon]", root)) {
    const name = el.dataset.icon;
    if (!ICONS[name] || el.firstChild) continue;
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  }
}

let state = null;      // { version, startup, repo, settings, widgets[] }
let catalog = null;    // [{ id, name, ..., installed, updateAvailable }]
let catalogError = null;
const busy = new Map(); // id -> "install" | "remove"

// ---------- navigation ----------
function show(page) {
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === page));
  $("#content").scrollTop = 0;
  if (page === "browse" && !catalog) loadCatalog();
}
$$(".nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));

// ---------- toast ----------
let toastTimer;
function toast(text, error = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("error", error);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), error ? 4200 : 1600);
}

// ---------- saving (debounced, so typing in a field doesn't save every keystroke) ----------
let saveTimer;
function save(immediate = false) {
  clearTimeout(saveTimer);
  const send = () => { post({ type: "save", settings: state.settings }); toast("Saved"); };
  immediate ? send() : (saveTimer = setTimeout(send, 450));
}

// ---------- links ----------
function openLink(key) {
  const repo = (state && state.repo) || "https://github.com/AmineChr54/umbra";
  const urls = { repo, issues: `${repo}/issues`, contribute: `${repo}/blob/main/CONTRIBUTING.md` };
  post({ type: "openUrl", url: urls[key] || key });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-url]");
  if (b) openLink(b.dataset.url);
});

// ---------- General ----------
function renderGeneral() {
  const g = state.settings.general;
  $("#startup").checked = state.startup;
  $("#animations").checked = g.animations;
  $$("#interval button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === g.refreshSeconds));
}
$("#startup").addEventListener("change", (e) => {
  post({ type: "setStartup", value: e.target.checked });
  toast(e.target.checked ? "Umbra will start with Windows" : "Umbra won't start with Windows");
});
$("#animations").addEventListener("change", (e) => { state.settings.general.animations = e.target.checked; save(true); });
$$("#interval button").forEach((b) =>
  b.addEventListener("click", () => {
    state.settings.general.refreshSeconds = Number(b.dataset.v);
    renderGeneral();
    save(true);
  })
);

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
    $("input", input).checked = !!value;
    $("input", input).addEventListener("change", (e) => set(e.target.checked));
  } else {
    input = Object.assign(document.createElement("input"), {
      className: "input", id, type: spec.type === "number" ? "number" : "text", value: value ?? "", spellcheck: false,
    });
    input.addEventListener("input", () => set(spec.type === "number" ? Number(input.value) : input.value));
  }
  wrap.append(input);
  if (spec.hint) wrap.append(Object.assign(document.createElement("div"), { className: "hint-text", textContent: spec.hint }));
  return wrap;
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
    list.innerHTML = '<div class="empty">No widgets yet. Find some in <b>Browse</b>.</div>';
    return;
  }
  for (const w of state.widgets) {
    const ws = state.settings.widgets[w.id];
    const card = $("#tpl-installed").content.firstElementChild.cloneNode(true);
    thumb($(".thumb", card), w);
    $(".wname", card).textContent = w.name;
    const badge = $(".badge", card);
    badge.textContent = w.source === "builtin" ? "Built-in" : "Community";
    badge.classList.add(w.source);
    $(".wmeta", card).textContent = [w.author && `by ${w.author}`, `v${w.version}`].filter(Boolean).join("  ·  ");
    $(".wdesc", card).textContent = w.description;

    const enabled = $(".enabled", card);
    enabled.checked = ws.enabled;
    card.classList.toggle("off", !ws.enabled);
    enabled.addEventListener("change", () => {
      ws.enabled = enabled.checked;
      card.classList.toggle("off", !ws.enabled);
      save(true);
    });

    const fields = $(".fields", card);
    const order = w.optionOrder && w.optionOrder.length ? w.optionOrder : Object.keys(w.options || {});
    for (const key of order) if (w.options[key]) fields.append(field(w.id, key, w.options[key], ws.options[key]));

    const locked = $(".locked", card);
    locked.checked = ws.locked;
    locked.addEventListener("change", () => { ws.locked = locked.checked; save(true); });

    $(".reset", card).addEventListener("click", () => { post({ type: "resetPosition", id: w.id }); toast("Position reset"); });
    const remove = $(".remove", card);
    if (w.source === "builtin") remove.remove();
    else remove.addEventListener("click", () => job(w.id, "remove", remove));

    icons(card);
    list.append(card);
  }
}

// ---------- Browse ----------
function loadCatalog() {
  catalog = null;
  catalogError = null;
  renderCatalog();
  post({ type: "catalog" });
}
$("#reloadCatalog").addEventListener("click", loadCatalog);
$("#search").addEventListener("input", renderCatalog);

function renderCatalog() {
  const grid = $("#catalog");
  grid.textContent = "";
  if (catalogError) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Couldn't reach the community catalog.<br><small>${escapeHtml(catalogError)}</small></div>`;
    return;
  }
  if (!catalog) {
    for (let i = 0; i < 3; i++) grid.append(Object.assign(document.createElement("div"), { className: "skeleton" }));
    return;
  }
  const q = $("#search").value.trim().toLowerCase();
  const items = catalog.filter((w) => !q || [w.name, w.description, w.author, w.id].join(" ").toLowerCase().includes(q));
  if (!items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${q ? "No widgets match your search." : "The catalog is empty. Be the first to submit one!"}</div>`;
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
    } else {
      btn.classList.add("primary");
      btn.innerHTML = '<span class="ico" data-icon="download"></span>Install';
      btn.addEventListener("click", () => job(w.id, "install", btn));
    }
    icons(card);
    grid.append(card);
  }
}

function job(id, type, btn) {
  busy.set(id, type);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Working'; }
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
      renderGeneral();
      // Don't rebuild the widget list while the user is typing in it.
      if (!document.activeElement || !$("#installed").contains(document.activeElement)) renderInstalled();
      break;
    case "catalog":
      catalogError = m.error;
      catalog = m.error && !m.widgets.length ? null : m.widgets;
      renderCatalog();
      break;
    case "jobDone": {
      const kind = busy.get(m.id);
      busy.delete(m.id);
      const name = (catalog || []).find((w) => w.id === m.id)?.name || m.id;
      m.error ? toast(`${name}: ${m.error}`, true) : toast(kind === "remove" ? `${name} removed` : `${name} installed`);
      break;
    }
  }
});

// About logo = the sidebar logo
$(".about-logo").replaceWith(Object.assign($(".logo").cloneNode(true), { classList: "about-logo" }));
icons();
post({ type: "load" });
