// To Do: today's tasks with repeats and streaks. Data lives in umbra.store ("tasks", "ui").
const R = window.TodoRepeat;
const $ = (id) => document.getElementById(id);
const listEl = $("list"), menuEl = $("menu"), input = $("new"), newRepeatBtn = $("new-repeat");

const ICON = {
  check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5.2"/></svg>',
  repeat: '<svg viewBox="0 0 12 12"><path d="M9.5 4.5A3.8 3.8 0 0 0 2.6 4M2.5 7.5A3.8 3.8 0 0 0 9.4 8"/><path d="M9.7 1.8v2.8H6.9M2.3 10.2V7.4h2.8"/></svg>',
  flame: '<svg viewBox="0 0 12 12"><path d="M6.4.6c.3 2-1 2.9-1.9 4C3.6 5.7 3 6.6 3 7.8 3 9.8 4.4 11.3 6 11.3s3-1.4 3-3.4c0-1.2-.5-2.1-1-2.7.1.9-.3 1.6-.9 1.8.4-2.4-.3-4.9-.7-6.4z"/></svg>',
  x: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 10 10"><path d="M3.5 2 6.5 5l-3 3"/></svg>',
  sun: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="3.2"/><path d="M9 1.8v1.6M9 14.6v1.6M1.8 9h1.6M14.6 9h1.6M3.9 3.9l1.1 1.1M13 13l1.1 1.1M3.9 14.1 5 13M13 5l1.1-1.1"/></svg>',
  done: '<svg viewBox="0 0 18 18"><path d="M4 9.4 7.5 12.8 14 5.6"/></svg>',
};

const weekdayShort = [...Array(7)].map((_, i) =>
  new Intl.DateTimeFormat([], { weekday: "short" }).format(new Date(2026, 9, 11 + i))); // 2026-10-11 is a Sunday
const weekdayLetter = weekdayShort.map((d) => d.slice(0, 1));

let tasks = [];
let ui = { completedOpen: true, laterOpen: false };
let newRepeat = { kind: "none" };
let menuFor = null; // "new" or a task id
let dayKey = "";
let first = true;

const opts = () => umbra.options;
const motion = () => document.documentElement.dataset.motion !== "off";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => R.today(Math.max(0, Math.min(6, Number(opts().dayStart) || 0)));

// ---------- data ----------

async function load() {
  const stored = await umbra.store.get("tasks", []);
  tasks = Array.isArray(stored) ? stored.filter((t) => t && typeof t.title === "string") : [];
  ui = { ...ui, ...(await umbra.store.get("ui", {})) };
}

async function save() {
  try { await umbra.store.set("tasks", tasks); }
  catch (err) { console.error("To Do: could not save", err); }
}

const saveUi = () => umbra.store.set("ui", ui).catch(() => {});

/** Drop one-off tasks finished on an earlier day (when the option is on). */
function expire() {
  const { expired } = R.plan(tasks, dayKey, opts().clearCompleted !== false);
  if (!expired.length) return;
  const gone = new Set(expired.map((t) => t.id));
  tasks = tasks.filter((t) => !gone.has(t.id));
  save();
}

// ---------- rendering ----------

function row(t, isDone) {
  const label = R.label(t, weekdayShort);
  const streak = opts().streaks !== false ? R.streakOn(t, dayKey) : 0;
  return `
    <div class="row${isDone ? " done" : ""}" data-id="${t.id}">
      <button class="check" data-act="toggle" aria-label="${isDone ? "Mark as not done" : "Complete"}">${ICON.check}</button>
      <span class="text" data-act="edit" title="${esc(t.title)}">${esc(t.title)}</span>
      <span class="meta">
        ${streak >= 2 ? `<span class="streak num" title="${streak}-day streak">${ICON.flame}${streak}</span>` : ""}
        ${label ? `<button class="rep" data-act="repeat" title="Change repeat">${ICON.repeat}${esc(label)}</button>` : ""}
      </span>
      <button class="del" data-act="delete" aria-label="Delete">${ICON.x}</button>
    </div>`;
}

function group(name, title, items, isDone) {
  if (!items.length) return "";
  const open = ui[`${name}Open`];
  return `
    <button class="group-head" data-act="group" data-group="${name}" aria-expanded="${open}">
      ${ICON.chevron}${title} <span class="n num">${items.length}</span>
    </button>
    ${open ? items.map((t) => row(t, isDone)).join("") : ""}`;
}

