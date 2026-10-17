// Pomodoro: state in umbra.store ("state"), focus minutes per day in "log". Stores the end time, so it survives reloads.
const q = (id) => document.getElementById(id);
const app = q("app"), arc = q("arc"), CIRC = 2 * Math.PI * 52;
const LABEL = { work: "Focus", short: "Short break", long: "Long break" };
let st = null, log = {}, timer = null;

// cfg holds what the user edited in the widget; a null field falls back to the widget option.
let cfg = { breaks: true, work: null, short: null, long: null, every: null };
const o = () => umbra.options;
const pick = (k, opt) => Math.max(1, Number(cfg[k] ?? o()[opt]) || 1);
const mins = (p) => (p === "work" ? pick("work", "work") : p === "short" ? pick("short", "shortBreak") : pick("long", "longBreak"));
const every = () => Math.max(2, pick("every", "longEvery"));
const totalMs = (p) => mins(p) * 60000;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const fresh = (phase, cycle) => ({ phase, cycle, running: false, endsAt: 0, remaining: totalMs(phase), total: totalMs(phase), done: false });
const save = () => { umbra.store.set("state", st).catch(() => {}); };
const saveLog = () => {
  const keep = Object.keys(log).sort().slice(-60);
  log = Object.fromEntries(keep.map((k) => [k, log[k]]));
  umbra.store.set("log", log).catch(() => {});
};

function credit(ms) {
  const m = Math.floor(ms / 60000);
  if (m > 0) { const k = dayKey(); log[k] = (log[k] || 0) + m; saveLog(); }
}

function next(skipped) {
  const wasWork = st.phase === "work";
  const cycle = wasWork ? st.cycle + 1 : st.cycle;
  let phase = "work", c = cycle;
  if (!cfg.breaks) c = 0;
  else if (wasWork) { phase = cycle >= every() ? "long" : "short"; }
  else if (st.phase === "long") c = 0;
  st = fresh(phase, c);
  if (!skipped && o().autoStart) start();
  else st.done = !skipped;
  save();
}

function start() { st.running = true; st.done = false; st.endsAt = Date.now() + st.remaining; save(); }
function pause() { st.remaining = Math.max(0, st.endsAt - Date.now()); st.running = false; save(); }

function tick() {
  if (st.running && Date.now() >= st.endsAt) {
    if (st.phase === "work") credit(st.total);
    next(false);
  }
  render();
}

function render() {
  const left = st.running ? Math.max(0, st.endsAt - Date.now()) : st.remaining;
  const s = Math.ceil(left / 1000);
  q("time").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  arc.style.strokeDashoffset = String(CIRC * (1 - left / st.total));
  app.classList.toggle("brk", st.phase !== "work");
  app.classList.toggle("done", st.done && !st.running);
  q("phase").textContent = LABEL[st.phase];
  q("sub").textContent = st.running ? (st.phase === "work" ? "Focusing" : "Resting") : st.done ? "Session complete" : left < st.total ? "Paused" : "Ready";
  q("toggle").textContent = st.running ? "Pause" : left < st.total ? "Resume" : "Start";
  q("dots").innerHTML = cfg.breaks ? Array.from({ length: every() }, (_, i) => `<i class="${i < st.cycle ? "on" : ""}"></i>`).join("") : "";
  renderStats();
  renderCfg();
  if (timer) clearInterval(timer);
  timer = st.running ? setInterval(tick, 1000) : null;
}

function renderStats() {
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const vals = days.map((d) => log[dayKey(d)] || 0);
  const max = Math.max(30, ...vals);
  q("today").textContent = fmtMin(vals[6]);
  q("week").textContent = fmtMin(vals.reduce((a, b) => a + b, 0));
  q("chart").innerHTML = days.map((d, i) =>
    `<div class="bar${i === 6 ? " today" : ""}" title="${fmtMin(vals[i])}"><i style="height:${Math.round(vals[i] / max * 34)}px"></i><em>${d.toLocaleDateString([], { weekday: "narrow" })}</em></div>`).join("");
}

const saveCfg = () => { umbra.store.set("config", cfg).catch(() => {}); };
// Rebuild an idle, untouched timer so a changed duration or mode shows at once; a running one keeps its time.
function reapply() {
  if (st && !st.running && st.remaining === st.total) {
    const phase = cfg.breaks ? st.phase : "work";
    st = fresh(phase, cfg.breaks ? st.cycle : 0);
    save();
  }
  render();
}

function renderCfg() {
  q("cfg").hidden = !cfgOpen;
  q("stats").hidden = cfgOpen;
  app.classList.toggle("cfg-open", cfgOpen);
  for (const b of q("mode").children) b.classList.toggle("on", (b.dataset.breaks === "1") === cfg.breaks);
  for (const l of document.querySelectorAll("[data-brk]")) l.hidden = !cfg.breaks;
  const set = (id, v) => { const e = q(id); if (document.activeElement !== e) e.value = v; };
  set("in-work", mins("work")); set("in-short", mins("short")); set("in-long", mins("long")); set("in-every", every());
}

let cfgOpen = false;
q("gear").onclick = () => { cfgOpen = !cfgOpen; render(); };
q("mode").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  cfg.breaks = b.dataset.breaks === "1";
  saveCfg(); reapply();
};
for (const [id, key] of [["in-work", "work"], ["in-short", "short"], ["in-long", "long"], ["in-every", "every"]]) {
  q(id).oninput = () => {
    const v = Math.round(Number(q(id).value));
    if (!(v >= 1)) return;
    cfg[key] = Math.min(v, Number(q(id).max));
    saveCfg(); reapply();
  };
  q(id).onfocus = () => umbra.requestFocus?.();
}

q("toggle").onclick = () => { if (!st) return; st.running ? pause() : start(); render(); };
q("skip").onclick = () => {
  if (!st) return;
  if (st.phase === "work") credit(st.total - (st.running ? Math.max(0, st.endsAt - Date.now()) : st.remaining));
  next(true); render();
};

umbra.onSettings(() => {
  if (!st) return;
  if (!st.running && !st.done && st.remaining === st.total) st = fresh(st.phase, st.cycle);
  render();
});
umbra.store.onChange?.(async (k) => {
  if (k && k !== "config") return;
  const c = await umbra.store.get("config", null);
  if (c) { cfg = { ...cfg, ...c }; render(); }
});
umbra.store.onChange?.(async () => { log = await umbra.store.get("log", {}); renderStats(); });
document.addEventListener("visibilitychange", () => { if (st) tick(); });

(async () => {
  await umbra.ready;
  log = await umbra.store.get("log", {});
  cfg = { ...cfg, ...(await umbra.store.get("config", null) || {}) };
  st = await umbra.store.get("state", null);
  if (!st || !LABEL[st.phase] || typeof st.total !== "number") st = fresh("work", 0);
  tick();
  umbra.rendered();
})();
