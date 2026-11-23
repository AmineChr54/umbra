// Work Hours rules: pure functions, no DOM, no timers, the clock is passed in. Local time throughout (a week starts at
// local midnight of its first day), with Date arithmetic so a daylight-saving change never shifts a day boundary.
// Browser: window.WorkHours. Node: module.exports (tests/widgets/work-hours.test.mjs).
//
// An entry is { id, s, e, note } in epoch ms. The running timer is { start, note } and counts up to `now`.
// An entry that crosses midnight (or a week boundary) counts on each side for the part that falls there.
(function (root) {
  "use strict";

  const MIN = 60000, HOUR = 60 * MIN, DAY_MS = 24 * HOUR;
  const KEEP_DAYS = 400;
  const START_DAY = { sunday: 0, monday: 1, saturday: 6 };
  const WORKDAYS = { "mon-fri": [1, 2, 3, 4, 5], "mon-sat": [1, 2, 3, 4, 5, 6], all: [0, 1, 2, 3, 4, 5, 6] };

  const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };

  /** Local midnight of the first day of the week holding `ts`. */
  function weekStart(ts, startDay = "monday") {
    const first = START_DAY[startDay] ?? 1;
    const d = new Date(dayStart(ts));
    const back = (d.getDay() - first + 7) % 7;
    d.setDate(d.getDate() - back);
    return d.getTime();
  }
  /** The 7 day starts of the week beginning at `ws`, plus the end (start of the next week) as the 8th. */
  const weekDays = (ws) => Array.from({ length: 8 }, (_, i) => addDays(ws, i));

  /** Milliseconds of [s, e) that fall inside [a, b). */
  const overlap = (s, e, a, b) => Math.max(0, Math.min(e, b) - Math.max(s, a));

  /** All spans: the saved entries plus the running timer up to `now`. */
  function spans(entries, running, now) {
    const out = (entries || []).filter(valid).map((x) => ({ s: x.s, e: x.e }));
    if (running && Number.isFinite(running.start) && running.start < now) out.push({ s: running.start, e: now });
    return out;
  }
  /** Time worked inside [a, b). */
  const worked = (entries, running, now, a, b) => spans(entries, running, now).reduce((n, x) => n + overlap(x.s, x.e, a, b), 0);

  /** Per day of the week starting at `ws`: [{ start, ms }] x 7. */
  function byDay(entries, running, now, ws) {
    const d = weekDays(ws), all = spans(entries, running, now);
    return d.slice(0, 7).map((start, i) => ({ start, ms: all.reduce((n, x) => n + overlap(x.s, x.e, start, d[i + 1]), 0) }));
  }

  /** Entries (not the running timer) that touch the day starting at `ds`, oldest first. */
  function entriesOn(entries, ds) {
    const de = addDays(ds, 1);
    return (entries || []).filter((x) => valid(x) && x.s < de && x.e > ds).sort((x, y) => x.s - y.s);
  }

  const valid = (x) => !!x && Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s;

  /**
   * Over/under time carried in from earlier weeks: for each week before `ws` that has any time in it (an empty week is a
   * holiday, not 20 hours short), what was worked minus the target.
   */
  function balance(entries, ws, targetMs, startDay = "monday") {
    const list = (entries || []).filter(valid);
    if (!list.length) return 0;
    const first = weekStart(Math.min(...list.map((x) => x.s)), startDay);
    let total = 0;
    for (let w = first; w < ws; w = addDays(w, 7)) {
      const ms = worked(list, null, 0, w, addDays(w, 7));
      if (ms > 0) total += ms - targetMs;
    }
    return total;
  }

  /**
   * Where the week stands. `target` already includes any carry-over. Workdays left counts today while it's a workday.
   * state: "under" | "near" (within warnMs of the target) | "reached" (at it, up to 5 min over) | "over" | "way-over" (30 min+).
   */
  function status({ workedMs, targetMs, now, ws, workdays = "mon-fri", warnMs = 15 * MIN, todayMs = 0 }) {
    const days = WORKDAYS[workdays] || WORKDAYS["mon-fri"];
    const left = targetMs - workedMs;
    const today = dayStart(now);
    let daysLeft = 0;
    for (const d of weekDays(ws).slice(0, 7)) if (d >= today && days.includes(new Date(d).getDay())) daysLeft++;
    // Today's share: spread what's left over the remaining days counting what was already done today.
    const perDay = daysLeft > 0 ? Math.max(0, left + (days.includes(new Date(today).getDay()) ? todayMs : 0)) / daysLeft : 0;
    let state = "under";
    if (left <= 0) state = -left >= 30 * MIN ? "way-over" : -left > 5 * MIN ? "over" : "reached";
    else if (left <= warnMs) state = "near";
    return { left, over: Math.max(0, -left), daysLeft, perDay, state, progress: targetMs > 0 ? workedMs / targetMs : 0 };
  }

  /**
   * Which toasts are due. `seen` is what was already announced { week, warn, reached, remind } and comes back updated.
   * Only a running timer crosses a threshold; `quiet` (first look after a restart) marks crossings as seen without a toast.
   */
  function alerts({ seen, ws, workedMs, targetMs, warnMs, running, now, remindMs, quiet = false }) {
    const s = seen && seen.week === ws ? { ...seen } : { week: ws, warn: false, reached: false, remind: 0 };
    const out = [];
    const left = targetMs - workedMs;
    if (warnMs > 0 && !s.warn && left <= warnMs && left > 0) { s.warn = true; if (running && !quiet) out.push({ type: "warn", left }); }
    if (!s.reached && left <= 0) { s.reached = true; s.warn = true; if (running && !quiet) out.push({ type: "reached" }); }
    if (running && remindMs > 0 && now - running.start >= remindMs && s.remind !== running.start) {
      s.remind = running.start;
      if (!quiet) out.push({ type: "remind", ms: now - running.start });
    }
    return { seen: s, events: out };
  }

  /** 13:20 (h:mm, never days); negative values get a minus sign. */
  function hm(ms) {
    const neg = ms < 0;
    const m = Math.floor(Math.abs(ms) / MIN);
    return `${neg ? "−" : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  }
  /** 1:02:03 for a running clock. */
  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  /** "+0:25" / "−1:15" / "±0:00". */
  const delta = (ms) => (Math.abs(ms) < MIN ? "±0:00" : ms > 0 ? `+${hm(ms)}` : hm(ms));
  /** "6h 40m", "45m", "2h". */
  function words(ms) {
    const m = Math.round(Math.max(0, ms) / MIN);
    const h = Math.floor(m / 60), r = m % 60;
    return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
  }

  /** Parse "1:30", "1.5", "90m", "2h", "1h 15m" into ms; null when it isn't a duration. */
  function parseDuration(t) {
    t = String(t || "").trim().toLowerCase();
    let m;
    if ((m = /^(\d{1,3}):([0-5]?\d)$/.exec(t))) return (Number(m[1]) * 60 + Number(m[2])) * MIN;
    if ((m = /^(\d+(?:[.,]\d+)?)\s*h?$/.exec(t))) return Math.round(Number(m[1].replace(",", ".")) * HOUR);
    if ((m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(t)) && (m[1] || m[2])) return (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * MIN;
    return null;
  }

  /** Drop entries older than KEEP_DAYS, newest stay. */
  const prune = (entries, now) => (entries || []).filter((x) => valid(x) && x.e > now - KEEP_DAYS * DAY_MS);

  /** A timesheet of one week as tab-separated text (pastes into a spreadsheet): one row per entry, then the total. */
  function sheet(entries, ws, fmtDate, fmtTime) {
    const we = addDays(ws, 7);
    const rows = [["Date", "Start", "End", "Hours", "Note"].join("\t")];
    let total = 0;
    for (const x of (entries || []).filter((x) => valid(x) && x.s < we && x.e > ws).sort((a, b) => a.s - b.s)) {
      const ms = overlap(x.s, x.e, ws, we);
      total += ms;
      rows.push([fmtDate(x.s), fmtTime(x.s), fmtTime(x.e), (ms / HOUR).toFixed(2), String(x.note || "").replace(/[\t\r\n]+/g, " ")].join("\t"));
    }
    rows.push(["Total", "", "", (total / HOUR).toFixed(2), ""].join("\t"));
    return rows.join("\n");
  }

  const api = {
    MIN, HOUR, DAY_MS, KEEP_DAYS, WORKDAYS,
    dayStart, addDays, weekStart, weekDays, overlap, worked, byDay, entriesOn, valid, balance, status, alerts,
    hm, hms, delta, words, parseDuration, prune, sheet,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WorkHours = api;
})(typeof window !== "undefined" ? window : globalThis);
