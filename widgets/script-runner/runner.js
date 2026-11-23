// Script Runner: runs the user's own scripts (added in Settings) via umbra.run. Data in umbra.store ("results", "ui").
// Scripts that keep running (a tunnel, a server) are started and stopped here and owned by the host; this page only shows them.
const $ = (id) => document.getElementById(id);
const listEl = $("list"), logEl = $("log"), bigEl = $("big"), histEl = $("history"), copyBtn = $("copy"), clearBtn = $("clear");

const MAX_KEEP = 6000;   // characters of each stream saved for the newest run
const HISTORY = 10;      // runs remembered per script
let commands = [];
let results = {};            // id -> [newest run, ...older]; a run is { at, exitCode, ms, stdout, stderr, kind, note, truncated }
let selected = null;
const running = new Map();   // id -> start time of a run (that finishes) started from this page
const services = new Map();  // id -> { running, since, exitCode, restarting, restarts, text } for scripts that keep running
let live = null;             // { id, text } live output of the selected script while it runs
/** id -> { since, tail } set by Clear on live output: only what was printed after `tail` (the end of the text then) is shown. */
let clearMarks = {};
let listHeight = 0;          // the list's height set with the handle under it, in CSS px; 0 = the default (up to 190 px)
let loadError = "";
let first = true;
let autoTimer = null;

