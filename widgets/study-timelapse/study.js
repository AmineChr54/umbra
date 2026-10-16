// Study Time-Lapse launcher. Declared commands only (see widget.json):
//   status = tasklist (is Capture.exe running?), start/render = schtasks /Run on tasks the user creates once,
//   stop = taskkill /IM Capture.exe. Session numbers are estimates from the options (Umbra can't read the
//   session files). umbra.store keys: "session" {start} while running, "last" {start,end,planned,photos}, "ui".
const $ = (id) => document.getElementById(id);
const bodyEl = $("body"), pill = $("pill"), pillText = $("pill-text"), toggle = $("toggle"), renderBtn = $("render"), setupBtn = $("setup");

let session = null;   // { start } while Capture.exe is running
let last = null;      // { start, end, planned, photos }
let ui = { setup: false };
let err = null;       // { kind: "approve" | "task" | "missing" | "other", text }
let checked = false;  // true once a status check has succeeded
let busy = false;
let ticker = 0;
let first = true;

const opts = () => umbra.options;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const plan = () => {
  const planned = num(opts().studyHours, 6) * 3600e3;
  const total = Math.max(1, Math.round(num(opts().videoSeconds, 45) * num(opts().fps, 30)));
  return { planned, total, interval: planned / total };
};
const photosAt = (ms) => { const p = plan(); return Math.min(p.total, Math.max(0, Math.floor(ms / p.interval))); };
const dur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
};
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayLabel = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

// ---------- commands ----------

function classify(e, what) {
  const text = String((e && e.message) || e || "");
  if (/approv/i.test(text)) return { kind: "approve", text };
  if (/not found|was not found|could not start/i.test(text)) return { kind: "missing", text };
  return { kind: "other", text: `${what}: ${text}` };
}

async function save() {
  await umbra.store.set("session", session);
  await umbra.store.set("last", last);
}

async function check() {
  let running;
  try {
    const r = await umbra.run("status");
    if (r.timedOut || (r.exitCode !== 0 && !r.stdout)) throw new Error("Status check failed (tasklist exit " + r.exitCode + ")");
    running = /Capture\.exe/i.test(r.stdout);
    err = null; checked = true;
  } catch (e) {
    err = classify(e, "Status check");
    return;
  }
  const now = Date.now();
  if (running && !session) session = { start: now };
  else if (!running && session) {
    const elapsed = now - session.start;
    last = { start: session.start, end: now, planned: plan().planned, photos: photosAt(elapsed) };
    session = null;
  } else return;
  await save();
}

async function act(id, what) {
  if (busy) return;
  busy = true; render();
  try {
    const r = await umbra.run(id);
    if (r.exitCode !== 0) {
      const out = (r.stderr || r.stdout || "").trim().split(/\r?\n/)[0];
      err = id === "stop"
        ? { kind: "other", text: "Capture.exe is not running." }
        : { kind: "task", text: out || `${what} failed (exit ${r.exitCode})` };
    } else err = null;
  } catch (e) { err = classify(e, what); }
  if (!err && id === "start") {
    // Capture needs a moment to appear in the process list.
    await new Promise((res) => setTimeout(res, 2500));
  }
  if (!err || err.kind === "other") { const keep = err; await check(); err = err || keep; }
  busy = false; render();
}

// ---------- view ----------

function setupText() {
  const dir = String(opts().capturePath || "C:\\StudyTimeLapse\\dist\\StudyTimeLapse").replace(/[\\/]+$/, "");
  const mk = (name, exe) => `schtasks /Create /F /SC ONCE /ST 00:00 /TN "StudyTimeLapse ${name}" /TR "\\"${dir}\\${exe}\\""`;
  return mk("Capture", "Capture.exe") + "\n" + mk("Render", "Render.exe");
}

function setupView(why) {
  return `${why ? `<p class="note warn">${esc(why)}</p>` : ""}
    <p class="note">Umbra can't keep a program running that it starts itself, so the widget starts two <b>scheduled tasks</b> you create once.
    Run these in a terminal (set the folder in the widget options first):</p>
    <pre class="code">${esc(setupText())}</pre>`;
}

