import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../../widgets/prayer-times/times.js");

const U = (y, m, d, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);

// Berlin, 17 and 18 Oct 2026 (CEST, UTC+2): values as the Aladhan calendar returns them, with the "(CEST)" suffix.
const timings = (o = {}) => ({
  Fajr: "05:41 (CEST)", Sunrise: "07:35 (CEST)", Dhuhr: "12:52 (CEST)", Asr: "15:35 (CEST)",
  Sunset: "18:07 (CEST)", Maghrib: "18:07 (CEST)", Isha: "19:55 (CEST)", Imsak: "05:31 (CEST)", ...o,
});
const hijri = (day, month = "Jumādá al-ūlá", num = 5, len = 30) => ({
  day: String(day), month: { number: num, en: month, ar: "جُمادى الأولى", days: len }, year: "1448",
});
const entry = (dd, mm, yyyy, t = timings(), h = hijri(6), tz = "Europe/Berlin") => ({
  timings: t,
  date: { gregorian: { date: `${dd}-${mm}-${yyyy}` }, hijri: h },
  meta: { timezone: tz },
});
const calendar = (entries) => ({ code: 200, status: "OK", data: entries });

const berlin = () => T.parseCalendar(calendar([
  entry("17", "10", "2026", timings(), hijri(6)),
  entry("18", "10", "2026", timings({ Fajr: "05:43 (CEST)" }), hijri(7)),
]));

test("parseHM strips the zone suffix and rejects junk", () => {
  assert.equal(T.parseHM("05:41 (CEST)"), "05:41");
  assert.equal(T.parseHM("5:41"), "05:41");
  assert.equal(T.parseHM("24:10"), null);
  assert.equal(T.parseHM("12:61"), null);
  assert.equal(T.parseHM(undefined), null);
  assert.equal(T.parseHM("soon"), null);
});

test("parseCalendar keeps good days and compacts them", () => {
  const d = berlin();
  assert.equal(d.tz, "Europe/Berlin");
  assert.deepEqual(Object.keys(d.days), ["2026-10-17", "2026-10-18"]);
  assert.deepEqual(d.days["2026-10-17"].t, { Fajr: "05:41", Sunrise: "07:35", Dhuhr: "12:52", Asr: "15:35", Maghrib: "18:07", Isha: "19:55" });
  assert.deepEqual(d.days["2026-10-17"].h, { d: 6, m: "Jumādá al-ūlá", ar: "جُمادى الأولى", y: 1448, len: 30 });
});

test("malformed API data: bad days are skipped, unusable responses throw", () => {
  const bad = entry("19", "10", "2026", timings({ Asr: "n/a" }));
  const noDate = { timings: timings(), date: {}, meta: { timezone: "Europe/Berlin" } };
  const d = T.parseCalendar(calendar([bad, noDate, entry("17", "10", "2026"), null, 7]));
  assert.deepEqual(Object.keys(d.days), ["2026-10-17"]);
  assert.throws(() => T.parseCalendar(null));
  assert.throws(() => T.parseCalendar({ code: 400, data: "Unable to geocode address: Nowhereville" }));
  assert.throws(() => T.parseCalendar(calendar([])));
  assert.throws(() => T.parseCalendar(calendar([bad])));
  assert.throws(() => T.parseCalendar(calendar([entry("17", "10", "2026", timings(), hijri(6), "Mars/Olympus")])));
  // A missing hijri block only drops the hijri date.
  const e = entry("17", "10", "2026"); delete e.date.hijri;
  assert.equal(T.parseCalendar(calendar([e])).days["2026-10-17"].h, null);
});

test("wall clock in the location's zone becomes the right instant, DST included", () => {
  assert.equal(T.zonedToUtc("2026-10-17", "05:41", "Europe/Berlin"), U(2026, 10, 17, 3, 41));
  assert.equal(T.zonedToUtc("2026-01-15", "05:41", "Europe/Berlin"), U(2026, 1, 15, 4, 41));
  assert.equal(T.zonedToUtc("2026-03-29", "13:00", "Europe/Berlin"), U(2026, 3, 29, 11, 0)); // clocks went forward that night
  assert.equal(T.zonedToUtc("2026-10-25", "12:00", "Europe/Berlin"), U(2026, 10, 25, 11, 0)); // and back
  assert.equal(T.zonedToUtc("2026-10-17", "12:00", "America/New_York"), U(2026, 10, 17, 16, 0));
  assert.equal(T.zonedToUtc("2026-10-17", "12:00", "Asia/Kolkata"), U(2026, 10, 17, 6, 30));
  assert.equal(T.zonedToUtc("2026-10-17", "00:10", "Pacific/Auckland"), U(2026, 10, 16, 11, 10));
});

