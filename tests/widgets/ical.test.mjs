import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { expand } = createRequire(import.meta.url)("../../widgets/calendar-glance/ical.js");

const wrap = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = lines => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;
const U = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const days = r => r.map(e => new Date(e.start).toISOString().slice(0, 10));

test("single UTC event, unfolding and escapes", () => {
  const r = expand(wrap(ev(["DTSTART:20260105T090000Z", "DTEND:20260105T100000Z", "SUMMARY:Plan\\, review\\nline", " d", "LOCATION:Room 1"])), U(2026, 1, 5), U(2026, 1, 6));
  assert.equal(r.length, 1);
  assert.equal(r[0].summary, "Plan, review\nlined");
  assert.equal(r[0].end - r[0].start, 3600000);
  assert.equal(r[0].location, "Room 1");
});

test("outside range is dropped, overlap is kept", () => {
  const t = wrap(ev(["DTSTART:20260105T230000Z", "DTEND:20260106T010000Z", "SUMMARY:Night"]));
  assert.equal(expand(t, U(2026, 1, 6), U(2026, 1, 7)).length, 1);
  assert.equal(expand(t, U(2026, 1, 7), U(2026, 1, 8)).length, 0);
});

test("all-day events use an exclusive end", () => {
  const t = wrap(ev(["DTSTART;VALUE=DATE:20260110", "DTEND;VALUE=DATE:20260112", "SUMMARY:Trip"]));
  assert.equal(expand(t, new Date(2026, 0, 11).getTime(), new Date(2026, 0, 12).getTime()).length, 1);
  assert.equal(expand(t, new Date(2026, 0, 12).getTime(), new Date(2026, 0, 13).getTime()).length, 0);
});

test("TZID is converted to the right instant (with DST)", () => {
  const w = expand(wrap(ev(["DTSTART;TZID=Europe/Berlin:20260115T090000", "SUMMARY:A"])), U(2026, 1, 15), U(2026, 1, 16));
  assert.equal(w[0].start, U(2026, 1, 15, 8));
  const s = expand(wrap(ev(["DTSTART;TZID=Europe/Berlin:20260715T090000", "SUMMARY:A"])), U(2026, 7, 15), U(2026, 7, 16));
  assert.equal(s[0].start, U(2026, 7, 15, 7));
});

test("daily with COUNT and EXDATE", () => {
  const t = wrap(ev(["DTSTART:20260101T100000Z", "RRULE:FREQ=DAILY;COUNT=5", "EXDATE:20260103T100000Z", "SUMMARY:Daily"]));
  assert.deepEqual(days(expand(t, U(2026, 1, 1), U(2026, 2, 1))), ["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05"]);
});

test("weekly BYDAY with INTERVAL=2 and UNTIL", () => {
  const t = wrap(ev(["DTSTART:20260105T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260125T000000Z", "SUMMARY:W"]));
  assert.deepEqual(days(expand(t, U(2026, 1, 1), U(2026, 3, 1))), ["2026-01-05", "2026-01-07", "2026-01-19", "2026-01-21"]);
});

test("monthly ordinal weekday and last day of month", () => {
  const second = wrap(ev(["DTSTART:20260113T120000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU", "SUMMARY:M"]));
  assert.deepEqual(days(expand(second, U(2026, 1, 1), U(2026, 4, 1))), ["2026-01-13", "2026-02-10", "2026-03-10"]);
  const last = wrap(ev(["DTSTART:20260131T120000Z", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", "SUMMARY:L"]));
  assert.deepEqual(days(expand(last, U(2026, 1, 1), U(2026, 4, 1))), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("yearly leap-day event", () => {
  const t = wrap(ev(["DTSTART;VALUE=DATE:20200229", "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", "SUMMARY:Leap"]));
  assert.equal(expand(t, new Date(2024, 0, 1).getTime(), new Date(2029, 0, 1).getTime()).length, 2);
});

test("daily recurrence across DST keeps the wall time", () => {
  const t = wrap(ev(["DTSTART;TZID=Europe/Berlin:20260327T090000", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:D"]));
  const r = expand(t, U(2026, 3, 27), U(2026, 3, 31));
  assert.deepEqual(r.map(e => e.start), [U(2026, 3, 27, 8), U(2026, 3, 28, 8), U(2026, 3, 29, 7)]);
});

test("RECURRENCE-ID override replaces an instance; cancelled is skipped", () => {
  const t = wrap([
    ev(["UID:a", "DTSTART:20260101T100000Z", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Series"]),
    ev(["UID:a", "RECURRENCE-ID:20260102T100000Z", "DTSTART:20260102T140000Z", "SUMMARY:Moved"]),
    ev(["UID:b", "DTSTART:20260101T100000Z", "STATUS:CANCELLED", "SUMMARY:Gone"]),
  ].join("\r\n"));
  const r = expand(t, U(2026, 1, 1), U(2026, 1, 5));
  assert.deepEqual(r.map(e => e.summary), ["Series", "Moved", "Series"]);
  assert.equal(r[1].start, U(2026, 1, 2, 14));
});

test("impossible rule terminates", () => {
  const t = wrap(ev(["DTSTART:20260101T100000Z", "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=2", "SUMMARY:Never"]));
  assert.equal(expand(t, U(2026, 1, 1), U(2026, 12, 1)).length, 0);
});
