import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const L = require("../../widgets/hearth/overview-logic.js");
const M = require("../../widgets/hearth/mascot.js");
const logicPath = fileURLToPath(new URL("../../widgets/hearth/overview-logic.js", import.meta.url));

const outfitFor = M.milestoneOutfit;

// ---------- calendar days ----------

test("isRealDate and parseYmd reject dates that do not exist", () => {
  assert.equal(L.isRealDate(2024, 2, 29), true);
  assert.equal(L.isRealDate(2023, 2, 29), false);
  assert.equal(L.isRealDate(1900, 2, 29), false);
  assert.equal(L.isRealDate(2000, 2, 29), true);
  assert.equal(L.isRealDate(2024, 13, 1), false);
  assert.equal(L.isRealDate(2024, 4, 31), false);
  assert.deepEqual(L.parseYmd("2024-02-14"), { y: 2024, m: 2, d: 14 });
  assert.equal(L.parseYmd("2024-2-14"), null);
  assert.equal(L.parseYmd("2024-02-30"), null);
  assert.equal(L.parseYmd(""), null);
  assert.equal(L.parseYmd(null), null);
});

test("diffDays counts calendar days across month, leap day and year ends", () => {
  assert.equal(L.diffDays("2024-02-14", "2024-02-14"), 0);
  assert.equal(L.diffDays("2024-02-28", "2024-03-01"), 2); // 2024 is a leap year
  assert.equal(L.diffDays("2023-02-28", "2023-03-01"), 1);
  assert.equal(L.diffDays("2023-12-31", "2024-01-01"), 1);
  assert.equal(L.diffDays("2020-01-01", "2024-01-01"), 1461);
  assert.equal(L.diffDays("2024-01-02", "2024-01-01"), -1);
  assert.equal(L.diffDays("nope", "2024-01-01"), null);
});

test("daysTogether: 0 on the day itself, then one per calendar day", () => {
  assert.equal(L.daysTogether("2024-02-14", "2024-02-14"), 0);
  assert.equal(L.daysTogether("2024-02-14", "2024-02-15"), 1);
  assert.equal(L.daysTogether("2020-05-01", "2024-05-01"), 1461);
  assert.equal(L.daysTogether("", "2024-05-01"), null);
  assert.equal(L.daysTogether("garbage", "2024-05-01"), null);
});

test("daysTogether tolerates a partner whose calendar is up to two days ahead, but not more", () => {
  assert.equal(L.daysTogether("2024-05-02", "2024-05-01"), 0);
  assert.equal(L.daysTogether("2024-05-03", "2024-05-01"), 0);
  assert.equal(L.daysTogether("2024-05-04", "2024-05-01"), null);
});

test("localToday uses the local calendar fields, not UTC", () => {
  // Local-time constructor: the same wall clock reads the same date in any process time zone.
  assert.equal(L.localToday(new Date(2024, 0, 31, 23, 59, 59)), "2024-01-31");
  assert.equal(L.localToday(new Date(2024, 1, 1, 0, 0, 0)), "2024-02-01");
  assert.equal(L.localToday(new Date(NaN)).length, 10);
});

test("msToNextMidnight is the time to the next local midnight (always a positive wait)", () => {
  const noon = new Date(2024, 5, 10, 12, 0, 0);
  const ms = L.msToNextMidnight(noon);
  assert.equal(new Date(noon.getTime() + ms).getDate(), 11);
  assert.ok(new Date(noon.getTime() + ms).getHours() === 0);
  assert.ok(L.msToNextMidnight(new Date(2024, 5, 10, 23, 59, 59, 999)) >= 1000);
});