function render() {
  dayKey = today();
  expire();
  const { open, done, later } = R.plan(tasks, dayKey, opts().clearCompleted !== false);
  const doneToday = done.filter((t) => t.doneOn === dayKey).length;
  const total = open.length + doneToday;

  $("title").textContent = opts().title || "My Day";
  const [y, m, d] = dayKey.split("-").map(Number);
  $("date").textContent = new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  $("count").innerHTML = total ? `<b>${doneToday}</b> of ${total}` : "";
  $("bar").style.width = total ? `${(doneToday / total) * 100}%` : "0";

  let html = "";
  if (!tasks.length) {
    html = `<div class="empty"><div class="icon">${ICON.sun}</div><strong>Plan your day</strong>
      <span>Add a task below. Make it repeat and it comes back every day you need it.</span></div>`;
  } else {
    if (!open.length && doneToday)
      html += `<div class="empty compact"><div class="icon">${ICON.done}</div><strong>All done for today</strong></div>`;
    else if (!open.length)
      html += `<div class="empty compact"><div class="icon">${ICON.sun}</div><strong>Nothing due today</strong></div>`;
    html += open.map((t) => row(t, false)).join("");
    html += group("completed", "Completed", done, true);
    html += group("later", "Not today", later, false);
  }
  listEl.innerHTML = html;
  paintNewRepeat();

  if (first) { first = false; umbra.rendered(); }
}

function paintNewRepeat() {
  const label = R.label({ repeat: newRepeat, created: dayKey }, weekdayShort);
  newRepeatBtn.innerHTML = `${ICON.repeat}${label ? esc(label) : ""}`;
  newRepeatBtn.classList.toggle("on", !!label);
  newRepeatBtn.title = label ? `Repeats: ${label}` : "Repeat";
}

// ---------- actions ----------

const find = (id) => tasks.find((t) => t.id === id);
const replace = (t) => { tasks = tasks.map((x) => (x.id === t.id ? t : x)); };

async function toggle(id, rowEl) {
  const t = find(id);
  if (!t) return;
  if (t.doneOn === dayKey || (!R.repeats(t) && t.doneOn)) {
    replace(R.uncomplete(t));
  } else {
    if (motion()) {
      rowEl.classList.add("leaving");
      await new Promise((r) => setTimeout(r, 320));
    }
    replace(R.complete(t, dayKey));
  }
  render();
  save();
}

function remove(id) {
  tasks = tasks.filter((t) => t.id !== id);
  render();
  save();
}

function startEdit(id, textEl) {
  const t = find(id);
  if (!t) return;
  umbra.requestFocus();
  const field = document.createElement("input");
  field.className = "edit";
  field.value = t.title;
  field.maxLength = 200;
  field.spellcheck = false;
  textEl.replaceWith(field);
  field.focus();
  field.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const title = field.value.trim();
    if (keep && title && title !== t.title) { replace({ ...t, title }); save(); }
    render();
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  field.addEventListener("blur", () => finish(true));
}

$("add").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  const repeat = newRepeat.kind === "weekly" && !(newRepeat.days || []).length ? { kind: "weekly", days: [R.weekday(dayKey)] } : newRepeat;
  tasks.push({ id: uid(), title, repeat, created: dayKey, doneOn: null, streak: 0 });
  input.value = "";
  newRepeat = { kind: "none" };
  closeMenu();
  render();
  save();
  listEl.scrollTop = listEl.scrollHeight;
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { input.value = ""; input.blur(); closeMenu(); }
});

listEl.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const rowEl = el.closest(".row");
  if (act === "group") {
    const key = `${el.dataset.group}Open`;
    ui[key] = !ui[key];
    saveUi();
    render();
  } else if (act === "toggle") toggle(rowEl.dataset.id, rowEl);
  else if (act === "delete") remove(rowEl.dataset.id);
  else if (act === "repeat") openMenu(rowEl.dataset.id, el);
});

listEl.addEventListener("dblclick", (e) => {
  const el = e.target.closest('[data-act="edit"]');
  if (el) startEdit(el.closest(".row").dataset.id, el);
});

// ---------- repeat menu ----------

function currentRule() {
  if (menuFor === "new") return newRepeat;
  return (find(menuFor) || {}).repeat || { kind: "none" };
}

function setRule(rule) {
  if (menuFor === "new") newRepeat = rule;
  else {
    const t = find(menuFor);
    if (t) { replace({ ...t, repeat: rule, streak: 0, prev: null }); save(); }
  }
}