test("date keys follow the location, not the machine", () => {
  const now = U(2026, 10, 17, 23, 0); // 23:00 UTC
  assert.equal(T.dateKey(now, "Europe/Berlin"), "2026-10-18");
  assert.equal(T.dateKey(now, "America/New_York"), "2026-10-17");
  assert.equal(T.dateKey(now, "Pacific/Auckland"), "2026-10-18");
  assert.equal(T.shiftKey("2026-12-31", 1), "2027-01-01");
  assert.equal(T.shiftKey("2026-03-01", -1), "2026-02-28");
});

test("midday: current and next prayer, countdown, rows", () => {
  const d = berlin();
  const now = T.zonedToUtc("2026-10-17", "14:00", "Europe/Berlin");
  const s = T.schedule(d, now, {});
  assert.equal(s.hasToday, true);
  assert.equal(s.current.name, "Dhuhr");
  assert.equal(s.next.name, "Asr");
  assert.equal(T.formatCountdown(s.next.ts - now), "1:35:00");
  assert.deepEqual(s.rows.map((r) => r.name), ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]);
  assert.deepEqual(s.rows.map((r) => r.past), [true, true, true, false, false, false]);
  assert.equal(s.rows.filter((r) => r.isCurrent).length, 1);
  assert.equal(s.rows.filter((r) => r.isNext).length, 1);
});

test("the same instant gives different answers in different zones (injected tz, not the machine's)", () => {
  const berlinData = berlin();
  const now = U(2026, 10, 17, 12, 0); // Berlin 14:00
  assert.equal(T.schedule(berlinData, now, {}).next.name, "Asr");
  // The same wall-clock table read as New York times: it is 08:00 there, after sunrise (07:35) and before Dhuhr.
  const ny = { tz: "America/New_York", days: berlinData.days };
  const s = T.schedule(ny, now, {});
  assert.equal(s.todayKey, "2026-10-17");
  assert.equal(s.current, null); // 08:00 in New York: after sunrise (07:35), before Dhuhr
  assert.equal(s.next.name, "Dhuhr");
  assert.equal(s.next.ts - now, 4 * 3600000 + 52 * 60000);
  // In Auckland (UTC+13) the same instant is already the 18th and has no data.
  const akl = T.schedule({ tz: "Pacific/Auckland", days: berlinData.days }, now, {});
  assert.equal(akl.todayKey, "2026-10-18");
});

test("before Fajr: Fajr is next, nothing is current when yesterday is unknown", () => {
  const d = T.parseCalendar(calendar([entry("17", "10", "2026")]));
  const s = T.schedule(d, T.zonedToUtc("2026-10-17", "03:00", "Europe/Berlin"), {});
  assert.equal(s.current, null);
  assert.equal(s.next.name, "Fajr");
});

test("sunrise ends Fajr; it is not a prayer to count down to", () => {
  const d = berlin();
  assert.equal(T.schedule(d, T.zonedToUtc("2026-10-17", "06:00", "Europe/Berlin"), {}).current.name, "Fajr");
  const s = T.schedule(d, T.zonedToUtc("2026-10-17", "08:00", "Europe/Berlin"), {});
  assert.equal(s.current, null);
  assert.equal(s.next.name, "Dhuhr");
});

test("after Isha the next prayer is tomorrow's Fajr", () => {
  const d = berlin();
  const now = T.zonedToUtc("2026-10-17", "22:00", "Europe/Berlin");
  const s = T.schedule(d, now, {});
  assert.equal(s.current.name, "Isha");
  assert.equal(s.next.name, "Fajr");
  assert.equal(s.next.key, "2026-10-18");
  assert.equal(s.next.ts, T.zonedToUtc("2026-10-18", "05:43", "Europe/Berlin"));
  assert.equal(T.formatCountdown(s.next.ts - now), "7:43:00");
  assert.equal(s.needsNext, false);
});

