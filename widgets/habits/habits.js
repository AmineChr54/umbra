// Habits: a list of habits with a one-tap check for today and a 52-week dot grid for the selected one.
// Data (umbra.store "habits"): [{ id, name, icon, target (7 = daily, 1-6 per week), days: ["YYYY-MM-DD", ...] }]
const $ = (id) => document.getElementById(id);
const S = window.Streaks;
const ICONS = ["💧", "📖", "🏃", "🧘", "💪", "🍎", "😴", "✍️", "🎸", "🧹", "💊", "🌱"];
const CHECK = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let habits = [];
let selected = null;
let icon = ICONS[0];
let confirmRm = false;
let stamp = "";

const dayStart = () => Math.max(0, Math.min(6, Number(umbra.options.dayStart) || 0));
const today = () => S.today(dayStart());
const label = (t) => (t >= 7 ? "daily" : `${t}x/week`);

async function save() {
  try { await umbra.store.set("habits", habits); } catch (e) { console.error("Habits: could not save", e); }
}

function toggle(h, key) {
  const i = h.days.indexOf(key);
  if (i >= 0) h.days.splice(i, 1); else h.days.push(key);
  h.days.sort();
  save();
  render();
}

function renderList() {
  const t = today();
  const list = $("list");
  list.textContent = "";
  for (const h of habits) {
    const done = new Set(h.days);
    const s = S.streaks(done, h.target, t);
    const li = document.createElement("li");
    li.className = "row" + (h.id === selected ? " sel" : "");
    li.innerHTML = `<span class="ic">${esc(h.icon)}</span><span class="nm">${esc(h.name)}<small>${label(h.target)}</small></span>` +
      `<span class="st num${s.current ? " hot" : ""}">${s.current} ${s.unit === "days" ? "d" : "w"}</span>` +
      `<button class="chk${done.has(t) ? " done" : ""}" aria-label="Mark today" aria-pressed="${done.has(t)}">${CHECK}</button>`;
    li.addEventListener("click", () => { selected = h.id; confirmRm = false; render(); });
    li.querySelector(".chk").addEventListener("click", (e) => { e.stopPropagation(); selected = h.id; toggle(h, t); });
    list.appendChild(li);
  }
}

function renderDetail() {
  const h = habits.find((x) => x.id === selected);
  $("detail").hidden = !h;
  if (!h) return;
  const t = today();
  const done = new Set(h.days);
  const s = S.streaks(done, h.target, t);
  const u = s.unit === "days" ? "day" : "week";
  $("cur").textContent = s.current; $("curl").textContent = `current ${u} streak`;
  $("best").textContent = s.best; $("bestl").textContent = `best ${u} streak`;
  $("total").textContent = done.size;
  $("rm").textContent = confirmRm ? "Really remove?" : "Remove";
  $("rm").classList.toggle("sure", confirmRm);

  // 52 columns Monday-first; the last column is this week.
  const first = S.addDays(S.weekStart(t), -51 * 7);
  const grid = $("grid"), months = $("months");
  grid.textContent = ""; months.textContent = "";
  let lastMonth = -1;
  const marks = [];
  for (let c = 0; c < 52; c++) {
    for (let r = 0; r < 7; r++) {
      const k = S.addDays(first, c * 7 + r);
      const i = document.createElement("i");
      if (k > t) i.className = "future";
      else {
        if (done.has(k)) i.classList.add("on");
        if (k === t) i.classList.add("today");
        i.title = k;
        i.addEventListener("click", () => toggle(h, k));
      }
      grid.appendChild(i);
    }
    const m = S.parse(S.addDays(first, c * 7)).getMonth();
    if (m !== lastMonth && c < 49) marks.push({ c, m });
    lastMonth = m;
  }
  marks.forEach(({ c, m }, i) => {
    if (i + 1 < marks.length && marks[i + 1].c - c < 3) return; // would overlap the next label
    const sp = document.createElement("span");
    sp.style.left = `${(c / 52) * 100}%`;
    sp.textContent = new Date(2000, m, 1).toLocaleString([], { month: "short" });
    months.appendChild(sp);
  });
}

function render() {
  $("title").textContent = umbra.options.title || "Habits";
  if (!habits.some((h) => h.id === selected)) selected = habits.length ? habits[0].id : null;
  const t = today();
  const doneToday = habits.filter((h) => h.days.includes(t)).length;
  $("count").textContent = habits.length ? `${doneToday}/${habits.length} today` : "";
  $("empty").hidden = habits.length > 0 || !$("form").hidden;
  renderList();
  renderDetail();
  stamp = t;
}

function buildForm() {
  const ic = $("icons");
  for (const i of ICONS) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = i;
    b.addEventListener("click", () => { icon = i; markIcon(); });
    ic.appendChild(b);
  }
  markIcon();
  $("target").innerHTML = `<option value="7">Every day</option>` + [6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n}x a week</option>`).join("");
}
function markIcon() { [...$("icons").children].forEach((b) => b.classList.toggle("on", b.textContent === icon)); }

function showForm(on) {
  $("form").hidden = !on;
  if (on) { umbra.requestFocus(); $("name").focus(); }
  render();
}

$("add").addEventListener("click", () => showForm($("form").hidden));
$("cancel").addEventListener("click", () => { $("name").value = ""; showForm(false); });
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  if (!name) return;
  const h = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, icon, target: Number($("target").value) || 7, days: [] };
  habits.push(h);
  selected = h.id;
  $("name").value = "";
  save();
  showForm(false);
});
$("rm").addEventListener("click", () => {
  if (!confirmRm) { confirmRm = true; renderDetail(); return; }
  habits = habits.filter((h) => h.id !== selected);
  confirmRm = false; selected = null;
  save(); render();
});

umbra.onSettings(render);
umbra.store.onChange(async () => { habits = await umbra.store.get("habits", []); render(); });
// Roll over to the new day without a restart.
setInterval(() => { if (today() !== stamp) render(); }, 30e3);

(async () => {
  await umbra.ready;
  buildForm();
  habits = await umbra.store.get("habits", []);
  render();
  umbra.rendered();
})();
