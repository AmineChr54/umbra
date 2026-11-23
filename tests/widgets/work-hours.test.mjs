import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const W = createRequire(import.meta.url)("../../widgets/work-hours/hours.js");

const { MIN, HOUR } = W;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const entry = (s, e, note = "") => ({ id: String(s), s, e, note });

test("week starts at local midnight of Monday (or the chosen day)", () => {
  // Sunday 2026-11-29 belongs to the Monday 2026-11-23 week, but starts its own Sunday week.
  assert.equal(W.weekStart(at(2026, 11, 29, 15), "monday"), at(2026, 11, 23));
  assert.equal(W.weekStart(at(2026, 11, 23, 0, 0), "monday"), at(2026, 11, 23));
  assert.equal(W.weekStart(at(2026, 11, 29, 15), "sunday"), at(2026, 11, 29));
  assert.equal(W.weekStart(at(2026, 11, 27, 9), "saturday"), at(2026, 11, 21));
  const days = W.weekDays(at(2026, 11, 23));
  assert.equal(days.length, 8);
  assert.equal(days[7], at(2026, 11, 30));
});

test("worked time sums entries and the running timer, clipped to the range", () => {
  const ws = at(2026, 11, 23);
  const es = [entry(at(2026, 11, 23, 9), at(2026, 11, 23, 12)), entry(at(2026, 11, 24, 13), at(2026, 11, 24, 14, 30))];
  const now = at(2026, 11, 25, 10, 15);
  const running = { start: at(2026, 11, 25, 9), note: "" };
  assert.equal(W.worked(es, null, now, ws, W.addDays(ws, 7)), 4.5 * HOUR);
  assert.equal(W.worked(es, running, now, ws, W.addDays(ws, 7)), 5.75 * HOUR);
  // A running timer that started in the future (clock went back) counts nothing.
  assert.equal(W.worked([], { start: now + HOUR }, now, ws, W.addDays(ws, 7)), 0);
});

test("an entry across midnight counts on both days and across a week boundary on both weeks", () => {
  const e = entry(at(2026, 11, 29, 22), at(2026, 11, 30, 1, 30));
  const days = W.byDay([e], null, at(2026, 12, 1), at(2026, 11, 23));
  assert.equal(days[6].ms, 2 * HOUR);
  const next = W.byDay([e], null, at(2026, 12, 1), at(2026, 11, 30));
  assert.equal(next[0].ms, 1.5 * HOUR);
  assert.equal(W.entriesOn([e], at(2026, 11, 30)).length, 1);
  assert.equal(W.entriesOn([e], at(2026, 12, 1)).length, 0);
});

test("invalid entries are ignored", () => {
  const ws = at(2026, 11, 23);
  const bad = [{ s: 5, e: 1 }, { s: NaN, e: 2 }, null, { s: at(2026, 11, 23, 9) }];
  assert.equal(W.worked(bad, null, at(2026, 11, 24), ws, W.addDays(ws, 7)), 0);
});

test("status: under, near, reached, over and way over", () => {
  const ws = at(2026, 11, 23), now = at(2026, 11, 25, 12);
  const T = 20 * HOUR;
  const s = (worked) => W.status({ workedMs: worked, targetMs: T, now, ws, warnMs: 15 * MIN }).state;
  assert.equal(s(10 * HOUR), "under");
  assert.equal(s(T - 10 * MIN), "near");
  assert.equal(s(T), "reached");
  assert.equal(s(T + 5 * MIN), "reached");
  assert.equal(s(T + 10 * MIN), "over");
  assert.equal(s(T + 45 * MIN), "way-over");
});

test("pace spreads what's left over the workdays left, counting today with what's already done today", () => {
  // Wednesday noon, 8 h done this week, 2 of them today. Wed, Thu, Fri are left: (12 h left + 2 h today) / 3.
  const ws = at(2026, 11, 23), now = at(2026, 11, 25, 12);
  const r = W.status({ workedMs: 8 * HOUR, targetMs: 20 * HOUR, now, ws, workdays: "mon-fri", todayMs: 2 * HOUR });
  assert.equal(r.daysLeft, 3);
  assert.equal(r.perDay, (14 * HOUR) / 3);
  assert.equal(r.left, 12 * HOUR);
  // Saturday with Mon-Fri: no workdays left.
  const sat = W.status({ workedMs: 18 * HOUR, targetMs: 20 * HOUR, now: at(2026, 11, 28, 10), ws, workdays: "mon-fri" });
  assert.equal(sat.daysLeft, 0);
  assert.equal(sat.perDay, 0);
  const all = W.status({ workedMs: 18 * HOUR, targetMs: 20 * HOUR, now: at(2026, 11, 28, 10), ws, workdays: "all" });
  assert.equal(all.daysLeft, 2);
});