function render() {
  const o = opts();
  $("title").textContent = o.title || "Study Time-Lapse";
  const running = !!session;
  const state = err && !running ? "error" : running ? "running" : "idle";
  pill.dataset.state = state;
  pillText.textContent = running ? "Running" : err ? (err.kind === "approve" ? "Not approved" : "Problem") : checked ? "Idle" : "Checking";
  toggle.textContent = running ? "Stop session" : "Start session";
  toggle.classList.toggle("stop", running);
  toggle.disabled = busy; renderBtn.disabled = busy;
  clearInterval(ticker);

  let html;
  if (ui.setup) html = setupView(null);
  else if (err && err.kind === "approve") {
    html = `<p class="note warn">Not approved yet.</p><p class="note">Press <b>${running ? "Stop" : "Start session"}</b> and approve the command Umbra shows. You can also approve or revoke commands in Settings &gt; My widgets.</p>`;
  } else if (err && err.kind === "missing") {
    html = `<p class="note warn">${esc(err.text)}</p>`;
  } else if (err && err.kind === "task") {
    html = setupView(/cannot find|does not exist|not exist/i.test(err.text) ? "The scheduled task doesn't exist yet." : err.text);
  } else if (running) {
    const p = plan(), elapsed = Date.now() - session.start, photos = photosAt(elapsed);
    const pct = Math.min(100, (elapsed / p.planned) * 100);
    html = `<div class="big">${dur(elapsed)}<small>studied</small></div>
      <div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct.toFixed(1)}%"></b></div>
      <div class="stats">
        <div class="stat"><span>Photos (est.)</span><b>${photos} / ${p.total}</b></div>
        <div class="stat"><span>Finishes about</span><b>${clock(session.start + p.planned)}</b></div>
        <div class="stat"><span>Started</span><b>${clock(session.start)}</b></div>
        <div class="stat"><span>Every</span><b>${Math.round(p.interval / 1000)} s</b></div>
      </div>
      ${err ? `<p class="note warn">${esc(err.text)}</p>` : ""}`;
    ticker = setInterval(render, 1000);
  } else if (last) {
    const f = last;
    html = `<div class="big">${dur(f.end - f.start)}<small>last session</small></div>
      <div class="stats">
        <div class="stat"><span>Photos (est.)</span><b>${f.photos}</b></div>
        <div class="stat"><span>Day</span><b>${dayLabel(f.start)}</b></div>
        <div class="stat"><span>Started</span><b>${clock(f.start)}</b></div>
        <div class="stat"><span>Ended</span><b>${clock(f.end)}</b></div>
      </div>
      ${err ? `<p class="note warn">${esc(err.text)}</p>` : ""}`;
  } else {
    html = `<div class="big">No session<small>yet</small></div>
      <p class="note">Press <b>Start session</b> to open Capture. Set up your session there, then it runs in the background. First time? Open <b>Setup</b>.</p>
      ${err ? `<p class="note warn">${esc(err.text)}</p>` : ""}`;
  }
  bodyEl.innerHTML = html;
  if (first) { first = false; umbra.rendered(); }
}

// ---------- wiring ----------

toggle.addEventListener("click", () => act(session ? "stop" : "start", session ? "Stop" : "Start"));
renderBtn.addEventListener("click", () => act("render", "Open renderer"));
setupBtn.addEventListener("click", async () => {
  ui = { ...ui, setup: !ui.setup };
  await umbra.store.set("ui", ui);
  render();
});

(async () => {
  await umbra.ready;
  session = await umbra.store.get("session", null);
  last = await umbra.store.get("last", null);
  ui = { ...ui, ...(await umbra.store.get("ui", {})) };
  render();
  umbra.every(async () => { if (!busy) { await check(); render(); } });
  umbra.onSettings(render);
})();
