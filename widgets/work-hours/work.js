// Work Hours: a timer and timesheet for a job with weekly hours. Rules in hours.js (WorkHours); this file is the page.
// umbra.store: "entries" [{ id, s, e, note }], "running" { start, note } | null, "alerts" (which toasts were shown this week).
(() => {
  "use strict";
  const W = window.WorkHours;
  const { MIN, HOUR } = W;
  const $ = (id) => document.getElementById(id);
  const app = $("app");

  let entries = [];
  let running = null;
  let seen = null;
  let viewWs = 0;        // first day of the week on screen
  let selDay = 0;        // day whose entries are listed
  let showHist = false;
  let first = true;
  let notedOnce = false; // the first alert check after loading is quiet (crossings while Umbra was closed get no toast)

  const opts = () => umbra.options || {};
  const startDay = () => String(opts().weekStart || "monday");
  const targetMs = () => Math.max(1, Number(opts().weeklyHours) || 20) * HOUR;
  const loc = () => umbra.locale || undefined;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (ts, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(ts).toLocaleDateString(loc(), o);
  const fmtDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtClock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const hoursLabel = (ms) => { const h = ms / HOUR; return `${Number.isInteger(h) ? h : h.toFixed(1)}h`; };

  // ---------- storage ----------
  const lastSaved = {};
  function save(key, value) {
    lastSaved[key] = JSON.stringify(value ?? null);
    umbra.store.set(key, value).catch((e) => { console.error("Work Hours: could not save", e); showToast("Could not save"); });
  }
  const saveEntries = () => { entries = W.prune(entries, Date.now()); save("entries", entries); };
  const saveRunning = () => save("running", running);

  async function load() {
    const e = await umbra.store.get("entries", []);
    entries = Array.isArray(e) ? e.filter(W.valid).map((x) => ({ id: String(x.id || newId()), s: x.s, e: x.e, note: String(x.note || "") })) : [];
    const r = await umbra.store.get("running", null);
    running = r && Number.isFinite(r.start) ? { start: r.start, note: String(r.note || "") } : null;
    const a = await umbra.store.get("alerts", null);
    seen = a && typeof a === "object" ? a : null;
  }
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ---------- timer ----------
  function start() {
    if (running) return;
    // A click is the one moment Umbra may ask whether this widget can notify.
    if (opts().notify !== false && typeof umbra.requestNotifications === "function") umbra.requestNotifications().catch(() => {});
    running = { start: Date.now(), note: $("note").value.trim() };
    saveRunning();
    jumpToToday();
    sync();
  }
  function stop() {
    if (!running) return;
    const now = Date.now();
    const entry = { id: newId(), s: running.start, e: now, note: running.note || $("note").value.trim() };
    running = null;
    saveRunning();
    if (entry.e - entry.s >= 1000) { entries.push(entry); saveEntries(); }
    $("note").value = "";
    if (entry.e - entry.s < MIN) showToast("Under a minute, saved anyway", "Remove", () => removeEntry(entry.id, false));
    sync();
  }
  function discard() {
    if (!running) return;
    const was = running;
    running = null;
    saveRunning();
    sync();
    showToast("Timer discarded", "Undo", () => { if (!running) { running = was; saveRunning(); sync(); } });
  }

  // ---------- rendering ----------
  const C = 2 * Math.PI * 52;

  function weekLabel(ws) {
    const cur = W.weekStart(Date.now(), startDay());
    if (ws === cur) return "This week";
    if (ws === W.addDays(cur, -7)) return "Last week";
    if (ws === W.addDays(cur, 7)) return "Next week";
    const end = W.addDays(ws, 6);
    const sameMonth = new Date(ws).getMonth() === new Date(end).getMonth();
    return `${fmtDay(ws, { day: "numeric", month: "short" })} – ${fmtDay(end, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })}`;
  }

  function weekNumbers(ws, now) {
    const base = targetMs();
    const carry = opts().carryOver ? W.balance(entries, ws, base, startDay()) : 0;
    const target = Math.max(0, base - carry);
    const workedMs = W.worked(entries, running, now, ws, W.addDays(ws, 7));
    const today = W.dayStart(now);
    const todayMs = W.worked(entries, running, now, today, W.addDays(today, 1));
    const st = W.status({ workedMs, targetMs: target, now, ws, workdays: String(opts().workdays || "mon-fri"), warnMs: Math.max(0, Number(opts().warnMinutes) || 0) * MIN, todayMs });
    return { base, carry, target, workedMs, todayMs, st };
  }

  /** What to do today and after, from the even split of what's left over the workdays left (today included). */
  function paceText(st, todayMs, now) {
    const work = W.WORKDAYS[String(opts().workdays || "mon-fri")] || W.WORKDAYS["mon-fri"];
    const days = (n) => `${n} workday${n > 1 ? "s" : ""}`;
    if (st.daysLeft === 0) return "No workdays left this week";
    if (!work.includes(new Date(now).getDay())) return `≈ ${W.words(st.perDay)} a day over the next ${days(st.daysLeft)}`;
    const todayLeft = st.perDay - todayMs;
    if (st.daysLeft === 1 || st.left <= 45 * MIN) return running ? "Keep going and you're done for the week" : `Today: ${W.words(st.left)} more and you're done`;
    if (todayLeft >= MIN) return `Today: ${W.words(todayLeft)} more, then ≈ ${W.words(st.perDay)} a day`;
    return `Today's share is done. Then ≈ ${W.words(st.left / (st.daysLeft - 1))} a day for ${days(st.daysLeft - 1)}`;
  }

  function render() {
    const now = Date.now();
    const curWs = W.weekStart(now, startDay());
    if (!viewWs) viewWs = curWs;
    if (!selDay) selDay = W.dayStart(now);
    const isCur = viewWs === curWs;
    const n = weekNumbers(viewWs, now);

    $("week").textContent = weekLabel(viewWs);
    $("week").classList.toggle("off", !isCur);
    $("next").disabled = viewWs >= curWs;
    app.dataset.state = n.st.state;

    // Ring: one lap is the target; overtime draws a second, red lap on top.
    const p = Math.min(1, n.st.progress), over = Math.min(1, Math.max(0, n.st.progress - 1));
    $("arc").style.strokeDasharray = `${C}`;
    $("arc").style.strokeDashoffset = `${C * (1 - p)}`;
    $("arc-over").style.strokeDasharray = `${C}`;
    $("arc-over").style.strokeDashoffset = `${C * (1 - over)}`;
    $("worked").textContent = W.hm(n.workedMs);
    $("of").textContent = `of ${hoursLabel(n.target)}`;

    const st = n.st;
    let left, pace = "";
    if (st.left > 0) {
      left = `${W.words(st.left)} to go`;
      if (isCur) {
        pace = paceText(st, n.todayMs, now);
      } else if (viewWs < curWs) { left = `${W.words(st.left)} short`; pace = "Missed the target"; }
    } else if (st.state === "reached") {
      left = "Target reached";
      pace = isCur && running ? "Stop now to keep it at the target" : "Right on target";
    } else {
      left = `${W.delta(st.over)} overtime`;
      pace = isCur && running ? "You're past your hours: stop the timer" : `${W.words(st.over)} more than planned`;
    }
    $("left").textContent = left;
    $("pace").textContent = pace;
    const carryEl = $("carry");
    carryEl.hidden = !opts().carryOver || Math.abs(n.carry) < MIN;
    if (!carryEl.hidden) carryEl.textContent = n.carry > 0 ? `${W.delta(n.carry)} from earlier weeks` : `${W.hm(-n.carry)} owed from earlier weeks`;

    renderTimer(now, n);
    renderDays(now, n);
    renderEntries(now);
    if (showHist) renderHistory(now);
    if (first) { first = false; requestAnimationFrame(() => umbra.rendered()); }
  }

  function renderTimer(now, n) {
    app.classList.toggle("running", !!running);
    $("go-label").textContent = running ? "Stop" : "Start";
    $("go").setAttribute("aria-label", running ? "Stop the timer" : "Start the timer");
    $("discard").hidden = !running;
    $("since").hidden = !running;
    if (running) {
      $("since").textContent = `since ${fmtTime(running.start)}`;
      $("clock").textContent = W.hms(now - running.start);
      $("clock").classList.remove("idle");
    } else {
      $("clock").textContent = `Today ${W.hm(n.todayMs)}`;
      $("clock").classList.add("idle");
    }
    const note = $("note");
    if (running && document.activeElement !== note && note.value !== running.note) note.value = running.note;
  }

  function renderDays(now, n) {
    const days = W.byDay(entries, running, now, viewWs);
    const work = W.WORKDAYS[String(opts().workdays || "mon-fri")] || W.WORKDAYS["mon-fri"];
    const goal = n.base / Math.max(1, work.length);
    const top = Math.max(goal * 1.25, ...days.map((d) => d.ms), HOUR);
    const today = W.dayStart(now);
    if (selDay < viewWs || selDay >= W.addDays(viewWs, 7)) selDay = viewWs <= today && today < W.addDays(viewWs, 7) ? today : viewWs;
    $("days").innerHTML = days.map((d) => {
      const dow = new Date(d.start).getDay();
      const cls = [d.start === selDay ? "sel" : "", d.start === today ? "today" : "", work.includes(dow) ? "" : "rest", d.start > today ? "future" : ""].join(" ");
      const h = d.ms ? Math.max(4, Math.round((d.ms / top) * 100)) : 0;
      const name = fmtDay(d.start, { weekday: "short" }).slice(0, 2);
      return `<button type="button" class="day ${cls}" data-day="${d.start}" title="${esc(fmtDay(d.start))}: ${W.hm(d.ms)}">
        <span class="bar"><span class="goal" style="bottom:${Math.round((goal / top) * 100)}%"></span><span class="fill" style="height:${h}%"></span></span>
        <span class="dn">${esc(name)}</span><span class="dh num">${d.ms ? W.hm(d.ms) : "–"}</span></button>`;
    }).join("");
  }

  function renderEntries(now) {
    const today = W.dayStart(now);
    const list = W.entriesOn(entries, selDay);
    const dayEnd = W.addDays(selDay, 1);
    const runHere = running && running.start < dayEnd && now > selDay;
    const total = W.worked(entries, running, now, selDay, dayEnd);
    $("day-title").textContent = selDay === today ? "Today" : selDay === W.addDays(today, -1) ? "Yesterday" : fmtDay(selDay);
    $("day-total").textContent = total ? W.hm(total) : "";
    $("add").hidden = selDay > today;
    const rows = list.map((x) => {
      const cross = x.s < selDay || x.e > dayEnd;
      return `<button type="button" class="entry" data-id="${esc(x.id)}" title="Edit">
        <span class="span num">${fmtTime(x.s)} – ${fmtTime(x.e)}${cross ? '<span class="cross" title="Crosses midnight">↷</span>' : ""}</span>
        <span class="en">${x.note ? esc(x.note) : '<span class="dim">No note</span>'}</span>
        <span class="ed num">${W.hm(x.e - x.s)}</span></button>`;
    });
    if (runHere) rows.push(`<button type="button" class="entry live" data-run="1" title="Change when it started">
        <span class="span num">${fmtTime(running.start)} – now</span>
        <span class="en">${running.note ? esc(running.note) : '<span class="dim">Running</span>'}</span>
        <span class="ed num">${W.hm(now - running.start)}</span></button>`);
    $("entries").innerHTML = rows.length ? rows.join("")
      : `<div class="empty">${selDay > today ? "Nothing yet." : selDay === today ? "No time today yet. Press Start, or add time you forgot." : "No time this day."}</div>`;
  }

  function renderHistory(now) {
    const cur = W.weekStart(now, startDay());
    const base = targetMs();
    const oldest = entries.length ? W.weekStart(Math.min(...entries.map((x) => x.s)), startDay()) : cur;
    const rows = [];
    let sum = 0, counted = 0;
    for (let ws = cur, i = 0; ws >= oldest && i < 26; ws = W.addDays(ws, -7), i++) {
      const ms = W.worked(entries, running, now, ws, W.addDays(ws, 7));
      const d = ms - base;
      if (ws !== cur && ms > 0) { sum += d; counted++; }
      const p = Math.min(1.25, ms / base);
      const cls = ws === cur ? "cur" : !ms ? "none" : Math.abs(d) <= 5 * MIN ? "ok" : d > 0 ? "over" : "short";
      rows.push(`<button type="button" class="wk ${cls}" data-ws="${ws}">
        <span class="wk-n num">${esc(weekLabel(ws))}</span>
        <span class="wk-bar"><span style="width:${(p / 1.25) * 100}%"></span><i style="left:${100 / 1.25}%"></i></span>
        <span class="wk-h num">${W.hm(ms)}</span>
        <span class="wk-d num">${ws === cur ? "" : ms ? W.delta(d) : "—"}</span></button>`);
    }
    const avg = counted ? (sum / counted) : 0;
    $("history").innerHTML = `<div class="hist-head"><span>Earlier weeks</span><span class="num">${counted ? `Balance ${W.delta(sum)} · avg ${W.delta(avg)}/week` : ""}</span></div>
      <div class="wks">${rows.join("")}</div>`;
  }

  // ---------- entry editor ----------
  let editing = null; // { mode: "add" | "edit" | "running", id? }

  function openSheet(mode, id) {
    editing = { mode, id };
    const x = mode === "edit" ? entries.find((e) => e.id === id) : null;
    const now = Date.now();
    $("sheet-title").textContent = mode === "add" ? "Add time" : mode === "edit" ? "Edit time" : "Started at";
    $("f-del").hidden = mode !== "edit";
    $("f-end-wrap").hidden = $("f-dur-wrap").hidden = $("f-note-wrap").hidden = mode === "running";
    $("f-err").hidden = true;
    let s, e, note = "";
    if (x) ({ s, e, note } = x);
    else if (mode === "running") s = running.start;
    else {
      // New time on the selected day: after its last entry, else 09:00; one hour long, never into the future.
      const last = W.entriesOn(entries, selDay).at(-1);
      s = last && last.e < W.addDays(selDay, 1) ? last.e : W.dayStart(selDay) + 9 * HOUR;
      if (s > now - HOUR && selDay === W.dayStart(now)) s = Math.max(W.dayStart(now), now - HOUR);
      e = s + HOUR;
    }
    $("f-date").value = fmtDate(s);
    $("f-start").value = fmtClock(s);
    $("f-end").value = e ? fmtClock(e) : "";
    $("f-dur").value = "";
    $("f-note").value = note || "";
    $("sheet").hidden = false;
    requestAnimationFrame(() => $(mode === "running" ? "f-start" : "f-start").focus());
  }
  function closeSheet() { $("sheet").hidden = true; editing = null; }

  /** A local date ("2026-11-23") plus a time ("09:30") as epoch ms. */
  function at(date, time) {
    const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
    if (![y, mo, d, h, mi].every(Number.isFinite)) return NaN;
    return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  }
  function formError(msg) { $("f-err").textContent = msg; $("f-err").hidden = false; }

  function saveSheet(ev) {
    ev.preventDefault();
    if (!editing) return;
    const now = Date.now();
    const s = at($("f-date").value, $("f-start").value);
    if (!Number.isFinite(s)) return formError("Pick a day and a start time.");
    if (editing.mode === "running") {
      if (!running) return closeSheet();
      if (s >= now) return formError("That's in the future.");
      const clash = entries.find((x) => x.e > s && x.s < now);
      if (clash) return formError(`That overlaps ${fmtTime(clash.s)} – ${fmtTime(clash.e)}.`);
      running.start = s; saveRunning(); closeSheet(); sync(); return;
    }
    let e;
    const durText = $("f-dur").value.trim();
    if (durText) {
      const d = W.parseDuration(durText);
      if (!d) return formError("Write the length like 1:30, 2h or 45m.");
      e = s + d;
    } else {
      e = at($("f-date").value, $("f-end").value);
      if (!Number.isFinite(e)) return formError("Add an end time or how long it was.");
      if (e <= s) e = W.addDays(e, 1); // 22:00 – 01:00 ends the next day
    }
    if (e - s > 24 * HOUR) return formError("One entry can't be longer than 24 hours.");
    if (e > now + MIN) return formError("That ends in the future.");
    const others = entries.filter((x) => x.id !== editing.id);
    const clash = others.find((x) => x.s < e && x.e > s) || (running && running.start < e ? { s: running.start, e: now } : null);
    if (clash) return formError(`That overlaps ${fmtTime(clash.s)} – ${fmtTime(clash.e)}.`);
    const note = $("f-note").value.trim().slice(0, 120);
    if (editing.mode === "edit") {
      const x = entries.find((y) => y.id === editing.id);
      if (x) Object.assign(x, { s, e, note });
    } else entries.push({ id: newId(), s, e, note });
    saveEntries();
    selDay = W.dayStart(s);
    viewWs = W.weekStart(s, startDay());
    closeSheet();
    sync();
  }

  function removeEntry(id, undo = true) {
    const i = entries.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [gone] = entries.splice(i, 1);
    saveEntries();
    sync();
    if (undo) showToast(`Deleted ${W.hm(gone.e - gone.s)}`, "Undo", () => { if (!entries.some((x) => x.id === gone.id)) { entries.push(gone); saveEntries(); sync(); } });
  }

  // ---------- in-widget toast ----------
  let toastTimer = null;
  function showToast(text, act, fn) {
    $("toast-text").textContent = text;
    const b = $("toast-act");
    b.hidden = !act; b.textContent = act || "";
    b.onclick = () => { hideToast(); fn && fn(); };
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, act ? 6000 : 2200);
  }
  function hideToast() { $("toast").hidden = true; }

  // ---------- copy ----------
  async function copyWeek() {
    const text = W.sheet(entries, viewWs, fmtDate, fmtClock);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const t = Object.assign(document.createElement("textarea"), { value: text });
      t.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(t); t.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      t.remove();
    }
    showToast(ok ? "Timesheet copied. Paste it into a spreadsheet." : "Couldn't copy");
  }

  // ---------- toasts (Windows) ----------
  function checkAlerts() {
    const now = Date.now();
    const ws = W.weekStart(now, startDay());
    const n = weekNumbers(ws, now);
    const r = W.alerts({
      seen, ws, workedMs: n.workedMs, targetMs: n.target, running, now, quiet: !notedOnce,
      warnMs: Math.max(0, Number(opts().warnMinutes) || 0) * MIN,
      remindMs: Math.max(0, Number(opts().reminderHours) || 0) * HOUR,
    });
    notedOnce = true;
    if (JSON.stringify(r.seen) !== JSON.stringify(seen)) { seen = r.seen; save("alerts", seen); }
    if (opts().notify === false || typeof umbra.notify !== "function") return;
    for (const ev of r.events) {
      let msg;
      if (ev.type === "warn") msg = { title: `${W.words(ev.left)} left this week`, body: `You're at ${W.hm(n.workedMs)} of ${hoursLabel(n.target)}. Wrap up soon.` };
      else if (ev.type === "reached") msg = { title: `${hoursLabel(n.target)} done`, body: "That's your week. Stop the timer to keep it right on target.", actions: [{ id: "stop", label: "Stop timer" }] };
      else msg = { title: "Timer still running", body: `It has been running for ${W.words(ev.ms)}${running.note ? ` (${running.note})` : ""}. Still working?`, actions: [{ id: "stop", label: "Stop timer" }] };
      umbra.notify({ tag: `work-hours-${ev.type}`, ...msg }).catch(() => { /* switched off, or rate limited */ });
    }
  }

  // ---------- ticking ----------
  let ticker = null;
  function sync() {
    render();
    checkAlerts();
    umbra.keepAlive?.(!!running);
    clearInterval(ticker);
    // Each second while the clock runs; otherwise twice a minute so the day and week roll over on their own.
    ticker = setInterval(tick, running ? 1000 : 30000);
  }
  function tick() {
    if (running) checkAlerts();
    if (document.hidden) return;
    if (!$("sheet").hidden) { renderTimer(Date.now(), weekNumbers(viewWs, Date.now())); return; }
    render();
  }
  function jumpToToday() {
    viewWs = W.weekStart(Date.now(), startDay());
    selDay = W.dayStart(Date.now());
  }

  // ---------- events ----------
  $("go").addEventListener("click", () => (running ? stop() : start()));
  $("discard").addEventListener("click", discard);
  $("since").addEventListener("click", () => running && openSheet("running"));
  let noteTimer = null;
  $("note").addEventListener("input", () => {
    if (!running) return;
    running.note = $("note").value.trim().slice(0, 120);
    clearTimeout(noteTimer); noteTimer = setTimeout(saveRunning, 500);
  });
  $("note").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); running ? $("note").blur() : start(); } });
  $("prev").addEventListener("click", () => { viewWs = W.addDays(viewWs, -7); selDay = 0; render(); });
  $("next").addEventListener("click", () => { viewWs = W.addDays(viewWs, 7); selDay = 0; render(); });
  $("week").addEventListener("click", () => { jumpToToday(); render(); });
  $("copy").addEventListener("click", copyWeek);
  $("hist").addEventListener("click", () => {
    showHist = !showHist;
    $("hist").setAttribute("aria-pressed", String(showHist));
    $("main").hidden = showHist; $("history").hidden = !showHist;
    render();
  });
  $("history").addEventListener("click", (e) => {
    const b = e.target.closest(".wk");
    if (!b) return;
    viewWs = Number(b.dataset.ws); selDay = 0;
    $("hist").click();
  });
  $("days").addEventListener("click", (e) => {
    const b = e.target.closest(".day");
    if (b) { selDay = Number(b.dataset.day); render(); }
  });
  $("entries").addEventListener("click", (e) => {
    const b = e.target.closest(".entry");
    if (!b) return;
    if (b.dataset.run) openSheet("running"); else openSheet("edit", b.dataset.id);
  });
  $("add").addEventListener("click", () => openSheet("add"));
  $("form").addEventListener("submit", saveSheet);
  $("f-cancel").addEventListener("click", closeSheet);
  $("f-del").addEventListener("click", () => { const id = editing && editing.id; closeSheet(); if (id) removeEntry(id); });
  $("f-dur").addEventListener("input", () => { $("f-end").disabled = !!$("f-dur").value.trim(); });
  $("sheet").addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });

  (async () => {
    await umbra.ready;
    await load();
    sync();
    umbra.onSettings?.(() => sync());
    umbra.onTimeChanged?.(() => { jumpToToday(); sync(); });
    umbra.onNotificationAction?.(({ id }) => { if (id === "stop") stop(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
    // Changed from outside (umbractl data, MCP): reload, ignoring echoes of our own writes.
    umbra.store.onChange?.(async (k) => {
      if (k && k !== "entries" && k !== "running" && k !== "alerts") return;
      const keys = k ? [k] : ["entries", "running", "alerts"];
      const vals = await Promise.all(keys.map((x) => umbra.store.get(x, null)));
      if (keys.every((x, i) => JSON.stringify(vals[i] ?? null) === lastSaved[x])) return;
      await load();
      sync();
    });
  })();
})();