test("after Isha with no data for tomorrow: next is null and needsNext is set", () => {
  const d = T.parseCalendar(calendar([entry("17", "10", "2026")]));
  const s = T.schedule(d, T.zonedToUtc("2026-10-17", "22:00", "Europe/Berlin"), {});
  assert.equal(s.next, null);
  assert.equal(s.needsNext, true);
  assert.equal(s.current.name, "Isha");
});

test("after midnight, before Fajr: still yesterday's Isha, next is today's Fajr", () => {
  const d = berlin();
  const now = T.zonedToUtc("2026-10-18", "01:00", "Europe/Berlin");
  const s = T.schedule(d, now, {});
  assert.equal(s.todayKey, "2026-10-18");
  assert.equal(s.current.name, "Isha");
  assert.equal(s.current.key, "2026-10-17");
  assert.equal(s.next.name, "Fajr");
  assert.equal(s.next.key, "2026-10-18");
  assert.equal(T.formatCountdown(s.next.ts - now), "4:43:00");
});

test("no data for today: hasToday is false and nothing is invented", () => {
  const s = T.schedule(berlin(), T.zonedToUtc("2026-11-02", "12:00", "Europe/Berlin"), {});
  assert.equal(s.hasToday, false);
  assert.equal(s.next, null);
  assert.deepEqual(s.rows, []);
  assert.equal(T.schedule(null, 0, {}).hasToday, false);
  assert.equal(T.schedule({ tz: "Nope/Zone", days: {} }, 0, {}).hasToday, false);
});

test("Isha after midnight (high latitude) belongs to the next calendar day", () => {
  const d = T.parseCalendar(calendar([
    entry("21", "06", "2026", timings({ Fajr: "02:10", Sunrise: "03:30", Dhuhr: "13:20", Asr: "17:40", Maghrib: "22:50", Isha: "00:20" }), hijri(6), "Europe/Oslo"),
    entry("22", "06", "2026", timings({ Fajr: "02:12", Sunrise: "03:31", Dhuhr: "13:20", Asr: "17:40", Maghrib: "22:50", Isha: "00:21" }), hijri(7), "Europe/Oslo"),
  ]));
  const before = T.schedule(d, T.zonedToUtc("2026-06-21", "23:30", "Europe/Oslo"), {});
  assert.equal(before.current.name, "Maghrib");
  assert.equal(before.next.name, "Isha");
  assert.equal(before.next.ts, T.zonedToUtc("2026-06-22", "00:20", "Europe/Oslo"));
  const after = T.schedule(d, T.zonedToUtc("2026-06-22", "00:30", "Europe/Oslo"), {});
  assert.equal(after.current.name, "Isha");
  assert.equal(after.current.key, "2026-06-21");
  assert.equal(after.next.name, "Fajr");
});

test("adjustments move only the five prayers, clamp to 30 minutes and never reorder the day", () => {
  const d = berlin();
  const now = T.zonedToUtc("2026-10-17", "10:00", "Europe/Berlin");
  const ev = (adjust) => Object.fromEntries(T.schedule(d, now, { adjust }).rows.map((r) => [r.name, r.ts]));
  const base = ev({});
  const adj = ev({ Fajr: 5, Dhuhr: -3, Asr: 99, Maghrib: "2", Isha: -99, Sunrise: 20 });
  assert.equal(adj.Fajr - base.Fajr, 5 * 60000);
  assert.equal(adj.Dhuhr - base.Dhuhr, -3 * 60000);
  assert.equal(adj.Asr - base.Asr, 30 * 60000);
  assert.equal(adj.Maghrib - base.Maghrib, 2 * 60000);
  assert.equal(adj.Isha - base.Isha, -30 * 60000);
  assert.equal(adj.Sunrise, base.Sunrise); // sunrise is not a prayer
  // A garbage value counts as 0.
  assert.equal(ev({ Fajr: "abc" }).Fajr, base.Fajr);
  // Pushing Fajr past a sunrise that is only minutes away doesn't flip sunrise to tomorrow.
  const tight = T.parseCalendar(calendar([entry("17", "06", "2026", timings({ Fajr: "03:00", Sunrise: "03:10" }))]));
  const rows = T.schedule(tight, T.zonedToUtc("2026-06-17", "12:00", "Europe/Berlin"), { adjust: { Fajr: 30 } }).rows;
  assert.equal(rows.find((r) => r.name === "Sunrise").ts, T.zonedToUtc("2026-06-17", "03:10", "Europe/Berlin"));
});