const opts = () => umbra.options;
const canStop = typeof umbra.stop === "function";
const canWatch = typeof umbra.commandOutput === "function";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`;
  return `${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} m`;
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${Math.floor(s)} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Keep the first n lines (or the last n for live output); report how many were cut. */
function trimLines(text, n, fromEnd = false) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return { text: "", cut: 0 };
  if (lines.length <= n) return { text: lines.join("\n"), cut: 0 };
  return { text: (fromEnd ? lines.slice(-n) : lines.slice(0, n)).join("\n"), cut: lines.length - n };
}
const lastLine = (s) => (String(s || "").split(/\r?\n/).reverse().find((l) => l.trim()) || "").trim();

const nameOf = (c) => c.title || c.id;
const keeps = (c) => !!(c && c.keepsRunning);
const admin = (c) => !!(c && c.runAsAdmin);
const lastRun = (id) => (results[id] || [])[0];
/** The script was ended by a Stop (here, in Settings or the tray), not on its own: the host's last note says "stopped". */
const stoppedByUser = (s) => /^\[Umbra\] stopped/m.test((String(s?.text || "").trim().split("\n").reverse().find((l) => l.startsWith("[Umbra] ")) || ""));

// ---------- data ----------

/** The user's scripts (and any commands in widget.json). Umbra before umbra.commands() only had widget.json. */
async function loadCommands() {
  try {
    if (typeof umbra.commands === "function") {
      commands = (await umbra.commands()).filter((c) => c && c.id);
    } else {
      const res = await fetch("widget.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json();
      commands = ((m.permissions || {}).commands || []).filter((c) => c && c.id);
    }
    commands.sort((a, b) => Number(!!b.user) - Number(!!a.user));
    loadError = "";
  } catch (err) {
    commands = [];
    loadError = `Could not load the scripts (${err.message || err})`;
  }
  await loadServices();
}

/** State of the scripts that keep running (since when, last exit), from the host. */
async function loadServices() {
  const before = new Map(services);
  services.clear();
  if (!canWatch) return;
  await Promise.all(commands.filter(keeps).map(async (c) => {
    try { services.set(c.id, await umbra.commandOutput(c.id)); } catch { /* keep going without it */ }
  }));
  for (const c of commands.filter(keeps)) noticeServiceChange(c, before.get(c.id), services.get(c.id));
}

/** Results were one object per script before 1.2.0; now the newest few runs. */
function migrate(r) {
  const out = {};
  if (!r || typeof r !== "object" || Array.isArray(r)) return out;
  for (const [id, v] of Object.entries(r)) {
    const runs = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    out[id] = runs.filter((x) => x && typeof x === "object" && typeof x.at === "number").slice(0, HISTORY);
  }
  return out;
}

async function loadState() {
  results = migrate(await umbra.store.get("results", {}));
  const c = await umbra.store.get("checks", {});
  checks = c && typeof c === "object" && !Array.isArray(c) ? c : {};
  const ui = await umbra.store.get("ui", {});
  selected = ui && typeof ui.selected === "string" ? ui.selected : null;
  clearMarks = ui && ui.cleared && typeof ui.cleared === "object" && !Array.isArray(ui.cleared) ? ui.cleared : {};
  listHeight = ui && Number.isFinite(ui.listHeight) && ui.listHeight > 0 ? ui.listHeight : 0;
}
const saveResults = () => umbra.store.set("results", results).catch((e) => console.error("Script Runner: could not save", e));
const saveUi = () => umbra.store.set("ui", { selected, cleared: clearMarks, listHeight }).catch(() => {});

/* The handle between the list and the output panel: drag it to give one more height and the other less. */
const splitEl = $("split"), outEl = $("out");
const LIST_MIN = 52;   // about one row
const OUT_MIN = 96;    // the output keeps its header and a few lines
const LIST_DEFAULT = 190;

/**
 * The tallest the list may be: no taller than its rows (scrollHeight), and the output keeps OUT_MIN. The list shrinks
 * with the window (flex-shrink), so list + output is always the room there is.
 */
function listMax() {
  const room = listEl.offsetHeight + outEl.offsetHeight - OUT_MIN;
  return Math.max(LIST_MIN, Math.min(listEl.scrollHeight, room));
}
const clampList = (h) => Math.round(Math.min(Math.max(h, LIST_MIN), listMax()));
/** Applies the chosen height (or the stylesheet's default), clamped to what fits now; the saved choice is kept for a bigger window. */
function fitSplit() {
  // The default is the stylesheet's 190 px, clamped the same way, so a short widget keeps its output too.
  listEl.style.maxHeight = `${clampList(listHeight || LIST_DEFAULT)}px`;
}
function setListHeight(h) {
  listHeight = clampList(h);
  fitSplit();
  saveUi();
}

let dragFrom = null;   // { y, h } while the handle is held
splitEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragFrom = { y: e.clientY, h: listEl.offsetHeight };
  splitEl.setPointerCapture(e.pointerId);
  splitEl.classList.add("drag");
  document.body.classList.add("resizing");
});
splitEl.addEventListener("pointermove", (e) => {
  if (!dragFrom) return;
  // Stops where the list runs out of rows, or where the output would get too small.
  listHeight = clampList(dragFrom.h + e.clientY - dragFrom.y);
  listEl.style.maxHeight = `${listHeight}px`;
});
function endDrag() {
  if (!dragFrom) return;
  dragFrom = null;
  splitEl.classList.remove("drag");
  document.body.classList.remove("resizing");
  saveUi();
}
splitEl.addEventListener("pointerup", endDrag);
splitEl.addEventListener("pointercancel", endDrag);
splitEl.addEventListener("lostpointercapture", endDrag);
// Double-click: back to the default height.
splitEl.addEventListener("dblclick", () => { listHeight = 0; fitSplit(); saveUi(); });
splitEl.addEventListener("keydown", (e) => {
  if (umbra.settings?.editMode) return; // the arrow keys move the widget while editing the layout
  const step = e.shiftKey ? 88 : 22;
  if (e.key === "ArrowUp") setListHeight(listEl.offsetHeight - step);
  else if (e.key === "ArrowDown") setListHeight(listEl.offsetHeight + step);
  else if (e.key === "Home") setListHeight(LIST_MIN);
  else if (e.key === "End") setListHeight(Infinity);
  else return;
  e.preventDefault();
});
// A resized widget (edit mode) or zoom: keep the output on screen.
addEventListener("resize", () => { if (!dragFrom) fitSplit(); });

/**
 * Live output after a Clear. The host keeps a rolling tail (its start moves once it is full), so an offset would drift:
 * the end of the text at the time of the Clear marks the spot instead. The first match is used, so a repeated line can
 * only ever show a few extra lines, never hide new ones; no match means the tail rolled past it and everything is new.
 */
function afterClear(id, since, text) {
  const m = clearMarks[id];
  text = String(text || "");
  if (!m || m.since !== since) return { text, cleared: false };
  if (!m.tail) return { text, cleared: true };
  const i = text.indexOf(m.tail);
  return { text: i < 0 ? text : text.slice(i + m.tail.length).replace(/^\r?\n/, ""), cleared: true };
}
/** When the live output of the script began: the host's start time for one that keeps running, else this page's run. */
const sinceOf = (c) => (keeps(c) ? services.get(c.id)?.since ?? 0 : running.get(c.id) ?? 0);

/** The Clear button: live output is hidden up to now; a finished run's saved output is dropped (the run stays in the history). */
function clearOutput() {
  const c = commands.find((x) => x.id === selected);
  if (!c) return;
  const svc = keeps(c) ? services.get(c.id) : null;
  if (running.has(c.id) || svc) {
    const text = live && live.id === c.id ? live.text : svc ? svc.text || "" : "";
    clearMarks[c.id] = { since: sinceOf(c), tail: String(text).slice(-200) };
    saveUi();
  } else {
    const r = lastRun(c.id);
    if (!r) return;
    r.stdout = ""; r.stderr = ""; r.note = ""; r.cleared = true;
    saveResults();
  }
  renderOutput();
}

function remember(id, entry) {
  // Only the newest run keeps its output; older ones keep the facts, so the store stays small.
  const older = (results[id] || []).slice(0, HISTORY - 1).map(({ stdout, stderr, ...rest }) => rest);
  results[id] = [entry, ...older];
  saveResults();
}

// ---------- notifications ----------

/** A toast when a script fails (or finishes, by the option). Needs "Allow notifications" for this widget in Settings. */
function notify(c, text, failed) {
  const mode = String(opts().notify || "fail");
  if (mode === "never" || (mode === "fail" && !failed) || typeof umbra.notify !== "function") return;
  umbra.notify({ title: nameOf(c), body: text, tag: `script-${c.id}` }).catch(() => { /* switched off, or rate limited */ });
}

/** A script that keeps running went down on its own (not a Stop): say so. */
function noticeServiceChange(c, before, now) {
  if (!before || !now || !before.running || now.running || stoppedByUser(now)) return;
  const exit = now.exitCode != null ? ` (exit ${now.exitCode})` : "";
  notify(c, now.restarting ? `Stopped${exit}; Umbra restarts it shortly.` : `Stopped${exit}.`, true);
}

// ---------- running ----------

/** Turn a rejection from umbra.run into something to show. */
function describeError(err) {
  const msg = String((err && err.message) || err || "Unknown error");
  if (/administrator prompt/i.test(msg)) return { kind: "cancelled", note: "Cancelled at the Windows administrator prompt." };
  if (/administrator, so approve/i.test(msg)) return { kind: "warn", note: "Not approved yet. A script that runs as administrator is approved in Settings > My widgets." };
  if (/approv/i.test(msg)) return { kind: "warn", note: "Not approved yet. Click Run and approve the prompt, or approve it in Settings > My widgets." };
  return { kind: "error", note: msg };
}

async function runScript(id) {
  const c = commands.find((x) => x.id === id);
  if (!c) return;
  if (keeps(c)) return startService(c);
  if (running.has(id)) return;
  const startedAt = Date.now();
  running.set(id, startedAt);
  updateKeepAlive();
  selected = id; saveUi();
  live = null;
  render();
  poll();
  const t0 = Date.now();
  let entry, rawOut = "", rawErr = "";
  try {
    const r = await umbra.run(id);
    let kind = r.exitCode === 0 ? "ok" : "fail";
    let note = "";
    const stuck = r.stillRunning ? " It runs as administrator and didn't end when asked, so it may still be running (see Task Manager)." : "";
    if (r.stopped) { kind = "stopped"; note = `Stopped.${stuck}`; }
    else if (r.timedOut && r.elevated) { kind = "timeout"; note = `Timed out.${stuck}`; }
    else if (r.timedOut) { kind = "timeout"; note = "Timed out and was stopped. Raise its time limit in Settings > My widgets > Script Runner (max 120 s), or make it a script that keeps running."; }
    else if (r.truncated) { note = "Output was larger than 1 MB and was cut."; }
    rawOut = String(r.stdout || ""); rawErr = String(r.stderr || "");
    entry = { at: Date.now(), exitCode: r.exitCode, ms: r.durationMs ?? Date.now() - t0, stdout: rawOut.slice(0, MAX_KEEP), stderr: rawErr.slice(0, MAX_KEEP), kind, note, truncated: !!r.truncated };
  } catch (err) {
    const d = describeError(err);
    entry = { at: Date.now(), exitCode: null, ms: Date.now() - t0, stdout: "", stderr: "", kind: d.kind, note: d.note };
  }
  running.delete(id);
  updateKeepAlive();
  if (live && live.id === id) live = null;
  // Cleared while it ran: the saved output starts where the Clear was too.
  if (clearMarks[id]) {
    if (clearMarks[id].since === startedAt) {
      // The mark is the end of the live text (stdout and stderr together), so it is in one of the two full streams:
      // that one keeps what came after it; the other is kept whole (its lines can't be placed around the Clear).
      const tail = clearMarks[id].tail || "";
      const inOut = tail && rawOut.includes(tail), inErr = !inOut && tail && rawErr.includes(tail);
      if (inOut) entry.stdout = afterClear(id, startedAt, rawOut).text.slice(0, MAX_KEEP);
      if (inErr) entry.stderr = afterClear(id, startedAt, rawErr).text.slice(0, MAX_KEEP);
      entry.cleared = true;
    }
    delete clearMarks[id]; saveUi();
  }
  remember(id, entry);
  if (entry.kind === "ok") notify(c, `Finished in ${fmtMs(entry.ms)}.${lastLine(entry.stdout) ? ` ${lastLine(entry.stdout)}` : ""}`.slice(0, 200), false);
  else if (entry.kind !== "stopped" && entry.kind !== "cancelled") notify(c, entry.exitCode != null ? `Failed with exit code ${entry.exitCode}.` : entry.note.slice(0, 200), true);
  render();
}

async function startService(c) {
  selected = c.id; saveUi();
  try {
    await umbra.run(c.id);
  } catch (err) {
    const d = describeError(err);
    remember(c.id, { at: Date.now(), exitCode: null, ms: 0, stdout: "", stderr: "", kind: d.kind, note: d.note });
  }
  await loadServices(); // the host also sends commandsChanged; this makes the click feel immediate
  render();
}

async function stopScript(id) {
  if (!canStop) return;
  try { await umbra.stop(id); } catch { /* it ended meanwhile */ }
}

// ---------- live output ----------

/** While the selected script runs, read what it printed so far (once a second, only while the widget is visible). */
async function poll() {
  const c = commands.find((x) => x.id === selected);
  if (!c || !canWatch || document.hidden) return;
  if (!(running.has(c.id) || (keeps(c) && services.get(c.id)?.running))) return;
  try {
    const o = await umbra.commandOutput(c.id);
    if (keeps(c)) services.set(c.id, o);
    live = { id: c.id, text: o.text || "" };
    renderOutput();
  } catch { /* try again next second */ }
}

// ---------- switches ----------
// A script named in the "Show as a switch" option gets an on/off switch instead of Run. Its state is the first on/off
// word on the last line it printed ("VPN ON - Darmstadt" is on). A script named "<name> status" is its check: the widget
// runs it now and then (and hides it from the list), so the switch stays right when the state changes elsewhere.
// A script that keeps running is always a switch (no option needed): it is on while it runs.

const ON = new Set(["on", "true", "up", "connected", "enabled", "active", "yes", "running", "started"]);
const STATE_WORD = /\b(on|off|true|false|up|down|connected|disconnected|enabled|disabled|active|inactive|yes|no|running|stopped|started)\b/i;
let checks = {};            // switch id -> { at, on, line } from its last status check
const checking = new Set(); // switch ids whose status check runs now
let checkTimer = null;

const switchNames = () => String(opts().switches || "").split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const isSwitch = (c) => !!c && (keeps(c) || switchNames().some((n) => n === c.id.toLowerCase() || n === nameOf(c).toLowerCase()));
const statusOf = (c) => (keeps(c) ? null : commands.find((x) => x !== c && !keeps(x) && !admin(x) && nameOf(x).trim().toLowerCase() === `${nameOf(c).trim().toLowerCase()} status`) || null);
/** A status script is part of its switch, not a row of its own. */
const isCheck = (x) => commands.some((c) => isSwitch(c) && statusOf(c) === x);

/** { on: true | false | null, line } from what a script printed. */
function parseState(text) {
  const line = lastLine(text);
  const m = STATE_WORD.exec(line);
  return { on: m ? ON.has(m[1].toLowerCase()) : null, line };
}

/** The switch's state: running for a script that keeps running, else the newer of its last good run and its last check. */
function switchState(c) {
  if (keeps(c)) {
    const s = services.get(c.id);
    return { on: !!(s && (s.running || s.restarting)), line: "", at: s?.since || 0 };
  }
  const r = lastRun(c.id), chk = checks[c.id];
  let src = r && r.kind === "ok" ? { at: r.at, ...parseState(r.stdout) } : null;
  if (chk && (!src || chk.at > src.at)) src = chk;
  return src || { on: null, line: "", at: 0 };
}

async function checkSwitch(c) {
  const st = statusOf(c);
  if (!st || checking.has(c.id) || running.has(c.id) || running.has(st.id)) return;
  checking.add(c.id);
  try {
    const r = await umbra.run(st.id);
    checks[c.id] = r.exitCode === 0 && !r.timedOut && !r.stopped
      ? { at: Date.now(), ...parseState(r.stdout) }
      : { at: Date.now(), on: null, line: `Status check failed${r.exitCode != null ? ` (exit ${r.exitCode})` : ""}` };
  } catch (err) {
    // Not approved yet (or gone): leave the state from the last run alone.
    console.warn("Script Runner: status check", nameOf(st), err);
  } finally {
    checking.delete(c.id);
  }
  umbra.store.set("checks", checks).catch(() => {});
  render();
}

function checkAll() {
  if (document.hidden) return;
  for (const c of commands) if (isSwitch(c) && statusOf(c)) checkSwitch(c);
}

function setupChecks() {
  clearInterval(checkTimer); checkTimer = null;
  if (!commands.some((c) => isSwitch(c) && statusOf(c))) return;
  const secs = Math.max(15, Number(opts().checkSeconds) || 60);
  checkTimer = setInterval(checkAll, secs * 1000);
}

/** Click on a switch: start or stop a script that keeps running, otherwise run the script (it does the switching). */
function flip(c) {
  if (keeps(c)) {
    const s = services.get(c.id);
    if (s && (s.running || s.restarting)) stopScript(c.id); else startService(c);
    return;
  }
  runScript(c.id);
}

// ---------- automatic runs ----------

/** The option names a script by its name or its id. */
function autoId() {
  const want = String(opts().autoScript || "").trim().toLowerCase();
  if (!want) return "";
  const c = commands.find((x) => x.id === want) || commands.find((x) => nameOf(x).toLowerCase() === want);
  return c ? c.id : "";
}

function updateKeepAlive() {
  umbra.keepAlive?.(!!autoTimer || running.size > 0);
}

function setupAuto() {
  clearInterval(autoTimer); autoTimer = null;
  const id = autoId();
  const c = commands.find((x) => x.id === id);
  // A script that keeps running has its own "Start automatically" switch in Settings; one that runs as administrator only runs on a click.
  if (!c || keeps(c) || admin(c)) { updateKeepAlive(); return; }
  const mins = Math.max(1, Number(opts().everyMinutes) || 15);
  autoTimer = setInterval(() => { if (canAuto(id)) runScript(id); }, mins * 60000);
  updateKeepAlive();
}

/**
 * Background runs can't open the approval prompt. Your own scripts are approved when you save them in Settings, so they
 * run unless the last try needed approval; a widget.json command only repeats after it ran with the button.
 */
function canAuto(id) {
  const last = lastRun(id), c = commands.find((x) => x.id === id);
  if (c && keeps(c) && services.get(id)?.running) return false;
  if (admin(c)) return false; // Umbra refuses it without a click, and it would raise a Windows prompt out of nowhere
  if (c && c.user) return !last || last.kind !== "warn";
  return !!last && last.kind !== "warn" && last.kind !== "error";
}

// ---------- rendering ----------

function subtitle(c) {
  if (isSwitch(c) && !keeps(c)) {
    if (running.has(c.id)) return { text: `Switching… ${fmtMs(Date.now() - running.get(c.id))}`, cls: "" };
    const r = lastRun(c.id), st = switchState(c);
    if (r && r.kind === "warn") return { text: "Needs your approval", cls: "warn" };
    if (r && r.at > st.at && r.kind !== "ok" && r.kind !== "stopped" && r.kind !== "cancelled")
      return { text: `${r.exitCode != null ? `Failed · exit ${r.exitCode}` : "Could not run"} · ${ago(r.at)}`, cls: "bad" };
    if (!st.at) return { text: c.description || "Click the switch to run it", cls: "" };
    return { text: `${st.line || (st.on ? "On" : st.on === false ? "Off" : "Unknown")} · ${ago(st.at)}`, cls: st.on ? "live" : st.on === null ? "warn" : "" };
  }
  if (keeps(c)) {
    const s = services.get(c.id), r = lastRun(c.id);
    if (s && s.running) return { text: `Running · ${fmtMs(Date.now() - s.since)}${s.restarts ? ` · restarted ${s.restarts}×` : ""}`, cls: "live" };
    if (s && s.restarting) return { text: `Stopped${s.exitCode != null ? ` (exit ${s.exitCode})` : ""} · restarting`, cls: "warn" };
    if (r && r.kind === "warn" && Date.now() - r.at < 60000) return { text: "Needs your approval", cls: "warn" };
    if (r && r.kind === "error" && Date.now() - r.at < 60000) return { text: "Could not start", cls: "bad" };
    if (s && s.exitCode != null) return stoppedByUser(s) ? { text: "Stopped", cls: "" } : { text: `Stopped · exit ${s.exitCode}`, cls: s.exitCode === 0 ? "" : "bad" };
    return { text: c.description || "Keeps running · not started", cls: "" };
  }
  if (running.has(c.id)) return { text: `Running ${fmtMs(Date.now() - running.get(c.id))}`, cls: "" };
  const r = lastRun(c.id);
  if (!r) return { text: c.description || "Never run", cls: "" };
  const when = ago(r.at);
  switch (r.kind) {
    case "ok": return { text: `Exit 0 · ${fmtMs(r.ms)} · ${when}`, cls: "" };
    case "fail": return { text: `Exit ${r.exitCode} · ${fmtMs(r.ms)} · ${when}`, cls: "bad" };
    case "timeout": return { text: `Timed out after ${fmtMs(r.ms)} · ${when}`, cls: "bad" };
    case "stopped": return { text: `Stopped after ${fmtMs(r.ms)} · ${when}`, cls: "" };
    case "cancelled": return { text: `Cancelled · ${when}`, cls: "" };
    case "warn": return { text: "Needs your approval", cls: "warn" };
    default: return { text: `Could not run · ${when}`, cls: "bad" };
  }
}

function dotClass(c) {
  if (isSwitch(c) && !keeps(c)) return running.has(c.id) ? "run" : switchState(c).on ? "live" : "";
  if (keeps(c)) {
    const s = services.get(c.id);
    if (!s) return "";
    return s.running ? "live" : s.restarting ? "warn" : s.exitCode != null && s.exitCode !== 0 && !stoppedByUser(s) ? "fail" : "";
  }
  if (running.has(c.id)) return "run";
  const r = lastRun(c.id);
  if (!r) return "";
  return r.kind === "ok" && r.truncated ? "warn" : r.kind === "stopped" || r.kind === "cancelled" ? "" : r.kind;
}

/** The button: Run, or Stop while it runs. (A script that keeps running has a switch instead.) */
function button(c) {
  if (keeps(c)) {
    const s = services.get(c.id), on = !!(s && (s.running || s.restarting));
    return on ? { label: "Stop", act: "stop", cls: "stop", disabled: !canStop } : { label: "Start", act: "run", cls: "", disabled: false };
  }
  if (running.has(c.id)) return canStop ? { label: "Stop", act: "stop", cls: "stop", disabled: false } : { label: "Running", act: "", cls: "", disabled: true };
  return { label: "Run", act: "run", cls: "", disabled: false };
}

function renderList() {
  if (loadError) { listEl.innerHTML = `<div class="empty">${esc(loadError)}</div>`; return; }
  if (!commands.length) {
    listEl.innerHTML = `<div class="empty">No scripts yet. Add one in Settings: My widgets, Script Runner, Add script. There are examples to start from.</div>`;
    return;
  }
  listEl.innerHTML = commands.filter((c) => !isCheck(c)).map((c) => {
    const s = subtitle(c), b = button(c), sw = isSwitch(c);
    let control = `<button class="go ${b.cls}" data-act="${b.act}" data-cmd="${esc(c.id)}" ${b.disabled ? "disabled" : ""}>${b.label}</button>`;
    if (sw) {
      const st = switchState(c);
      const busy = running.has(c.id) || (keeps(c) && !!services.get(c.id)?.restarting);
      const label = `${nameOf(c)}: ${st.on ? "on" : st.on === false ? "off" : "unknown"}`;
      control = `<button class="switch${st.on ? " on" : ""}${st.on === null ? " unknown" : ""}${busy ? " busy" : ""}" role="switch" aria-checked="${st.on === true}"
        aria-label="${esc(label)}" title="${esc(label)}" data-act="flip" data-cmd="${esc(c.id)}" ${busy || (keeps(c) && st.on && !canStop) ? "disabled" : ""}><span class="knob"></span></button>`;
    }
    const tags = `${keeps(c) && !sw ? '<span class="tag">keeps running</span>' : ""}${admin(c) ? '<span class="tag">admin</span>' : ""}`;
    return `<div class="row${c.id === selected ? " sel" : ""}${sw ? " is-switch" : ""}" data-id="${esc(c.id)}">
      <span class="dot ${dotClass(c)}"></span>
      <div class="info"><div class="name">${esc(nameOf(c))}${tags}</div><div class="sub num ${s.cls}">${esc(s.text)}</div></div>
      ${control}
    </div>`;
  }).join("");
}

function outMeta() {
  const c = commands.find((x) => x.id === selected);
  if (!c) return "";
  if (keeps(c)) {
    const s = services.get(c.id);
    return s && s.running ? `since ${clock(s.since)}` : "";
  }
  if (running.has(c.id)) return `running ${fmtMs(Date.now() - running.get(c.id))}`;
  const r = lastRun(c.id);
  if (!r) return "";
  return r.exitCode == null ? ago(r.at) : `exit ${r.exitCode} · ${fmtMs(r.ms)} · ${clock(r.at)}`;
}

/** What the Copy button copies: the output shown, in full (not cut to the line limit). */
let copyText = "";

const ICON_COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 3.2l3.6 3.6-5.6 5.7H4.6l-2-2a1 1 0 0 1 0-1.4z"/><path d="M6.4 6l3.6 3.6M8.6 12.5h4.9"/></svg>';
const ICON_DONE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>';

/** http(s) links in the output; trailing punctuation and an unmatched closing bracket stay outside, as in "(see https://x.y/z).". */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
function trimUrl(u) {
  const closers = { ")": "(", "]": "[", "}": "{" };
  const n = (s, ch) => s.split(ch).length - 1;
  while (u) {
    const ch = u[u.length - 1];
    if (/[.,;:!?*]/.test(ch) || (closers[ch] && n(u, ch) > n(u, closers[ch]))) u = u.slice(0, -1);
    else break;
  }
  return u;
}
const isWebUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !!x.hostname && u.length <= 2048; } catch { return false; } };

/** Escaped output text with each web link made clickable (opens in the browser) and a copy icon after it. */
function linkify(text) {
  text = String(text);
  let html = "", at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (m.index < at || !isWebUrl(url)) continue;
    html += esc(text.slice(at, m.index))
      // The last character and the copy icon share a no-wrap span, so the icon never lands on a line of its own.
      + `<a class="link" role="link" tabindex="0" data-url="${esc(url)}" title="Open in your browser">${esc(url.slice(0, -1))}<span class="tail">${esc(url.slice(-1))}`
      + `<button type="button" class="url-copy" data-copy="${esc(url)}" title="Copy link" aria-label="Copy link">${ICON_COPY}</button></span></a>`;
    at = m.index + url.length;
  }
  return html + esc(text.slice(at));
}

/** Rewrite the log only when it changed, so a hover, a click or a text selection in it survives the once-a-second refresh. */
let logHtml = null;
function setLog(html) {
  if (html === logHtml) return;
  logHtml = html;
  logEl.innerHTML = html;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    // Without the async clipboard: copy through a hidden text box.
    const t = Object.assign(document.createElement("textarea"), { value: text });
    t.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

/** A check mark on the button for a moment (or "Couldn't copy" in its tooltip). */
function flash(btn, ok) {
  const title = btn.dataset.title || (btn.dataset.title = btn.title);
  btn.innerHTML = ok ? ICON_DONE : ICON_COPY;
  btn.classList.toggle("done", ok);
  btn.title = ok ? "Copied" : "Couldn't copy";
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.innerHTML = ICON_COPY; btn.classList.remove("done"); btn.title = title; }, 1400);
}

function renderOutput() {
  const c = commands.find((x) => x.id === selected);
  bigEl.hidden = true;
  $("out-meta").textContent = outMeta();
  copyText = "";
  if (!c) {
    $("out-name").textContent = "Output";
    setLog(commands.length ? '<span class="dim">Press Run on a script to see its output here.</span>' : "");
    renderHistory(null);
    copyBtn.hidden = clearBtn.hidden = true;
    return;
  }
  $("out-name").textContent = nameOf(c);
  const n = Math.max(5, Math.min(200, Number(opts().outputLines) || 40));
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;

  // Live: a run in progress, or a script that keeps running (its newest lines, kept scrolled to the end).
  const svc = keeps(c) ? services.get(c.id) : null;
  const liveText = live && live.id === c.id ? live.text : svc ? svc.text || "" : null;
  if (running.has(c.id) || (svc && liveText)) {
    const shown = afterClear(c.id, sinceOf(c), liveText);
    const t = trimLines(shown.text, n, true);
    copyText = shown.text;
    const waiting = !shown.cleared ? "Waiting for output..." : running.has(c.id) || svc?.running ? "Output cleared. New output shows here." : "Output cleared.";
    setLog((t.cut ? `<span class="dim">... ${t.cut} earlier line${t.cut > 1 ? "s" : ""}</span>\n` : "")
      + (t.text ? linkify(t.text).replace(/^\[Umbra\] .*$/gm, (l) => `<span class="dim">${l}</span>`) : `<span class="dim">${waiting}</span>`));
    if (atBottom || first) logEl.scrollTop = logEl.scrollHeight;
    copyBtn.hidden = !copyText;
    clearBtn.hidden = !t.text;
    renderHistory(keeps(c) ? null : c);
    return;
  }

  const r = lastRun(c.id);
  if (!r || keeps(c)) {
    const msg = r && r.note ? `<span class="note">${esc(r.note)}</span>`
      : `<span class="dim">${esc(c.description || (keeps(c) ? "Turn the switch on. It keeps running until you turn it off or turn the widget off." : "Never run."))}</span>`;
    setLog(msg);
    renderHistory(null);
    copyBtn.hidden = clearBtn.hidden = true;
    return;
  }
  const out = trimLines(r.stdout, n), err = trimLines(r.stderr, Math.max(3, Math.floor(n / 4)));
  let html = "";
  if (r.note) html += `<span class="note">${esc(r.note)}</span>\n`;
  if (out.text) html += linkify(out.text) + (out.cut ? `\n<span class="dim">... ${out.cut} more line${out.cut > 1 ? "s" : ""}</span>` : "") + "\n";
  if (err.text) html += `<span class="err">${linkify(err.text)}</span>` + (err.cut ? `\n<span class="dim">... ${err.cut} more error line${err.cut > 1 ? "s" : ""}</span>` : "") + "\n";
  if (!out.text && !err.text && !r.note) html = `<span class="dim">${r.cleared ? "Output cleared." : "(no output)"}</span>`;
  setLog(html);
  copyText = [r.stdout, r.stderr].filter((s) => s && s.trim()).join("\n");
  copyBtn.hidden = !copyText;
  clearBtn.hidden = !copyText && !r.note;
  if (opts().bigLine && r.kind === "ok" && lastLine(r.stdout)) { bigEl.textContent = lastLine(r.stdout); bigEl.hidden = false; }
  renderHistory(c);
}

/** Earlier runs of a script that finishes: when, how it ended, how long. */
function renderHistory(c) {
  const runs = c ? (results[c.id] || []).slice(1) : [];
  histEl.hidden = !runs.length;
  if (!runs.length) { histEl.innerHTML = ""; return; }
  histEl.innerHTML = `<div class="hist-title">Earlier runs</div>` + runs.map((r) => {
    const label = r.kind === "ok" ? "exit 0" : r.kind === "fail" ? `exit ${r.exitCode}` : r.kind === "timeout" ? "timed out"
      : r.kind === "stopped" ? "stopped" : r.kind === "cancelled" ? "cancelled" : r.kind === "warn" ? "needs approval" : "could not run";
    const dot = r.kind === "ok" ? "ok" : r.kind === "stopped" || r.kind === "cancelled" ? "" : r.kind === "warn" ? "warn" : "fail";
    return `<div class="hist num"><span class="dot ${dot}"></span><span class="hist-when">${esc(ago(r.at))}</span><span class="hist-what">${esc(label)}</span><span class="hist-ms">${esc(fmtMs(r.ms || 0))}</span></div>`;
  }).join("");
}

function render() {
  $("title").textContent = String(opts().title || "Scripts");
  const shown = commands.filter((c) => !isCheck(c)).length;
  $("count").textContent = shown ? `${shown} script${shown > 1 ? "s" : ""}` : "";
  renderList();
  renderOutput();
  if (!dragFrom) fitSplit();
  if (first) { first = false; requestAnimationFrame(() => umbra.rendered()); }
}

/** Once a second: update only the text of the time labels (so a click in progress is never interrupted), and live output. */
function tick() {
  if (document.hidden) return;
  for (const row of listEl.querySelectorAll(".row")) {
    const c = commands.find((x) => x.id === row.dataset.id);
    if (c) row.querySelector(".sub").textContent = subtitle(c).text;
  }
  $("out-meta").textContent = outMeta();
  poll();
}

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (btn) {
    // A click is the one moment Umbra may ask whether this widget can notify; it answers at once once you've decided.
    if (String(opts().notify || "fail") !== "never" && typeof umbra.requestNotifications === "function")
      umbra.requestNotifications().catch(() => {});
    if (btn.dataset.act === "run") runScript(btn.dataset.cmd);
    else if (btn.dataset.act === "stop") stopScript(btn.dataset.cmd);
    else if (btn.dataset.act === "flip") { const c = commands.find((x) => x.id === btn.dataset.cmd); if (c) flip(c); }
    return;
  }
  const row = e.target.closest(".row");
  if (row) { selected = row.dataset.id; live = null; saveUi(); render(); poll(); }
});

copyBtn.innerHTML = ICON_COPY;
clearBtn.innerHTML = ICON_CLEAR;
clearBtn.addEventListener("click", clearOutput);
copyBtn.addEventListener("click", async () => {
  if (copyText) flash(copyBtn, await copy(copyText));
});

// Links in the output: a click opens it in the browser (not while editing the layout, and not at the end of a text selection).
function openLink(a) {
  if (umbra.settings?.editMode || !getSelection().isCollapsed) return;
  umbra.openUrl(a.dataset.url);
}
logEl.addEventListener("click", async (e) => {
  const cp = e.target.closest(".url-copy");
  if (cp) { flash(cp, await copy(cp.dataset.copy)); return; }
  const a = e.target.closest(".link");
  if (a) openLink(a);
});
logEl.addEventListener("keydown", (e) => {
  const a = e.target.closest?.(".link");
  if (a && e.key === "Enter" && !e.target.closest(".url-copy")) { e.preventDefault(); openLink(a); }
});

setInterval(tick, 1000);

(async () => {
  await umbra.ready;
  await Promise.all([loadCommands(), loadState()]);
  if (!selected || !commands.some((c) => c.id === selected && !isCheck(c))) selected = commands.find((c) => !isCheck(c))?.id ?? null;
  render();
  setupAuto();
  setupChecks();
  checkAll();
  // Back on screen after a while (a hidden tab, a covered desktop): check the switches again.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 30000) checkAll();
  });
  const id = autoId();
  if (opts().runOnStart && id && canAuto(id)) runScript(id);
  let switchOpt = String(opts().switches || "");
  umbra.onSettings(() => {
    render(); setupAuto(); setupChecks();
    // A switch just named in the options: check it now instead of after the first interval.
    if (String(opts().switches || "") !== switchOpt) { switchOpt = String(opts().switches || ""); checkAll(); }
  });
  // A script added, edited or deleted in Settings, or one that keeps running started or stopped, shows up at once.
  if (umbra.onCommandsChange) umbra.onCommandsChange(async () => {
    await loadCommands();
    if (!commands.some((c) => c.id === selected && !isCheck(c))) { selected = commands.find((c) => !isCheck(c))?.id ?? null; saveUi(); }
    if (live && !running.has(live.id) && !services.get(live.id)?.running) live = null;
    render(); setupAuto(); setupChecks();
  });
  umbra.store.onChange(async () => { await loadState(); render(); });
})();