test("balance carries over/under time from earlier weeks that had any time, skipping empty weeks", () => {
  const T = 20 * HOUR;
  const es = [
    entry(at(2026, 11, 2, 8), at(2026, 11, 2, 8) + 21 * HOUR),  // week of Nov 2: 21 h (+1)
    // week of Nov 9: nothing (holiday)
    entry(at(2026, 11, 16, 8), at(2026, 11, 16, 8) + 19.5 * HOUR), // week of Nov 16: 19.5 h (-0.5)
    entry(at(2026, 11, 23, 9), at(2026, 11, 23, 12)),             // this week: not counted
  ];
  assert.equal(W.balance(es, at(2026, 11, 23), T), 0.5 * HOUR);
  assert.equal(W.balance([], at(2026, 11, 23), T), 0);
});

test("alerts: warn once, reached once, remind once per timer, all quiet on the first look", () => {
  const ws = at(2026, 11, 23), T = 20 * HOUR, warnMs = 15 * MIN, remindMs = 4 * HOUR;
  const running = { start: at(2026, 11, 25, 8) };
  const base = { ws, targetMs: T, warnMs, remindMs, running };
  let r = W.alerts({ ...base, seen: null, workedMs: 19 * HOUR, now: at(2026, 11, 25, 9) });
  assert.deepEqual(r.events, []);
  r = W.alerts({ ...base, seen: r.seen, workedMs: T - 10 * MIN, now: at(2026, 11, 25, 10) });
  assert.deepEqual(r.events.map((e) => e.type), ["warn"]);
  r = W.alerts({ ...base, seen: r.seen, workedMs: T - 5 * MIN, now: at(2026, 11, 25, 10, 5) });
  assert.deepEqual(r.events, []);
  r = W.alerts({ ...base, seen: r.seen, workedMs: T, now: at(2026, 11, 25, 10, 10) });
  assert.deepEqual(r.events.map((e) => e.type), ["reached"]);
  r = W.alerts({ ...base, seen: r.seen, workedMs: T + HOUR, now: at(2026, 11, 25, 12) });
  assert.deepEqual(r.events.map((e) => e.type), ["remind"]);
  r = W.alerts({ ...base, seen: r.seen, workedMs: T + 2 * HOUR, now: at(2026, 11, 25, 13) });
  assert.deepEqual(r.events, []);
  // A new week starts fresh.
  r = W.alerts({ ...base, ws: at(2026, 11, 30), running: null, seen: r.seen, workedMs: 0, now: at(2026, 11, 30, 9) });
  assert.equal(r.seen.week, at(2026, 11, 30));
  assert.equal(r.seen.reached, false);
  // Quiet: crossings are remembered without a toast; no toast without a running timer either.
  r = W.alerts({ ...base, seen: null, workedMs: T + HOUR, now: at(2026, 11, 25, 14), quiet: true });
  assert.deepEqual(r.events, []);
  assert.equal(r.seen.reached, true);
  assert.equal(r.seen.remind, running.start);
  r = W.alerts({ ...base, running: null, seen: null, workedMs: T + HOUR, now: at(2026, 11, 25, 14) });
  assert.deepEqual(r.events, []);
});

test("formatting", () => {
  assert.equal(W.hm(13 * HOUR + 20 * MIN), "13:20");
  assert.equal(W.hm(5 * MIN), "0:05");
  assert.equal(W.hm(-75 * MIN), "−1:15");
  assert.equal(W.hms(HOUR + 2 * MIN + 3000), "1:02:03");
  assert.equal(W.delta(25 * MIN), "+0:25");
  assert.equal(W.delta(-75 * MIN), "−1:15");
  assert.equal(W.delta(30000), "±0:00");
  assert.equal(W.words(6 * HOUR + 40 * MIN), "6h 40m");
  assert.equal(W.words(45 * MIN), "45m");
  assert.equal(W.words(2 * HOUR), "2h");
});

test("parseDuration understands the usual ways to write a length", () => {
  assert.equal(W.parseDuration("1:30"), 90 * MIN);
  assert.equal(W.parseDuration("2h"), 2 * HOUR);
  assert.equal(W.parseDuration("1.5"), 90 * MIN);
  assert.equal(W.parseDuration("1,25"), 75 * MIN);
  assert.equal(W.parseDuration("45m"), 45 * MIN);
  assert.equal(W.parseDuration("45 min"), 45 * MIN);
  assert.equal(W.parseDuration("1h 15m"), 75 * MIN);
  assert.equal(W.parseDuration("abc"), null);
  assert.equal(W.parseDuration(""), null);
});

test("sheet lists the week's entries as tab-separated rows with a total; prune drops old entries", () => {
  const ws = at(2026, 11, 23);
  const es = [entry(at(2026, 11, 24, 9), at(2026, 11, 24, 10, 30), "Review\tPR"), entry(at(2026, 11, 16, 9), at(2026, 11, 16, 10))];
  const text = W.sheet(es, ws, () => "2026-11-24", () => "hh:mm");
  const rows = text.split("\n");
  assert.equal(rows.length, 3);
  assert.equal(rows[1], "2026-11-24\thh:mm\thh:mm\t1.50\tReview PR");
  assert.equal(rows[2], "Total\t\t\t1.50\t");
  const now = at(2026, 11, 23);
  const old = entry(now - 500 * 24 * HOUR, now - 500 * 24 * HOUR + HOUR);
  assert.equal(W.prune([old, es[0]], now).length, 1);
});