test("an adjusted prayer changes what is next", () => {
  const d = berlin();
  const now = T.zonedToUtc("2026-10-17", "15:34", "Europe/Berlin");
  assert.equal(T.schedule(d, now, {}).next.name, "Asr");
  const later = T.schedule(d, now, { adjust: { Asr: 10 } });
  assert.equal(later.next.name, "Asr");
  assert.equal(later.next.ts - now, 11 * 60000);
  const earlier = T.schedule(d, now, { adjust: { Asr: -5 } });
  assert.equal(earlier.current.name, "Asr");
  assert.equal(earlier.next.name, "Maghrib");
});

test("iqama: adhan plus the delay, none when 0, pending until it arrives", () => {
  const d = berlin();
  const iqama = { Fajr: 20, Dhuhr: 10, Asr: 0, Maghrib: 5, Isha: 200 };
  const adhan = T.zonedToUtc("2026-10-17", "12:52", "Europe/Berlin");
  const s = T.schedule(d, adhan + 4 * 60000, { iqama });
  const rows = Object.fromEntries(s.rows.map((r) => [r.name, r]));
  assert.equal(rows.Dhuhr.iqamaTs, adhan + 10 * 60000);
  assert.equal(rows.Asr.iqamaTs, null);
  assert.equal(rows.Sunrise.iqamaTs, null);
  assert.equal(rows.Isha.iqamaMin, 90); // clamped
  assert.equal(s.iqamaPending.name, "Dhuhr");
  assert.equal(s.iqamaPending.ms, 6 * 60000);
  assert.equal(T.formatTime(s.iqamaPending.at, "Europe/Berlin"), "13:02");
  assert.equal(T.schedule(d, adhan + 11 * 60000, { iqama }).iqamaPending, null);
  assert.equal(T.schedule(d, adhan + 4 * 60000, {}).iqamaPending, null);
  // Iqama follows the adjusted adhan.
  const adj = T.schedule(d, adhan, { iqama, adjust: { Dhuhr: 3 } }).rows.find((r) => r.name === "Dhuhr");
  assert.equal(adj.iqamaTs, adhan + 13 * 60000);
});

test("hijri date switches to tomorrow's after Maghrib", () => {
  const d = berlin();
  const noon = T.schedule(d, T.zonedToUtc("2026-10-17", "12:00", "Europe/Berlin"), {});
  assert.equal(noon.hijri.d, 6);
  const evening = T.schedule(d, T.zonedToUtc("2026-10-17", "18:30", "Europe/Berlin"), {});
  assert.equal(evening.hijri.d, 7);
  // Without tomorrow's data it stays on today's.
  const solo = T.parseCalendar(calendar([entry("17", "10", "2026")]));
  assert.equal(T.schedule(solo, T.zonedToUtc("2026-10-17", "18:30", "Europe/Berlin"), {}).hijri.d, 6);
});

test("hijri formatting", () => {
  const h = { d: 6, m: "Jumādá al-ūlá", ar: "جُمادى الأولى", y: 1448, len: 30 };
  assert.equal(T.formatHijri(h), "6 Jumādá al-ūlá 1448");
  assert.equal(T.formatHijri(h, { arabic: true }), "6 جُمادى الأولى 1448");
  assert.equal(T.formatHijri({ ...h, ar: "" }, { arabic: true }), "6 Jumādá al-ūlá 1448");
  assert.equal(T.formatHijri(null), "");
  assert.equal(T.formatHijri({}), "");
  assert.equal(T.formatHijri({ d: 6, m: "", y: 1448 }), "");
  const bad = T.parseCalendar(calendar([entry("17", "10", "2026", timings(), hijri(0))]));
  assert.equal(bad.days["2026-10-17"].h, null);
});

test("countdown formatting", () => {
  assert.equal(T.formatCountdown(0), "00:00");
  assert.equal(T.formatCountdown(-5000), "00:00");
  assert.equal(T.formatCountdown(245000), "04:05");
  assert.equal(T.formatCountdown(244001), "04:05"); // rounds up
  assert.equal(T.formatCountdown(3600000 + 2 * 60000 + 9000), "1:02:09");
});