function paintMenu() {
  const r = currentRule();
  const k = r.kind || "none";
  // Rows are divs, not buttons: the "Every" row holds the stepper's own buttons, and buttons can't nest.
  const opt = (kind, text, extra = "") =>
    `<div class="opt${k === kind ? " sel" : ""}" role="menuitemradio" aria-checked="${k === kind}" data-kind="${kind}"><span>${text}</span>${extra}<svg class="tick" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5.2"/></svg></div>`;
  const days = r.kind === "weekly" ? (r.days && r.days.length ? r.days : [R.weekday(dayKey)]) : [];
  const every = r.kind === "interval" ? Math.max(2, r.every || 2) : 2;
  // Monday first.
  const order = [1, 2, 3, 4, 5, 6, 0];
  menuEl.innerHTML = `
    ${opt("none", "Don't repeat")}
    <div class="sep"></div>
    ${opt("daily", "Daily")}
    ${opt("weekdays", "Weekdays")}
    ${opt("weekly", "Weekly")}
    ${r.kind === "weekly" ? `<div class="days">${order.map((d) =>
      `<button class="day${days.includes(d) ? " on" : ""}" data-day="${d}" title="${weekdayShort[d]}">${esc(weekdayLetter[d])}</button>`).join("")}</div>` : ""}
    ${opt("interval", `Every <span class="stepper"><button data-step="-1" aria-label="Fewer days">−</button><span class="num">${every}</span><button data-step="1" aria-label="More days">+</button></span> days`)}`;
  placeMenu();
}

let menuAnchor = null;

/** Above the anchor when it fits, otherwise below; re-run whenever the menu's height changes. */
function placeMenu() {
  if (!menuAnchor || menuEl.hidden) return;
  const host = document.querySelector(".todo").getBoundingClientRect();
  const a = menuAnchor.getBoundingClientRect();
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  const left = Math.min(host.width - w - 10, Math.max(10, a.right - w));
  const top = a.top - h - 6 >= 10 ? a.top - h - 6 : Math.max(10, Math.min(host.height - h - 10, a.bottom + 6));
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function openMenu(target, anchor) {
  menuFor = target;
  menuAnchor = anchor;
  menuEl.hidden = false;
  paintMenu();
}

function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuFor = null;
  menuAnchor = null;
  render();
}

newRepeatBtn.addEventListener("click", () => (menuEl.hidden ? openMenu("new", newRepeatBtn) : closeMenu()));

menuEl.addEventListener("click", (e) => {
  const r = currentRule();
  const step = e.target.closest("[data-step]");
  const day = e.target.closest("[data-day]");
  const option = e.target.closest("[data-kind]");
  if (step) {
    const every = Math.max(2, Math.min(365, (r.kind === "interval" ? r.every || 2 : 2) + Number(step.dataset.step)));
    setRule({ kind: "interval", every });
    paintMenu();
  } else if (day) {
    const d = Number(day.dataset.day);
    const current = r.days && r.days.length ? r.days : [R.weekday(dayKey)];
    const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
    if (next.length) setRule({ kind: "weekly", days: next });
    paintMenu();
  } else if (option) {
    const kind = option.dataset.kind;
    if (kind === "weekly") { setRule({ kind, days: r.kind === "weekly" ? r.days : [R.weekday(dayKey)] }); paintMenu(); }
    else if (kind === "interval") { setRule({ kind, every: r.kind === "interval" ? r.every : 2 }); paintMenu(); }
    else { setRule({ kind }); closeMenu(); }
  }
  paintNewRepeat();
});

document.addEventListener("pointerdown", (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest("#new-repeat, [data-act='repeat']")) closeMenu();
});

// ---------- start ----------

umbra.ready.then(async () => {
  if (!umbra.store) {
    // Older Umbra (1.1) has no umbra.store, so there is nowhere to keep tasks.
    $("title").textContent = opts().title || "My Day";
    $("date").textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    listEl.innerHTML = `<div class="note">To Do needs Umbra 1.2 or newer to save your tasks.<br>
      <a data-no-drag id="get-update">Get the latest Umbra</a></div>`;
    $("get-update").addEventListener("click", () => umbra.openUrl("https://github.com/AmineChr54/umbra/releases/latest"));
    $("add").hidden = true;
    umbra.rendered();
    return;
  }
  await load();
  render();
  // A new day reopens repeating tasks; check now and then rather than relying on a midnight timer.
  setInterval(() => { if (today() !== dayKey && menuEl.hidden) render(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && today() !== dayKey) render(); });
});

umbra.onSettings(() => { if (!first) render(); });
umbra.store?.onChange(async () => { await load(); render(); });
