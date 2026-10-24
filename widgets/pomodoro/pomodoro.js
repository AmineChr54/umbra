// Pomodoro focus session (Windows Focus style). Rules live in session.js (FocusSession); this file is the UI.
// umbra.store keys: "session" (the running session, see session.js; survives restarts), "setup" ({ minutes, breaks }),
// "log" ({ "YYYY-MM-DD": focus minutes }, unchanged from 1.x). The 1.x keys "state" and "config" are left alone and ignored.
// Session events go through emit(); other features (the timelapse, #240) subscribe with Pomodoro.on(fn).
const S = window.FocusSession;
const q = (id) => document.getElementById(id);
const app = q("app"), arc = q("arc");
const R = 54, CIRC = 2 * Math.PI * R, MIN = 60000;
const LIVE_MS = 60000; // a phase change older than this (caught up after a restart) gets no toast

const T = window.PomodoroTimelapse;
let session = null, setup = { minutes: 60, breaks: false }, log = {}, timer = null, menuOpen = false;
// Timelapse: settings in store key "timelapse"; tlState is the host's latest state, tlError a plain-words failure.
// The camera only starts from a click (Start, or "Start timelapse" in the run view), never automatically. The host has no
// pause, so capture runs through pauses and breaks and stops when the session ends; it also pauses while the widget is hidden.
let tl = T.clean(null), tlState = null, tlError = "", folderLabel = "Videos", tlBusy = false;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const fmtClock = (ms) => {
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const auto = () => umbra.options.autoStart !== false;
const store = (k, v) => umbra.store.set(k, v).catch(() => {});

// ---- events: the one place session changes fan out (log, toasts, future hooks) ----
const listeners = [];
window.Pomodoro = { on: (fn) => listeners.push(fn), get session() { return session; } };

function emit(events) {
  for (const e of events) {
    if (e.type === "phaseEnd" && e.focusMs > 0) credit(e.focusMs, e.at);
    if (e.type === "done" || e.type === "end") stopTl();
    for (const fn of listeners) { try { fn(e, session); } catch (err) { console.error(err); } }
  }
  const last = events.filter((e) => e.type === "phaseStart" || e.type === "done").at(-1);
  if (last && Date.now() - last.at < LIVE_MS) notify(last);
}

function apply(r) {
  session = r.s;
  store("session", session);
  emit(r.events);
  render();
}

function credit(ms, at) {
  const m = Math.round(ms / MIN);
  if (m <= 0) return;
  const k = dayKey(new Date(at));
  log[k] = (log[k] || 0) + m;
  const keep = Object.keys(log).sort().slice(-60);
  log = Object.fromEntries(keep.map((d) => [d, log[d]]));
  store("log", log);
}

function phaseTitle(s, i = s.idx) {
  const { n, of } = S.focusIndex({ ...s, idx: i });
  return s.phases[i].kind === "focus" ? `Focus period ${n} of ${of}` : `${s.phases[i].min} min break`;
}

function notify(e) {
  if (umbra.options.notify === false || !session) return;
  let title, body;
  if (e.type === "done") { title = "Focus session complete"; body = `You focused for ${fmtMin(Math.round((session.focused || 0) / MIN))}.`; }
  else {
    const p = session.phases[e.idx], nxt = session.phases[e.idx + 1];
    title = p.kind === "break" ? "Time for a break" : phaseTitle(session, e.idx);
    body = p.kind === "break" ? `${p.min} minutes. Then ${phaseTitle(session, e.idx + 1).toLowerCase()}.`
      : `${p.min} minutes of focus.${nxt ? ` Up next: ${nxt.min} min break.` : " Last one."}`;
    if (!e.auto) body += " Start it from the widget.";
  }
  umbra.notify?.({ title, body, tag: "pomodoro-phase" })?.catch?.(() => {});
}

// ---- actions ----
const now = () => Date.now();
function startSession() {
  setup.minutes = S.clampTotal(setup.minutes);
  store("setup", setup);
  apply(S.start(S.create(setup.minutes, setup.breaks), now()));
  tlError = ""; if (!tlActive()) tlState = null;
  if (tl.on) startTl(); // inside the Start click, which the host requires
}

// ---- timelapse ----
const tlActive = () => !!tlState && (tlState.state === "recording" || tlState.state === "paused");
async function startTl() {
  if (tlBusy || tlActive() || !session || session.done) return;
  tlBusy = true; tlError = ""; tlState = null; render();
  try {
    // The video holds one frame per photo: aim for the session's own photo count, never above the chosen length.
    const e = T.estimate(tl, session.total);
    tlState = await umbra.timelapse.start({ interval: tl.interval, length: Math.max(1, Math.ceil(e.seconds)), fps: tl.fps });
    if (tlState && tlState.error) tlError = T.friendly(tlState.error);
  } catch (err) { tlError = T.friendly(err && err.message); }
  tlBusy = false; render();
}
function stopTl() {
  if (!tlActive()) return;
  umbra.timelapse.stop().then((s) => { tlState = s; render(); }).catch(() => {});
}
function onTlState(s) {
  tlState = s;
  if (s && s.state === "idle" && s.error) tlError = T.friendly(s.error);
  render();
}
function renderTl() {
  const box = q("tl-run"), stat = q("tl-stat"), act = q("tl-act"), st = tlState && tlState.state;
  const show = tl.on || tlActive() || st === "rendering" || (tlState && tlState.file);
  box.hidden = !show;
  if (!show) return;
  stat.className = "tl-stat num";
  act.hidden = true;
  if (tlError) { stat.textContent = tlError; stat.classList.add("err"); }
  else if (st === "recording" || st === "paused") {
    stat.classList.add("rec");
    const n = tlState.framesCaptured || 0;
    stat.textContent = `${st === "paused" ? "Timelapse paused" : "Timelapse"}: ${plural(n, "photo")}`;
  } else if (st === "rendering") stat.textContent = "Making the video...";
  else if (tlState && tlState.file) stat.textContent = `Saved ${tlState.file} in ${tlState.folder || folderLabel}`;
  else if (!session.done) { stat.textContent = tlBusy ? "Starting the camera..." : "Timelapse is not running"; act.hidden = tlBusy; act.textContent = "Start timelapse"; }
  else stat.textContent = "";
  if (tlError && !session.done && !tlActive()) { act.hidden = false; act.textContent = "Try again"; }
}
function renderTlSetup() {
  const sum = q("tl-sum");
  if (document.activeElement.id !== "tl-interval") q("tl-interval").value = tl.interval;
  if (document.activeElement.id !== "tl-length") q("tl-length").value = tl.length;
  if (document.activeElement.id !== "tl-fps") q("tl-fps").value = tl.fps;
  q("tl-on").checked = tl.on;
  q("tl-fields").hidden = !tl.on;
  q("tl-folder").textContent = folderLabel;
  const e = T.estimate(tl, setup.minutes);
  q("tl-est").textContent = tl.on ? `About ${plural(e.frames, "photo")}, a ${Math.round(e.seconds * 10) / 10} s video${e.capped ? " (shortened by the length limit)" : ""}` : "";
  sum.textContent = tl.on ? `On, ${Math.round(e.seconds * 10) / 10} s video` : "Off";
}
const setTl = (patch) => { tl = T.clean({ ...tl, ...patch }); store("timelapse", tl); render(); };
function toggle() {
  if (!session) return;
  if (session.done) { session = null; umbra.store.remove("session").catch(() => {}); render(); return; }
  apply(session.running ? S.pause(session, now()) : S.start(session, now()));
}
function tick() {
  if (session && session.running) {
    const r = S.advance(session, now(), auto());
    if (r.events.length) { apply(r); return; }
  }
  render();
}

// ---- render ----
function renderTicks() {
  const g = q("ticks");
  let out = "";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI, major = i % 5 === 0, r1 = major ? 44 : 46, r2 = 49;
    const p = (r) => `${(60 + r * Math.cos(a)).toFixed(2)}`, t = (r) => `${(60 + r * Math.sin(a)).toFixed(2)}`;
    out += `<line${major ? ' class="major"' : ""} x1="${p(r1)}" y1="${t(r1)}" x2="${p(r2)}" y2="${t(r2)}"/>`;
  }
  g.innerHTML = out;
  arc.style.strokeDasharray = String(CIRC);
}