test("clock formatting in the location's zone, 24-hour and 12-hour", () => {
  const ts = U(2026, 10, 17, 3, 41); // 05:41 in Berlin
  assert.equal(T.formatTime(ts, "Europe/Berlin", { hour12: false }), "05:41");
  assert.equal(T.formatTime(ts, "America/New_York", { hour12: false }), "23:41");
  assert.match(T.formatTime(ts, "Europe/Berlin", { hour12: true }), /^5:41\s?AM$/i);
  assert.match(T.formatTime(U(2026, 10, 17, 16, 5), "Europe/Berlin", { hour12: true }), /^6:05\s?PM$/i);
  assert.equal(T.formatTime(U(2026, 10, 16, 22, 5), "Europe/Berlin", { hour12: false }), "00:05"); // midnight is 00, not 24
  assert.equal(T.formatDate(ts, "Europe/Berlin", "en-GB"), "Sat 17 Oct");
});

test("time format follows the host when it offers hour12 / locale, else 24-hour", () => {
  assert.equal(T.resolveHour12(true, "de-DE"), true);
  assert.equal(T.resolveHour12(false, "en-US"), false);
  assert.equal(T.resolveHour12(undefined, "en-US"), true);
  assert.equal(T.resolveHour12(undefined, "de-DE"), false);
  assert.equal(T.resolveHour12(undefined, undefined), false);
  assert.equal(T.resolveHour12(undefined, "not a locale!!"), false);
});

test("which months to keep", () => {
  const berlinNoon = (key) => T.zonedToUtc(key, "12:00", "Europe/Berlin");
  assert.deepEqual(T.monthsNeeded(berlinNoon("2026-10-17"), "Europe/Berlin").map((m) => m.id), ["2026-10"]);
  assert.deepEqual(T.monthsNeeded(berlinNoon("2026-10-28"), "Europe/Berlin").map((m) => m.id), ["2026-10", "2026-11"]);
  assert.deepEqual(T.monthsNeeded(berlinNoon("2026-12-30"), "Europe/Berlin").map((m) => m.id), ["2026-12", "2027-01"]);
  assert.deepEqual(T.monthsNeeded(berlinNoon("2026-01-01"), "Europe/Berlin").map((m) => m.id), ["2026-01", "2025-12"]);
  // The month is the location's: 23:30 UTC on 31 Oct is already 1 Nov in Auckland.
  assert.equal(T.monthsNeeded(U(2026, 10, 31, 23, 30), "Pacific/Auckland")[0].id, "2026-11");
  assert.equal(T.monthsNeeded(U(2026, 10, 31, 23, 30), "America/New_York")[0].id, "2026-10");
  const m = T.monthsNeeded(U(2026, 10, 17, 12), undefined)[0]; // zone not known yet: machine clock
  assert.ok(m.id.startsWith("2026-"));
});

test("notifications: once per prayer per day, only fresh ones, never sunrise", () => {
  const d = berlin();
  const adhan = T.zonedToUtc("2026-10-17", "12:52", "Europe/Berlin");
  const events = T.schedule(d, adhan, {}).events;
  const due = T.notifyDue(events, adhan + 30000, {});
  assert.deepEqual(due.map((e) => e.name), ["Dhuhr"]);
  const notified = { "2026-10-17|Dhuhr": adhan };
  assert.deepEqual(T.notifyDue(events, adhan + 60000, notified), []);
  assert.deepEqual(T.notifyDue(events, adhan + 10 * 60000, {}), []); // woke from sleep: too old to announce
  assert.deepEqual(T.notifyDue(events, T.zonedToUtc("2026-10-17", "07:36", "Europe/Berlin"), {}), []); // sunrise
  // Next day, same prayer: a new key, so it is announced again.
  assert.equal(T.notifyDue(T.schedule(d, T.zonedToUtc("2026-10-18", "12:52", "Europe/Berlin"), {}).events, T.zonedToUtc("2026-10-18", "12:53", "Europe/Berlin"), notified).length, 1);
  const pruned = T.pruneNotified({ "2026-10-10|Fajr": 1, "2026-10-16|Isha": 2, "2026-10-17|Dhuhr": 3 }, "2026-10-17");
  assert.deepEqual(Object.keys(pruned), ["2026-10-16|Isha", "2026-10-17|Dhuhr"]);
});
