// Claude waker: starts the Claude usage window by running the declared command "wake" (claude -p Hello).
// Triggers: "logon" = the widget loads (once per Umbra start), "resume" = a wall-clock jump in a 15 s timer
// or the page becoming visible again, and the Wake now button. State lives in umbra.store ("state").
const $ = (id) => document.getElementById(id);
const HOUR = 3600e3, WINDOW = 5 * HOUR;
const TICK = 15e3, JUMP = 60e3, RESUME_DELAY = 8e3, RETRY = 60e3, MAX_RETRIES = 3, FAIL_BACKOFF = 10 * 60e3;

let state = { lastRun: 0, lastOk: 0, ok: null, msg: "", trigger: "", approved: false, pendingQuiet: false, retries: 0 };
let running = false;
let lastTick = Date.now();
let lastResume = 0;
let resumeTimer = null;
let retryTimer = null;
let note = null; // { text, kind } shown under the rows, overrides the default hint

const opts = () => umbra.options;
const minGap = () => Math.max(0.5, Number(opts().minGapHours) || 5) * HOUR;
const fmtT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const fmtD = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short" });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const when = (t) => (sameDay(t, Date.now()) ? "" : fmtD.format(t) + ", ") + fmtT.format(t);
const span = (ms) => {
  const m = Math.max(1, Math.round(ms / 60e3));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const ago = (ms) => (ms < 60e3 ? "just now" : span(ms) + " ago");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function save() {
  try { await umbra.store.set("state", state); } catch (e) { console.error("Claude waker: could not save", e); }
}

function inQuiet(now = new Date()) {
  const o = opts();
  if (!o.quietEnabled) return false;
  const from = Number(o.quietFrom), to = Number(o.quietTo), h = now.getHours();
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

// ---------- running ----------

function explain(err) {
  const m = String((err && err.message) || err || "");
  if (/needs your approval|changed since|not allowed|refused|prompt/i.test(m))
    return { kind: "approval", text: "This command is not approved yet." };
  if (/not found on this PC/i.test(m))
    return { kind: "missing", text: "Claude CLI not found. Install Claude Code and make sure \"claude\" works in a terminal." };
  return { kind: "other", text: m.slice(0, 160) || "Could not run the command." };
}

function classifyExit(r) {
  const out = `${r.stderr || ""}\n${r.stdout || ""}`;
  if (r.timedOut) return "Timed out. Check your connection.";
  if (/log ?in|authenticat|unauthori[sz]ed|401|api key|credentials/i.test(out))
    return "Claude is not logged in. Run \"claude\" in a terminal and sign in.";
  const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  return `Claude exited with code ${r.exitCode}${first ? `: ${first.slice(0, 120)}` : ""}`;
}

/** Runs the wake command once. `trigger` is "manual", "logon" or "resume". Never runs two at the same time. */
async function wake(trigger) {
  if (running) return;
  running = true;
  note = null;
  render();
  const started = Date.now();
  try {
    const r = await umbra.run("wake", { model: opts().model || "haiku" });
    state.approved = true; // the call resolved, so the host has an approval for it
    state.lastRun = started;
    state.trigger = trigger;
    if (r.exitCode === 0 && !r.timedOut) {
      state.lastOk = started; state.ok = true; state.msg = ""; state.retries = 0;
    } else {
      state.ok = false; state.msg = classifyExit(r);
      scheduleRetry(trigger);
    }
  } catch (err) {
    const e = explain(err);
    state.ok = false; state.msg = e.text; state.trigger = trigger;
    if (e.kind === "approval") {
      state.approved = false;
      note = { text: "Approve to enable automatic wakes: click Wake now.", kind: "warn" };
    } else {
      state.lastRun = started;
      scheduleRetry(trigger);
    }
  } finally {
    running = false;
    await save();
    render();
  }
}

/** After a failed automatic wake (network not back yet after sleep) try again a few times. */
function scheduleRetry(trigger) {
  clearTimeout(retryTimer);
  if (trigger === "manual") return;
  state.retries = (state.retries || 0) + 1;
  if (state.retries > MAX_RETRIES) return;
  retryTimer = setTimeout(() => auto(trigger, true), RETRY);
}

/** Runs a wake for an automatic trigger when every rule allows it. */
function auto(trigger, isRetry = false) {
  const o = opts();
  if (trigger === "logon" && !o.onLogon) return;
  if (trigger === "resume" && !o.onResume) return;
  if (running || !state.approved) return;
  const now = Date.now();
  if (now - state.lastOk < minGap()) return;
  // A recent failure is only retried by its own retry timer, not by every new trigger.
  if (!isRetry && state.ok === false && now - state.lastRun < FAIL_BACKOFF) return;
  if (inQuiet()) { state.pendingQuiet = trigger; save(); render(); return; }
  state.pendingQuiet = false;
  wake(trigger);
}

// ---------- triggers ----------

/** A resume was detected: debounce (one wake per resume), then wait a moment for the network. */
function onResume() {
  const now = Date.now();
  if (now - lastResume < 30e3) return;
  lastResume = now;
  state.retries = 0;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => auto("resume"), RESUME_DELAY);
}

setInterval(() => {
  const now = Date.now();
  const gap = now - lastTick;
  lastTick = now;
  if (gap > JUMP) onResume();
  else if (state.pendingQuiet && !inQuiet()) auto(state.pendingQuiet);
  render();
}, TICK);

document.addEventListener("visibilitychange", () => { if (!document.hidden) onResume(); });

// ---------- view ----------

function render() {
  const now = Date.now();
  const badge = $("badge");
  if (running) { badge.className = "badge run"; badge.textContent = "Waking..."; }
  else if (state.ok === true) { badge.className = "badge ok"; badge.textContent = "Ready"; }
  else if (state.ok === false) { badge.className = "badge err"; badge.textContent = "Needs attention"; }
  else { badge.className = "badge"; badge.textContent = "Not run yet"; }

  $("wake").disabled = running;
  $("wake-label").textContent = running ? "Waking Claude..." : "Wake now";

  $("last").innerHTML = state.lastRun
    ? `<span class="num">${esc(when(state.lastRun))}</span><small>${esc(ago(now - state.lastRun))}${state.trigger ? " &middot; " + esc(state.trigger) : ""}</small>`
    : `<span class="num">Never</span>`;

  if (state.lastOk) {
    const end = state.lastOk + WINDOW;
    $("reset").innerHTML = end > now
      ? `<span class="num">${esc(when(end))}</span><small>in ${esc(span(end - now))}</small>`
      : `<span class="num">${esc(when(end))}</span><small>window ended, next wake starts a new one</small>`;
  } else {
    $("reset").innerHTML = `<span class="num">-</span>`;
  }

  const res = $("result");
  if (state.ok === null) { res.className = ""; res.innerHTML = `<span>-</span>`; }
  else if (state.ok) { res.className = "ok"; res.innerHTML = `<span class="res">OK</span>`; }
  else { res.className = "err"; res.innerHTML = `<span class="res">Error</span><span class="msg">${esc(state.msg)}</span>`; }

  const n = $("note");
  let text, kind = "";
  if (note) ({ text, kind } = note);
  else if (!state.approved) { text = "Approve to enable automatic wakes: click Wake now once and allow the command."; kind = "warn"; }
  else if (state.pendingQuiet) text = "Quiet hours: the wake runs when they end.";
  else if (state.lastOk && now - state.lastOk < minGap())
    text = `Next automatic wake possible in ${span(state.lastOk + minGap() - now)}.`;
  else text = "Wakes automatically when Umbra starts or the PC resumes.";
  n.textContent = text;
  n.className = "note " + kind;
}

$("wake").addEventListener("click", () => wake("manual"));
umbra.onSettings(() => { render(); if (state.pendingQuiet && !inQuiet()) auto(state.pendingQuiet); });

(async () => {
  await umbra.ready;
  const s = await umbra.store.get("state", null);
  if (s && typeof s === "object") state = { ...state, ...s };
  state.retries = 0;
  render();
  umbra.rendered();
  // "logon": the widget just loaded with Umbra. The min gap makes repeated reloads harmless.
  auto("logon");
})();
