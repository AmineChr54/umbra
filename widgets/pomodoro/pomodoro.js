// Pomodoro: state in umbra.store ("state"), focus minutes per day in "log". Stores the end time, so it survives reloads.
const q = (id) => document.getElementById(id);
const app = q("app"), arc = q("arc"), CIRC = 2 * Math.PI * 52;
const LABEL = { work: "Focus", short: "Short break", long: "Long break" };
let st = null, log = {}, timer = null;

const o = () => umbra.options;
const mins = (p) => Math.max(1, Number(p === "work" ? o().work : p === "short" ? o().shortBreak : o().longBreak) || 1);
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
  const every = Math.max(2, Number(o().longEvery) || 4);
  let phase = "work", c = cycle;
  if (wasWork) { phase = cycle >= every ? "long" : "short"; }
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
  const every = Math.max(2, Number(o().longEvery) || 4);
  q("dots").innerHTML = Array.from({ length: every }, (_, i) => `<i class="${i < st.cycle ? "on" : ""}"></i>`).join("");
  renderStats();
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

q("toggle").onclick = () => { st.running ? pause() : start(); render(); };
q("skip").onclick = () => {
  if (st.phase === "work") credit(st.total - (st.running ? Math.max(0, st.endsAt - Date.now()) : st.remaining));
  next(true); render();
};

umbra.onSettings(() => {
  if (!st) return;
  if (!st.running && !st.done && st.remaining === st.total) st = fresh(st.phase, st.cycle);
  render();
});
umbra.store.onChange?.(async () => { log = await umbra.store.get("log", {}); renderStats(); });
document.addEventListener("visibilitychange", () => { if (st) tick(); });

(async () => {
  await umbra.ready;
  log = await umbra.store.get("log", {});
  st = await umbra.store.get("state", null);
  if (!st || !LABEL[st.phase] || typeof st.total !== "number") st = fresh("work", 0);
  tick();
  umbra.rendered();
})();