function renderSetup() {
  const inp = q("minutes");
  if (document.activeElement !== inp) inp.value = setup.minutes;
  q("minus").disabled = setup.minutes <= S.MIN_TOTAL;
  q("plus").disabled = setup.minutes >= S.MAX_TOTAL;
  q("skip-breaks").checked = !setup.breaks;
  const k = S.breakCount(setup.minutes, true);
  q("breaks-hint").textContent = !setup.breaks ? "You'll have no breaks"
    : k ? `You'll have ${plural(k, "break")}` : "Too short for a break";
}

function renderRun() {
  const s = session, t = now();
  const p = s.phases[s.idx], left = S.remaining(s, t), total = p.min * MIN;
  const paused = !s.running && !s.done && left < total;
  const waiting = !s.running && !s.done && left === total;
  app.classList.toggle("brk", !s.done && p.kind === "break");
  app.classList.toggle("paused", paused);
  app.classList.toggle("done", s.done);
  q("phase").textContent = s.done ? "Session complete" : phaseTitle(s);
  q("time").textContent = s.done ? fmtMin(Math.round((s.focused || 0) / MIN)) : fmtClock(left);
  q("sub").textContent = s.done ? "focused" : paused ? "Paused" : waiting ? (p.kind === "break" ? "Break ready" : "Ready") : p.kind === "break" ? "Break" : "Focus";
  arc.style.strokeDashoffset = String(s.done ? 0 : CIRC * (1 - left / total));
  const nxt = S.nextPhase(s);
  q("next").textContent = s.done ? `of ${fmtMin(s.total)} planned` : nxt
    ? (nxt.kind === "break" ? `Up next: ${nxt.min} min break` : `Up next: ${phaseTitle(s, s.idx + 1).toLowerCase()}`)
    : "Last focus period";
  q("toggle").textContent = s.done ? "New session" : s.running ? "Pause" : paused ? "Resume" : p.kind === "break" ? "Start break" : "Start";
  renderTl();
  q("more").hidden = s.done;
  q("m-skip").textContent = p.kind === "break" ? "Skip break" : nxt ? "Skip to break" : "Finish now";
  q("menu").hidden = !menuOpen || s.done;
  q("more").setAttribute("aria-expanded", String(menuOpen && !s.done));
}

