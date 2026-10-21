// Event Radar: agenda + timeline of events, with an Add window that parses typed lines.
// Data lives in umbra.store ("events", "view"). Parsing, grouping and layout are in parse.js.
const K = window.EventCore;
const $ = (id) => document.getElementById(id);
const bodyEl = $("body"), addSheet = $("add-sheet"), editSheet = $("edit-sheet");

const STATUS = {
  going: { label: "Going", color: "var(--up)" },
  maybe: { label: "Maybe", color: "var(--flat)" },
  todo: { label: "To do", color: "var(--accent)" },
  deadline: { label: "Deadline", color: "var(--down)" },
  no: { label: "Not going", color: "var(--text-3)" },
};

const ICON = {
  radar: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.6"/><circle cx="9" cy="9" r="3"/><path d="M9 9l4.4-4.4"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
  warn: '<svg viewBox="0 0 12 12"><path d="M6 1.6l4.9 8.6H1.1z"/><path d="M6 5v2.4M6 9h.01"/></svg>',
};

const DAY_PX = 12, RAIL = 14; // timeline: pixels per day, and width of one bar lane

let events = [];
let view = "agenda";
let today = K.todayKey();
let first = true;
let editingId = null;
let addStatus = "going";
let rows = []; // parsed lines in the Add window
let deleteArmed = null;

const opts = () => umbra.options;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- data ----------

async function load() {
  const stored = await umbra.store.get("events", []);
  events = Array.isArray(stored) ? K.sortEvents(stored.filter(K.validEvent)) : [];
  const v = await umbra.store.get("view", "agenda");
  view = v === "timeline" ? "timeline" : "agenda";
}

async function save() {
  try { await umbra.store.set("events", events); }
  catch (err) { console.error("Event Radar: could not save", err); }
}

// ---------- formatting ----------