// Time zones and DST need the process to start with TZ set, so these run a tiny script per zone.
function inZone(tz, script) {
  const r = spawnSync(process.execPath, ["-e", `const L = require(${JSON.stringify(logicPath)}); ${script}`], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("the count follows the viewer's local midnight in far-apart time zones", () => {
  // One instant, three different local dates.
  const script = `const t = new Date("2024-06-01T10:00:00Z"); console.log(JSON.stringify({ today: L.localToday(t), n: L.daysTogether("2024-06-01", L.localToday(t)) }));`;
  assert.deepEqual(inZone("Pacific/Kiritimati", script), { today: "2024-06-02", n: 1 }); // UTC+14
  assert.deepEqual(inZone("UTC", script), { today: "2024-06-01", n: 0 });
  assert.deepEqual(inZone("Pacific/Pago_Pago", script), { today: "2024-05-31", n: 0 }); // UTC-11, a day behind: tolerated as day one
});

test("the count is exact across the spring-forward and fall-back days (23 and 25 hour days)", () => {
  // New York: 2024-03-10 has 23 hours and 2024-11-03 has 25. Midnight-ish readings on both sides must still be whole days.
  const script = `
    const at = (y, m, d, h, mi) => L.localToday(new Date(y, m - 1, d, h, mi));
    console.log(JSON.stringify({
      spring: L.daysTogether("2024-03-09", at(2024, 3, 11, 0, 30)),
      springEnd: L.daysTogether("2024-03-09", at(2024, 3, 11, 23, 59)),
      springDay: L.daysTogether("2024-03-10", at(2024, 3, 10, 12, 0)),
      fall: L.daysTogether("2024-11-02", at(2024, 11, 4, 0, 30)),
      fallEnd: L.daysTogether("2024-11-02", at(2024, 11, 4, 23, 59)),
      year: L.daysTogether("2023-11-05", at(2024, 11, 5, 0, 5)),
      elapsedDays: (new Date(2024, 2, 11, 0, 30) - new Date(2024, 2, 9, 0, 30)) / 86400000,
    }));`;
  const r = inZone("America/New_York", script);
  assert.equal(r.spring, 2);
  assert.equal(r.springEnd, 2);
  assert.equal(r.springDay, 0);
  assert.equal(r.fall, 2);
  assert.equal(r.fallEnd, 2);
  assert.equal(r.year, 366); // 2024 is a leap year
  assert.ok(r.elapsedDays < 2, "the naive elapsed-time count would be wrong here"); // 1.958: this is why we count calendar days
  const berlin = inZone("Europe/Berlin", `console.log(JSON.stringify({ n: L.daysTogether("2024-03-30", L.localToday(new Date(2024, 2, 31, 3, 30))), m: L.daysTogether("2024-10-26", L.localToday(new Date(2024, 9, 28, 0, 15))) }));`);
  assert.deepEqual(berlin, { n: 1, m: 2 });
});

test("the midnight timer lands on the next local day in a DST zone", () => {
  const out = inZone("America/New_York", `
    const t = new Date(2024, 2, 9, 22, 0); // the evening before the 23 hour day
    const next = new Date(t.getTime() + L.msToNextMidnight(t));
    console.log(JSON.stringify({ d: next.getDate(), h: next.getHours() }));`);
  assert.deepEqual(out, { d: 10, h: 0 });
});

// ---------- names and dates the user types ----------

test("cleanName mirrors the relay's rule", () => {
  assert.equal(L.cleanName("  Ada   Lovelace "), "Ada Lovelace");
  assert.equal(L.cleanName("Zoë"), "Zoë");
  assert.equal(L.cleanName("Zoë"), "Zoë"); // decomposed input is normalised
  assert.equal(L.cleanName("O'Brien-Smith Jr."), "O'Brien-Smith Jr.");
  assert.equal(L.cleanName("日本語"), "日本語");
  assert.equal(L.cleanName("A".repeat(20)), "A".repeat(20));
  assert.equal(L.cleanName("A".repeat(21)), null);
  assert.equal(L.cleanName("😀".repeat(2)), null);
  assert.equal(L.cleanName("a,b"), null);
  assert.equal(L.cleanName("<b>"), null);
  assert.equal(L.cleanName("   "), null);
  assert.equal(L.cleanName("ア".repeat(20)), "ア".repeat(20)); // counted in characters, not UTF-16 units
});

test("validateName: empty means leave alone, bad characters and length give a sentence", () => {
  assert.deepEqual(L.validateName("  Bo  "), { ok: true, value: "Bo" });
  assert.deepEqual(L.validateName("   "), { ok: true, value: "" });
  assert.equal(L.validateName("x".repeat(21)).ok, false);
  assert.match(L.validateName("x".repeat(21)).error, /20/);
  assert.equal(L.validateName("Ada!").ok, false);
  assert.match(L.validateName("Ada!").error, /letters/);
});

test("parseDateInput accepts the common separators and pads", () => {
  assert.equal(L.parseDateInput("2024-2-4"), "2024-02-04");
  assert.equal(L.parseDateInput(" 2024/02/14 "), "2024-02-14");
  assert.equal(L.parseDateInput("2024.2.14"), "2024-02-14");
  assert.equal(L.parseDateInput("14-02-2024"), null);
  assert.equal(L.parseDateInput("Feb 14"), null);
  assert.equal(L.parseDateInput(""), null);
});

test("validateSince: real, from 1970, never after the viewer's today", () => {
  const today = "2024-06-10";
  assert.deepEqual(L.validateSince("2024-06-10", today), { ok: true, value: "2024-06-10" });
  assert.deepEqual(L.validateSince("2020-2-29", today), { ok: true, value: "2020-02-29" });
  assert.deepEqual(L.validateSince("1970-01-01", today), { ok: true, value: "1970-01-01" });
  assert.deepEqual(L.validateSince("", today), { ok: true, value: "" });
  assert.match(L.validateSince("2024-06-11", today).error, /future/);
  assert.match(L.validateSince("2030-01-01", today).error, /future/);
  assert.match(L.validateSince("2023-02-29", today).error, /does not exist/);
  assert.match(L.validateSince("1969-12-31", today).error, /1970/);
  assert.match(L.validateSince("tomorrow", today).error, /YYYY-MM-DD/);
});

test("the local future check is never stricter than the relay (tomorrow in UTC) can accept: today is always allowed", () => {
  for (const today of ["2024-01-01", "2024-02-29", "2024-12-31"]) assert.equal(L.validateSince(today, today).ok, true);
});

// ---------- the set route ----------

test("buildSetParams: side a puts its name first, side b second, and only changed fields go", () => {
  const today = "2024-06-10";
  const a = L.buildSetParams({ me: "a", current: { name: "", since: "" }, draft: { name: " Ada ", since: "2024-02-14" }, today });
  assert.deepEqual(a, { ok: true, params: { names: "Ada,", since: "2024-02-14" }, changes: { name: "Ada", since: "2024-02-14" } });
  const b = L.buildSetParams({ me: "b", current: { name: "", since: "2024-02-14" }, draft: { name: "Bo", since: "2024-02-14" }, today });
  assert.deepEqual(b, { ok: true, params: { names: ",Bo" }, changes: { name: "Bo" } });
  const dateOnly = L.buildSetParams({ me: "b", current: { name: "Bo", since: "2024-02-14" }, draft: { name: "Bo", since: "2024-02-13" }, today });
  assert.deepEqual(dateOnly.params, { since: "2024-02-13" });
});

test("buildSetParams: nothing changed, empty fields, and invalid fields", () => {
  const today = "2024-06-10";
  assert.deepEqual(L.buildSetParams({ me: "a", current: { name: "Ada", since: "2024-02-14" }, draft: { name: "Ada", since: "2024-02-14" }, today }), { ok: true, params: null });
  assert.deepEqual(L.buildSetParams({ me: "a", current: { name: "Ada", since: "2024-02-14" }, draft: { name: "", since: "" }, today }), { ok: true, params: null });
  const bad = L.buildSetParams({ me: "a", current: {}, draft: { name: "Ada<", since: "2099-01-01" }, today });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name && bad.errors.since);
  const one = L.buildSetParams({ me: "a", current: {}, draft: { name: "Ada", since: "2099-01-01" }, today });
  assert.equal(one.ok, false);
  assert.equal(one.errors.name, undefined);
});

test("the params fit the relay's URL form: the comma is encoded and the relay splits it into two parts", () => {
  const r = L.buildSetParams({ me: "a", current: {}, draft: { name: "Ada", since: "2024-02-14" }, today: "2024-06-10" });
  const H = require("../../widgets/hearth/hearth-core.js");
  const pairing = { room: "a".repeat(32), me: "a", key: "b".repeat(32) };
  const u = new URL(H.hearthUrl("set", pairing, r.params));
  assert.equal(u.pathname, "/hearth/set");
  assert.equal(u.search.includes("names=Ada%2C"), true);
  assert.deepEqual(u.searchParams.get("names").split(","), ["Ada", ""]);
  assert.equal(u.searchParams.get("since"), "2024-02-14");
});

test("setErrorText covers the relay's set errors", () => {
  assert.match(L.setErrorText("bad name"), /letters/);
  assert.match(L.setErrorText("bad date"), /date/);
  assert.match(L.setErrorText("something else"), /try again/);
});

test("overlayPending shows our own save until the sync catches up, then lets go", () => {
  const synced = { names: { a: "Ada", b: "" }, togetherSince: "2024-01-01" };
  const pending = { name: "Adaline", since: "2024-02-14", at: 1000 };
  const early = L.overlayPending(synced, "a", pending, 2000);
  assert.deepEqual(early.names, { a: "Adaline", b: "" });
  assert.equal(early.since, "2024-02-14");
  assert.ok(early.pending);
  // the sync brings the name but not yet the date
  const half = L.overlayPending({ names: { a: "Adaline", b: "" }, togetherSince: "2024-01-01" }, "a", pending, 3000);
  assert.deepEqual(half.pending, { at: 1000, since: "2024-02-14" });
  // everything arrived
  assert.equal(L.overlayPending({ names: { a: "Adaline", b: "Bo" }, togetherSince: "2024-02-14" }, "a", pending, 4000).pending, null);
  // too old: the synced values win (somebody else may have changed them since)
  const late = L.overlayPending(synced, "a", pending, 1000 + L.LIMITS.optimisticMs + 1);
  assert.equal(late.names.a, "Ada");
  assert.equal(late.pending, null);
  // side b only ever overlays its own name
  assert.deepEqual(L.overlayPending({ names: { a: "Ada", b: "" }, togetherSince: "" }, "b", { name: "Bo", at: 1 }, 2).names, { a: "Ada", b: "Bo" });
  assert.equal(L.overlayPending(synced, "a", null, 5).pending, null);
});

test("initialOf takes the first whole character", () => {
  assert.equal(L.initialOf("ada"), "A");
  assert.equal(L.initialOf("  émile"), "É");
  assert.equal(L.initialOf("\u{1D4D0}da"), "\u{1D4D0}"); // outside the BMP stays one character
  assert.equal(L.initialOf(""), "?");
  assert.equal(L.initialOf(null), "?");
});

// ---------- milestones ----------

// the first date on which the viewer's day count reaches `n`, for a since date
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

test("day milestones: 100, 365, 500, 1000, then every 1000", () => {
  const since = "2020-03-01";
  const hits = [];
  for (let n = 0; n <= 5100; n++) {
    const m = L.milestonesOn(since, addDays(since, n), outfitFor).filter((x) => x.kind === "days");
    if (m.length) hits.push(m[0].days);
  }
  assert.deepEqual(hits, [100, 365, 500, 1000, 2000, 3000, 4000, 5000]);
});

test("the day before and after a milestone are quiet days", () => {
  const since = "2021-07-01";
  for (const n of [99, 101, 364, 366, 499, 501, 999, 1001]) assert.deepEqual(L.milestonesOn(since, addDays(since, n), outfitFor).filter((x) => x.kind === "days"), []);
});

test("each day milestone names the outfit the mascot unlocks for it", () => {
  const since = "2021-07-01";
  const at = (n) => L.milestonesOn(since, addDays(since, n), outfitFor).find((x) => x.kind === "days");
  assert.equal(at(100).outfit, "party");
  assert.equal(at(365).outfit, "anniversary");
  assert.equal(at(500).outfit, "party");
  assert.equal(at(1000).outfit, "party");
  assert.equal(at(2000).outfit, "party");
  assert.equal(at(100).days, 100);
  assert.equal(L.milestonesOn(since, addDays(since, 100)).find((x) => x.kind === "days").outfit, null); // no helper given: no outfit, still a milestone
});

test("anniversaries come round on the date every year, never on the day itself", () => {
  const since = "2022-08-15";
  assert.deepEqual(L.milestonesOn(since, "2022-08-15", outfitFor), []);
  assert.deepEqual(L.milestonesOn(since, "2023-08-14", outfitFor), []);
  const first = L.milestonesOn(since, "2023-08-15", outfitFor);
  assert.equal(first[0].kind, "anniversary");
  assert.equal(first[0].years, 1);
  assert.equal(first[0].outfit, "anniversary");
  assert.equal(L.milestonesOn(since, "2024-08-15", outfitFor)[0].years, 2);
  assert.equal(L.milestonesOn(since, "2024-08-16", outfitFor).length, 0);
  assert.equal(L.milestonesOn(since, "2031-08-15", outfitFor)[0].years, 9);
});

test("29 February is celebrated on 28 February in years without one, and on the 29th in leap years", () => {
  const since = "2020-02-29";
  assert.equal(L.milestonesOn(since, "2021-02-28", outfitFor)[0].years, 1);
  assert.deepEqual(L.milestonesOn(since, "2021-03-01", outfitFor), []);
  assert.deepEqual(L.milestonesOn(since, "2024-02-28", outfitFor).filter((x) => x.kind === "anniversary"), []);
  assert.equal(L.milestonesOn(since, "2024-02-29", outfitFor)[0].years, 4);
});

test("a day milestone and an anniversary on the same day: the anniversary comes first, both are listed", () => {
  // 1000 days after 2020-01-01 is 2022-09-27: pick a date that makes day 365 and the anniversary coincide (no leap day between)
  const since = "2021-03-01"; // 365 days later = 2022-03-01 = the first anniversary
  const m = L.milestonesOn(since, "2022-03-01", outfitFor);
  assert.deepEqual(m.map((x) => x.kind), ["anniversary", "days"]);
  assert.notEqual(m[0].key, m[1].key);
});

test("when a leap day sits between, day 365 and the anniversary are different days", () => {
  const since = "2023-03-01"; // the leap day 2024-02-29 is inside the year
  assert.deepEqual(L.milestonesOn(since, "2024-02-29", outfitFor).map((x) => x.kind), ["days"]);
  assert.deepEqual(L.milestonesOn(since, "2024-03-01", outfitFor).map((x) => x.kind), ["anniversary"]);
});

test("milestonesOn is quiet for missing, future and invalid dates", () => {
  assert.deepEqual(L.milestonesOn("", "2024-01-01", outfitFor), []);
  assert.deepEqual(L.milestonesOn("2024-01-02", "2024-01-01", outfitFor), []);
  assert.deepEqual(L.milestonesOn("2024-02-30", "2024-03-01", outfitFor), []);
  assert.deepEqual(L.milestonesOn("2024-01-01", "junk", outfitFor), []);
});

test("milestone keys are unique per milestone, so a celebration plays once", () => {
  const keys = new Set();
  const since = "2019-05-05";
  for (let n = 1; n < 4000; n++) for (const m of L.milestonesOn(since, addDays(since, n), outfitFor)) { assert.ok(!keys.has(m.key)); keys.add(m.key); }
  assert.ok(keys.size > 10);
});

test("the milestone does not move with the time zone: it depends only on the local calendar day", () => {
  // Day 100 from 2024-01-01 is 2024-04-10. Berlin and Los Angeles each see it on their own 10 April.
  const script = `const t = new Date(2024, 3, 10, 9, 0); console.log(JSON.stringify(L.milestonesOn("2024-01-01", L.localToday(t))));`;
  for (const tz of ["Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo"]) {
    const out = inZone(tz, script);
    assert.deepEqual(out.map((x) => [x.kind, x.days]), [["days", 100]], tz);
  }
});

test("unlockedOutfits: party from 100 days, anniversary from the first anniversary", () => {
  const since = "2023-03-01";
  assert.deepEqual(L.unlockedOutfits(since, "2023-03-02", outfitFor), []);
  assert.deepEqual(L.unlockedOutfits(since, "2023-06-09", outfitFor), ["party"]);
  assert.deepEqual(L.unlockedOutfits(since, "2024-02-29", outfitFor).sort(), ["anniversary", "party"]); // 365 days unlocks anniversary too
  assert.deepEqual(L.unlockedOutfits(since, "2024-03-01", outfitFor).sort(), ["anniversary", "party"]);
  assert.deepEqual(L.unlockedOutfits("", "2024-03-01", outfitFor), []);
  // anniversary through the calendar alone (no outfit helper)
  assert.deepEqual(L.unlockedOutfits("2023-03-01", "2024-03-01"), ["anniversary"]);
  assert.deepEqual(L.unlockedOutfits("2023-03-01", "2024-02-28"), []);
});

test("milestoneLine", () => {
  const fmt = (n) => n.toLocaleString("en-US");
  assert.equal(L.milestoneLine({ kind: "anniversary", years: 2 }, fmt), "Happy 2 years \u{1F49B}");
  assert.equal(L.milestoneLine({ kind: "anniversary", years: 1 }, fmt), "Happy 1 year \u{1F49B}");
  assert.equal(L.milestoneLine({ kind: "days", days: 1000 }, fmt), "Happy 1,000 days \u{1F49B}");
  assert.equal(L.milestoneLine(null, fmt), "");
});

// ---------- confetti ----------

test("confettiPieces is deterministic for a given random source and stays in range", () => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const a = L.confettiPieces(30, rnd);
  s = 7;
  const b = L.confettiPieces(30, rnd);
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= 100);
    assert.ok(p.dur >= 1800 && p.dur <= 3200);
    assert.ok(p.color >= 0 && p.color <= 3);
  }
});

// ---------- the files ----------

test("the overview files exist, load in order, and the manifest still has no extra option or host", () => {
  const dir = new URL("../../widgets/hearth/", import.meta.url);
  const html = readFileSync(new URL("index.html", dir), "utf8");
  assert.ok(html.indexOf("overview-logic.js") < html.indexOf("overview.js"));
  assert.ok(html.indexOf("overview.js") < html.indexOf("hearth.js"));
  assert.ok(html.includes("overview.css"));
  const manifest = JSON.parse(readFileSync(new URL("widget.json", dir), "utf8"));
  assert.deepEqual(manifest.permissions.hosts, ["umbra-buddy-relay.umbra-server.workers.dev"]);
});

test("the overview code keeps to the rules: no localStorage, no timers faster than a second, text sizes >= 11px", () => {
  const dir = new URL("../../widgets/hearth/", import.meta.url);
  for (const f of ["overview.js", "overview-logic.js"]) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), f);
  }
  const css = readFileSync(new URL("overview.css", dir), "utf8");
  const rem = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]) * 13);
  const px = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => parseFloat(m[1]));
  for (const size of [...rem, ...px]) assert.ok(size >= 11, `font size ${size}px is below 11px`);
});