function render() {
  q("today").textContent = fmtMin(log[dayKey()] || 0);
  q("setup").hidden = !!session;
  q("run").hidden = !session;
  if (session) renderRun(); else { app.classList.remove("brk", "paused", "done"); renderSetup(); renderTlSetup(); }
  schedule();
}

// One timer per second, only while a phase runs and the PC is awake.
function schedule() {
  const want = !!(session && session.running) && !umbra.settings.paused;
  if (want && !timer) timer = setInterval(tick, 1000);
  if (!want && timer) { clearInterval(timer); timer = null; }
}

// ---- inputs ----
const setMinutes = (v) => { setup.minutes = S.clampTotal(v); store("setup", setup); render(); };
q("minus").onclick = () => setMinutes(Math.ceil(setup.minutes / 5) * 5 - 5);
q("plus").onclick = () => setMinutes(Math.floor(setup.minutes / 5) * 5 + 5);
q("minutes").onfocus = () => umbra.requestFocus?.();
q("minutes").onchange = () => setMinutes(q("minutes").value);
q("minutes").onkeydown = (e) => { if (e.key === "Enter") q("minutes").blur(); };
q("skip-breaks").onchange = () => { setup.breaks = !q("skip-breaks").checked; store("setup", setup); render(); };
q("tl-on").onchange = () => setTl({ on: q("tl-on").checked });
for (const [id, key] of [["tl-interval", "interval"], ["tl-length", "length"], ["tl-fps", "fps"]]) {
  q(id).onfocus = () => umbra.requestFocus?.();
  q(id).onchange = () => setTl({ [key]: q(id).value });
  q(id).onkeydown = (e) => { if (e.key === "Enter") q(id).blur(); };
}
q("tl-folder").onclick = () => umbra.timelapse.chooseFolder()
  .then((r) => { if (r && r.folder) { folderLabel = r.folder; render(); } })
  .catch((err) => { const m = q("setup-msg"); m.textContent = T.friendly(err && err.message); m.hidden = false; });
q("tl-act").onclick = startTl;
q("start").onclick = startSession;
q("toggle").onclick = toggle;
q("more").onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
document.addEventListener("pointerdown", (e) => { if (menuOpen && !e.target.closest("#menu, #more")) { menuOpen = false; render(); } });
const menuAction = (fn) => () => { menuOpen = false; if (session && !session.done) apply(fn(session, now())); };
q("m-skip").onclick = menuAction((s, t) => S.skip(s, t, auto()));
q("m-add").onclick = menuAction((s, t) => S.extend(s, 5, t));
q("m-end").onclick = menuAction((s, t) => S.end(s, t));

umbra.onSettings(() => tick());
umbra.onTimeChanged?.(() => tick());
document.addEventListener("visibilitychange", () => tick());
umbra.store.onChange?.(async (k) => {
  if (!k || k === "log") log = await umbra.store.get("log", {});
  if (!k || k === "setup") setup = { ...setup, ...(await umbra.store.get("setup", {})) };
  if (!k || k === "session") { const s = await umbra.store.get("session", null); session = S.valid(s) ? s : null; }
  tick();
});

(async () => {
  await umbra.ready;
  renderTicks();
  log = await umbra.store.get("log", {});
  setup = { ...setup, ...(await umbra.store.get("setup", {})) };
  const s = await umbra.store.get("session", null);
  session = S.valid(s) ? s : null;
  tl = T.clean(await umbra.store.get("timelapse", null));
  q("tl-box").open = tl.on; // show the options when the timelapse is on, collapsed otherwise
  try {
    umbra.timelapse.onChange(onTlState);
    const st = await umbra.timelapse.status();
    folderLabel = st.folder || folderLabel;
    // A recording from before a reload is not ours to resume without a click; only show a live one.
    if (st.state !== "idle") tlState = st;
  } catch { /* no camera permission or an older host: the section still saves settings */ }
  tick(); // catches up on phases that ended while Umbra was closed
  umbra.rendered();
})();