/** "26-27 Oct", "30 Oct - 2 Nov", with the year only when it isn't the current one. */
function fmtRange(e) {
  const year = e.start.slice(0, 4) !== today.slice(0, 4) || e.end.slice(0, 4) !== today.slice(0, 4);
  const f = new Intl.DateTimeFormat(umbra.locale, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const a = K.toDate(e.start), b = K.toDate(e.end);
  return e.start === e.end ? f.format(a) : f.formatRange(a, b);
}

const fmtMonth = (k) => new Intl.DateTimeFormat(umbra.locale, { month: "short" }).format(K.toDate(k));

// ---------- agenda ----------

function visible() {
  return opts().showPast ? events : events.filter((e) => e.end >= today);
}

function rowHtml(e, clashes) {
  const clash = clashes.get(e.id);
  const past = e.end < today;
  const sub = [fmtRange(e), e.note].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="row-ev st-${e.status}${past ? " past" : ""}" role="button" tabindex="0" data-id="${e.id}" data-no-drag
         style="--c:${STATUS[e.status].color}" title="${esc(STATUS[e.status].label)}">
      <span class="dot"></span>
      <div class="r-main">
        <span class="r-title">${esc(e.title)}</span>
        <span class="r-sub num">${sub}</span>
      </div>
      <div class="r-side">
        ${clash ? `<span class="warn" title="Overlaps: ${esc(clash.map((o) => o.title).join(", "))}" aria-label="Overlaps another event">${ICON.warn}</span>` : ""}
        <span class="r-when num">${esc(K.whenLabel(e, today))}</span>
      </div>
    </div>`;
}

function renderAgenda() {
  const list = visible();
  const clashes = K.findClashes(events);
  bodyEl.className = "body agenda";
  bodyEl.innerHTML = K.group(list, today).map((g) =>
    `<h3 class="grp">${g.label}<span class="num">${g.items.length}</span></h3>${g.items.map((e) => rowHtml(e, clashes)).join("")}`).join("");
}

// ---------- timeline ----------

function renderTimeline() {
  const list = visible();
  const t = K.timeline(list, today, { months: 3, dayPx: DAY_PX });
  const clashes = K.findClashes(events);
  const railsW = Math.max(1, t.lanes) * RAIL;

  let ticks = "", grid = "";
  for (let i = 1; i < t.days; i++) {
    const k = K.addDays(today, i);
    const y = i * t.dayPx;
    if (k.endsWith("-01")) {
      ticks += `<span class="tick" style="top:${y}px">${esc(fmtMonth(k))}</span>`;
      grid += `<i class="hline month" style="top:${y}px"></i>`;
    } else if (K.weekday(k) === 1) {
      grid += `<i class="hline" style="top:${y}px"></i>`;
    }
  }

  let bars = "", labels = "";
  for (const { event: e, y1, y2, lane, labelY, clippedTop } of t.items) {
    const clash = clashes.get(e.id);
    const tip = `${esc(e.title)}: ${esc(fmtRange(e))}${clash ? " (overlaps " + esc(clash.map((o) => o.title).join(", ")) + ")" : ""}`;
    const c = `--c:${STATUS[e.status].color}`;
    bars += `<div class="bar st-${e.status}${clash ? " clash" : ""}${clippedTop ? " clipped" : ""}" role="button" tabindex="0" data-id="${e.id}" data-no-drag
        style="${c};top:${y1}px;height:${y2 - y1}px;left:${lane * RAIL}px" title="${tip}" aria-label="${tip}"></div>`;
    labels += `<div class="tl-label st-${e.status}" role="button" tabindex="0" data-id="${e.id}" data-no-drag style="${c};top:${labelY}px" title="${tip}">
        <span class="l-title">${esc(e.title)}</span><span class="l-when num">${esc(fmtRange(e))}</span></div>`;
  }

  bodyEl.className = "body timeline";
  if (!t.items.length) {
    bodyEl.innerHTML = `<div class="tl-empty">${t.later ? `Nothing in the next 3 months. ${t.later} later.` : "Nothing in the next 3 months."}</div>`;
    return;
  }
  bodyEl.innerHTML = `
    <div class="tl" style="height:${t.height}px;--rails:${railsW}px">
      <div class="grid">${grid}<i class="hline now" style="top:0"></i></div>
      <div class="gutter"><span class="tick today" style="top:0">Today</span>${ticks}</div>
      <div class="rails">${bars}</div>
      <div class="labels">${labels}</div>
    </div>
    <div class="tl-foot">Next 3 months${t.later ? ` · ${t.later} later` : ""}${clashes.size ? ` · <span class="warn-text">overlaps</span>` : ""}</div>`;
}

// ---------- render ----------

function render() {
  today = K.todayKey();
  $("title").textContent = opts().title || "Event Radar";
  for (const b of $("view").children) b.setAttribute("aria-checked", String(b.dataset.view === view));

  if (!events.length) {
    bodyEl.className = "body";
    bodyEl.innerHTML = `<div class="empty"><div class="icon">${ICON.radar}</div><strong>Nothing on the radar</strong>
      <span>Type or paste your events, one per line, and they are sorted into the plan.</span>
      <button class="btn primary" data-act="add" data-no-drag>${ICON.plus}Add events</button></div>`;
  } else if (view === "timeline") {
    renderTimeline();
  } else if (!visible().length) {
    bodyEl.className = "body";
    bodyEl.innerHTML = `<div class="empty"><div class="icon">${ICON.radar}</div><strong>All clear</strong>
      <span>Nothing coming up. Past events are hidden; turn on "Show past events" in My widgets to see them.</span></div>`;
  } else {
    renderAgenda();
  }

  if (first) {
    first = false;
    umbra.rendered();
  }
}

// ---------- add window ----------

const dupKey = (e) => `${e.title.toLowerCase()}|${e.start}|${e.end}`;

function openAdd() {
  closeSheets();
  $("f-text").value = "";
  $("add-msg").textContent = "";
  addStatus = "going";
  addSheet.hidden = false;
  paintAdd();
  umbra.requestFocus(); // the + was just pressed, so the widget may take the keyboard
  $("f-text").focus();
}

function paintAdd() {
  for (const b of $("add-status").children) b.setAttribute("aria-checked", String(b.dataset.status === addStatus));
  const known = new Set(events.map(dupKey));
  rows = K.parseLines($("f-text").value, { today: K.todayKey(), defaultStatus: addStatus });
  const seen = new Set();
  for (const r of rows) {
    if (!r.ok) continue;
    const k = dupKey(r.event);
    r.dup = known.has(k) || seen.has(k);
    seen.add(k);
  }
  const good = rows.filter((r) => r.ok && !r.dup);
  const clashes = K.findClashes([...events, ...good.map((r) => r.event)]);
  $("preview").innerHTML = rows.map((r) => {
    if (!r.ok) return `<div class="pv bad"><span class="pv-main">${esc(r.raw.trim().slice(0, 60))}</span><span class="pv-note">${esc(r.error)}</span></div>`;
    const e = r.event;
    const warn = clashes.has(e.id) ? `<span class="warn" title="Overlaps: ${esc(clashes.get(e.id).map((o) => o.title).join(", "))}">${ICON.warn}</span>` : "";
    return `<div class="pv${r.dup ? " dupe" : ""}" style="--c:${STATUS[e.status].color}">
      <span class="dot"></span>
      <span class="pv-main">${esc(e.title)}</span>
      <span class="pv-note num">${r.dup ? "already in plan" : esc(fmtRange(e)) + " · " + STATUS[e.status].label}</span>${warn}</div>`;
  }).join("");
  const go = $("add-go");
  go.disabled = !good.length;
  go.textContent = good.length ? `Add ${good.length} event${good.length === 1 ? "" : "s"}` : "Add";
}

function commitAdd() {
  paintAdd();
  const good = rows.filter((r) => r.ok && !r.dup);
  if (!good.length) return;
  events = K.sortEvents([...events, ...good.map((r) => r.event)]);
  const remaining = rows.filter((r) => !r.ok).map((r) => r.raw.trim());
  save();
  render();
  if (remaining.length) {
    // Keep what couldn't be read, so nothing typed is lost.
    $("f-text").value = remaining.join("\n");
    $("add-msg").textContent = `Added ${good.length}. Fix the rest.`;
    paintAdd();
  } else {
    closeSheets();
    bodyEl.querySelector(`[data-id="${good[0].event.id}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

addSheet.addEventListener("submit", (e) => { e.preventDefault(); commitAdd(); });
$("f-text").addEventListener("input", () => { $("add-msg").textContent = ""; paintAdd(); });
$("f-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitAdd(); }
});
$("add-status").addEventListener("click", (e) => {
  const b = e.target.closest("[data-status]");
  if (b) { addStatus = b.dataset.status; paintAdd(); }
});

// ---------- edit window ----------

function openEdit(ev) {
  closeSheets();
  editingId = ev.id;
  $("e-title").value = ev.title;
  $("e-start").value = ev.start;
  $("e-end").value = ev.end;
  $("e-note").value = ev.note || "";
  editSheet.dataset.status = ev.status;
  paintEdit();
  disarmDelete();
  for (const f of [$("e-title"), $("e-start"), $("e-end")]) f.classList.remove("invalid");
  editSheet.hidden = false;
}

function paintEdit() {
  for (const b of $("e-status").children) b.setAttribute("aria-checked", String(b.dataset.status === editSheet.dataset.status));
  editSheet.style.setProperty("--c", STATUS[editSheet.dataset.status].color);
}

function invalid(field) {
  field.classList.add("invalid");
  umbra.requestFocus();
  field.focus();
}

function commitEdit() {
  const title = $("e-title").value.trim();
  const start = $("e-start").value;
  const end = $("e-end").value || start;
  if (!title) return invalid($("e-title"));
  if (!K.isKey(start)) return invalid($("e-start"));
  if (!K.isKey(end) || end < start) return invalid($("e-end"));
  const note = $("e-note").value.trim();
  const ev = { id: editingId, title, start, end, status: editSheet.dataset.status, ...(note ? { note } : {}) };
  events = K.sortEvents(events.map((x) => (x.id === editingId ? ev : x)));
  closeSheets();
  render();
  save();
}

function disarmDelete() {
  clearTimeout(deleteArmed);
  deleteArmed = null;
  $("e-delete").textContent = "Delete";
  $("e-delete").classList.remove("armed");
}

$("e-delete").addEventListener("click", () => {
  // Two clicks, so a stray click never loses an event.
  if (!deleteArmed) {
    $("e-delete").textContent = "Really delete?";
    $("e-delete").classList.add("armed");
    deleteArmed = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  events = events.filter((x) => x.id !== editingId);
  closeSheets();
  render();
  save();
});

editSheet.addEventListener("submit", (e) => { e.preventDefault(); commitEdit(); });
$("e-status").addEventListener("click", (e) => {
  const b = e.target.closest("[data-status]");
  if (b) { editSheet.dataset.status = b.dataset.status; paintEdit(); }
});
for (const f of [$("e-title"), $("e-start"), $("e-end")]) f.addEventListener("input", () => f.classList.remove("invalid"));

// The window never activates, so the date picker popup is kept out of the way: type the date instead.
for (const f of [$("e-start"), $("e-end")]) {
  f.addEventListener("keydown", (e) => {
    if (e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) e.preventDefault();
  });
  f.addEventListener("click", (e) => e.preventDefault());
}

// ---------- shared wiring ----------

function closeSheets() {
  if (addSheet.hidden && editSheet.hidden) return;
  addSheet.hidden = true;
  editSheet.hidden = true;
  editingId = null;
  document.activeElement?.blur?.();
}

for (const sheet of [addSheet, editSheet]) {
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheets(); });
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeSheets(); } });
}
$("add").addEventListener("click", openAdd);

$("view").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-view]");
  if (!b || b.dataset.view === view) return;
  view = b.dataset.view;
  render();
  try { await umbra.store.set("view", view); } catch (err) { console.error("Event Radar: could not save view", err); }
});

bodyEl.addEventListener("click", (e) => {
  if (e.target.closest('[data-act="add"]')) return openAdd();
  const t = e.target.closest("[data-id]");
  const ev = t && events.find((x) => x.id === t.dataset.id);
  if (ev) openEdit(ev);
});
bodyEl.addEventListener("keydown", (e) => {
  const t = e.target.closest("[data-id]");
  if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); }
});

// ---------- start ----------

/** One timer for the next local midnight, so "today" and every countdown move on without polling. */
let midnight;
function scheduleMidnight() {
  clearTimeout(midnight);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnight = setTimeout(() => { render(); scheduleMidnight(); }, next - now + 50);
}

umbra.ready.then(async () => {
  if (!umbra.store) {
    $("title").textContent = opts().title || "Event Radar";
    bodyEl.innerHTML = `<div class="note">Event Radar needs Umbra 1.2 or newer to save your events.</div>`;
    $("add").hidden = true;
    $("view").hidden = true;
    umbra.rendered();
    return;
  }
  await load();
  render();
  scheduleMidnight();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
});

umbra.onSettings(() => { if (!first) render(); });
umbra.onTimeChanged?.(() => { if (!first) { render(); scheduleMidnight(); } });
umbra.store?.onChange(async () => {
  await load();
  if (editingId && !events.some((x) => x.id === editingId)) closeSheets();
  render();
});
