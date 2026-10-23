import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const P = require("../../widgets/hearth/pet-logic.js");
const M = require("../../widgets/hearth/mascot.js");
const dir = new URL("../../widgets/hearth/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");

// ---------- a relay pet, shaped like tools/umbra-relay/README.md ("Pet") ----------

const T0 = Date.parse("2026-06-01T12:00:00Z");
const HOUR = 3600000;
const README_PET = {
  food: 62, water: 48, love: 70, mood: "content",
  level: 2, xp: 7, nextXp: 16,
  bond: { day: "2026-06-01", a: true, b: false, done: false, streak: 3 },
  decayPerHour: { food: 1.25, water: 1.875, love: 0.9375 }, min: 10,
};
const pet = (over = {}) => Object.assign(structuredClone(README_PET), over);
const base = (over, asOf = T0) => ({ pet: P.parsePet(pet(over)), asOf, trusted: true });

// What the relay itself computes (tools/umbra-relay/hearth.js), written out here so the client's copy of the curve is checked against it.
const relayLevel = (xp) => Math.min(50, 1 + Math.floor(Math.sqrt(xp / 4)));
const relayNextXp = (level) => (level >= 50 ? null : 4 * level * level);

// ---------- reading the relay ----------

test("parsePet reads the README example", () => {
  const p = P.parsePet(README_PET);
  assert.equal(p.food, 62); assert.equal(p.water, 48); assert.equal(p.love, 70);
  assert.equal(p.mood, "content"); assert.equal(p.level, 2); assert.equal(p.xp, 7); assert.equal(p.nextXp, 16);
  assert.deepEqual(p.bond, { day: "2026-06-01", a: true, b: false, done: false, streak: 3 });
  assert.deepEqual(p.rate, { food: 1.25, water: 1.875, love: 0.9375 });
  assert.equal(p.min, 10);
});

test("parsePet rejects things that are not a pet and survives odd fields", () => {
  assert.equal(P.parsePet(null), null);
  assert.equal(P.parsePet({}), null);
  assert.equal(P.parsePet({ food: "x", water: 1, love: 1 }), null);
  const p = P.parsePet({ food: 50, water: 50, love: 50, mood: "dead", nextXp: null, bond: { day: "nope", a: 1, b: 1 } });
  assert.equal(p.mood, "", "an unknown mood word is dropped, there is no dead state to show");
  assert.equal(p.nextXp, null);
  assert.equal(p.bond.done, true); assert.equal(p.bond.day, ""); assert.equal(p.bond.streak, 0);
  assert.deepEqual(p.rate, P.DEFAULT_RATE);
  assert.equal(P.parsePet({ food: 500, water: -4, love: 50 }).food, 100);
  assert.equal(P.parsePet({ food: 500, water: -4, love: 50 }).water, 0);
});

test("petSig changes when the relay wrote, not when the word for the mood changed", () => {
  const a = P.parsePet(pet()), b = P.parsePet(pet({ mood: "happy" }));
  assert.equal(P.petSig(a), P.petSig(b));
  assert.notEqual(P.petSig(a), P.petSig(P.parsePet(pet({ xp: 8 }))));
  assert.notEqual(P.petSig(a), P.petSig(P.parsePet(pet({ bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 3 } }))));
});

// ---------- levels and xp agree with the relay ----------

test("the level curve matches the relay's level and nextXp for every xp", () => {
  for (let xp = 0; xp < 12000; xp++) {
    const level = relayLevel(xp);
    assert.equal(P.levelOfXp(xp), level, "level at xp " + xp);
    assert.equal(P.nextXpAt(level), relayNextXp(level), "nextXp at level " + level);
    assert.equal(P.curveAgrees({ level, xp, nextXp: relayNextXp(level) }), true);
  }
});

test("level boundaries: level L starts at 4 (L - 1)^2 xp and the README example fits", () => {
  assert.equal(P.xpAtLevel(1), 0); assert.equal(P.xpAtLevel(2), 4); assert.equal(P.xpAtLevel(3), 16); assert.equal(P.xpAtLevel(50), 9604);
  assert.equal(P.levelOfXp(3), 1); assert.equal(P.levelOfXp(4), 2); assert.equal(P.levelOfXp(15), 2); assert.equal(P.levelOfXp(16), 3);
  assert.equal(P.levelOfXp(1e9), 50);
  assert.equal(P.curveAgrees(P.parsePet(README_PET)), true);
  assert.equal(P.curveAgrees({ level: 2, xp: 7, nextXp: 20 }), false);
});

test("progress shows the relay's numbers and handles the maximum level", () => {
  const p = P.progress(P.parsePet(README_PET));
  assert.equal(p.level, 2); assert.equal(p.floorXp, 4); assert.equal(p.nextXp, 16); assert.equal(p.toGo, 9);
  assert.ok(Math.abs(p.fraction - 0.25) < 1e-9);
  const top = P.progress({ level: 50, xp: 20000, nextXp: null });
  assert.equal(top.maxed, true); assert.equal(top.fraction, 1); assert.equal(top.toGo, 0);
  const fresh = P.progress({ level: 1, xp: 0, nextXp: 4 });
  assert.equal(fresh.fraction, 0);
  // a relay that disagrees with the curve is still displayed with its own numbers and never leaves 0..1
  const odd = P.progress({ level: 3, xp: 5, nextXp: 40 });
  assert.ok(odd.fraction >= 0 && odd.fraction <= 1);
});

// ---------- decay between syncs ----------

test("the idle sync does not resend the pet, so the stats fall by decayPerHour", () => {
  const c = P.current(base(), T0 + 10 * HOUR);
  assert.equal(c.food, 50);   // 62 - 12.5
  assert.equal(c.water, 29);  // 48 - 18.75
  assert.equal(c.love, 61);   // 70 - 9.375
  assert.equal(c.level, 2); assert.equal(c.xp, 7); assert.equal(c.nextXp, 16);
});

test("stats stop at the relay's minimum: a pet nobody feeds for a year is sad at 10 and not gone", () => {
  const c = P.current(base(), T0 + 365 * 24 * HOUR);
  assert.deepEqual([c.food, c.water, c.love], [10, 10, 10]);
  assert.equal(c.bucket, "sad");
  assert.equal(P.displayMood(c, { mascot: M }), "sad");
});

test("a saved snapshot without a server time is not extrapolated", () => {
  const c = P.current({ pet: P.parsePet(pet()), asOf: 0, trusted: false }, T0 + 100 * HOUR);
  assert.deepEqual([c.food, c.water, c.love], [62, 48, 70]);
});

test("the relay's own mood is used while the answer is fresh, ours once it ages", () => {
  const fresh = P.current(base({ food: 100, water: 100, love: 20, mood: "content" }), T0 + 30000);
  assert.equal(fresh.bucket, "content");
  const aged = P.current(base({ food: 100, water: 100, love: 100, mood: "content" }), T0 + 3 * HOUR);
  assert.equal(aged.bucket, "happy");
  assert.equal(P.bucketOf(70, 70, 70), "happy"); assert.equal(P.bucketOf(35, 35, 35), "content"); assert.equal(P.bucketOf(10, 10, 10), "sad");
});

test("the bond starts over at UTC midnight and the streak survives exactly one day", () => {
  const done = P.parsePet(pet({ bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 3 } }));
  assert.deepEqual(P.rollBond(done.bond, T0), done.bond);
  const next = P.rollBond(done.bond, Date.parse("2026-06-02T00:00:01Z"));
  assert.deepEqual(next, { day: "2026-06-02", a: false, b: false, done: false, streak: 3 });
  assert.equal(P.rollBond(done.bond, Date.parse("2026-06-03T00:00:01Z")).streak, 0, "a missed day resets it");
  const partial = P.parsePet(pet({ bond: { day: "2026-06-01", a: true, b: false, done: false, streak: 3 } }));
  assert.equal(P.rollBond(partial.bond, Date.parse("2026-06-02T08:00:00Z")).streak, 0, "yesterday was not completed");
  const none = P.parsePet(pet({ bond: { day: "2026-06-01", a: false, b: false, done: false, streak: 0 } }));
  assert.equal(P.rollBond(none.bond, Date.parse("2026-06-09T00:00:00Z")).streak, 0);
  assert.equal(P.current(base({ bond: done.bond }), Date.parse("2026-06-02T01:00:00Z")).bond.done, false);
  assert.equal(P.msToUtcMidnight(Date.parse("2026-06-01T23:00:00Z")), HOUR);
  assert.equal(P.utcDay(Date.parse("2026-06-01T23:59:59Z")), "2026-06-01");
});

// ---------- optimistic care ----------

test("applyCare raises the stat by the README gain, caps at 100, sets my side and guesses nothing else", () => {
  const b = P.applyCare(base(), "feed", T0, "b");
  const c = P.current(b, T0);
  assert.equal(c.food, 97); assert.equal(c.water, 48); assert.equal(c.love, 70);
  assert.equal(c.xp, 7, "xp comes from the relay"); assert.equal(c.level, 2);
  assert.equal(c.bond.a, true); assert.equal(c.bond.b, true); assert.equal(c.bond.done, true, "both have cared now");
  assert.equal(P.current(P.applyCare(base({ food: 90 }), "feed", T0, "a"), T0).food, 100);
  assert.equal(P.current(P.applyCare(base(), "pet", T0, "a"), T0).love, 95);
  assert.equal(P.current(P.applyCare(base(), "water", T0, "a"), T0).water, 83);
  assert.equal(P.applyCare(base(), "nope", T0, "a").asOf, T0, "an unknown action changes nothing");
});

test("applyCare starts from the decayed value, like the relay", () => {
  const c = P.current(P.applyCare(base(), "water", T0 + 10 * HOUR, "a"), T0 + 10 * HOUR);
  assert.equal(c.water, 64); // 48 - 18.75 + 35 = 64.25
});

test("careOutcome sorts the relay's answers", () => {
  const ok = P.careOutcome({ ok: true, pet: pet({ food: 97 }) });
  assert.equal(ok.kind, "ok"); assert.equal(ok.pet.food, 97);
  assert.deepEqual(P.careOutcome({ error: "too soon", retryIn: 272 }), { kind: "wait", retryIn: 272 });
  assert.equal(P.careOutcome({ error: "too soon" }).retryIn, P.COOLDOWN_S);
  assert.equal(P.careOutcome({ error: "bad action" }).kind, "error");
  assert.equal(P.careOutcome({ ok: true }).kind, "error", "an answer without a pet is not a success");
  assert.equal(P.careOutcome(null).kind, "error");
});

test("cooldown helpers", () => {
  assert.equal(P.cooldownLeft({ feed: T0 + 272000 }, "feed", T0), 272);
  assert.equal(P.cooldownLeft({ feed: T0 + 271001 }, "feed", T0), 272);
  assert.equal(P.cooldownLeft({ feed: T0 - 5 }, "feed", T0), 0);
  assert.equal(P.cooldownLeft({}, "feed", T0), 0);
  assert.equal(P.fmtClock(272), "4:32"); assert.equal(P.fmtClock(300), "5:00"); assert.equal(P.fmtClock(9), "0:09"); assert.equal(P.fmtClock(-3), "0:00");
});

// ---------- the face ----------

const faceOf = (over, opts) => P.displayMood(P.current(base(over), T0 + 1000), Object.assign({ mascot: M }, opts));

test("moods come from the relay's real fields through HearthMascot.moodFor", () => {
  assert.equal(faceOf({ food: 80, water: 80, love: 80, mood: "happy" }), "happy");
  assert.equal(faceOf({ food: 62, water: 48, love: 70, mood: "content" }), "content");
  assert.equal(faceOf({ food: 20, water: 70, love: 70, mood: "content" }), "hungry");
  assert.equal(faceOf({ food: 70, water: 20, love: 70, mood: "content" }), "thirsty");
  assert.equal(faceOf({ food: 20, water: 15, love: 70, mood: "content" }), "thirsty", "the lower need wins");
  assert.equal(faceOf({ food: 70, water: 70, love: 40, mood: "content" }), "sleepy");
  assert.equal(faceOf({ food: 70, water: 70, love: 15, mood: "content" }), "sad");
});

test("the relay's sad wins over a single need, and the lowest state is sad (nothing below)", () => {
  assert.equal(faceOf({ food: 30, water: 30, love: 30, mood: "sad" }), "sad");
  assert.equal(faceOf({ food: 10, water: 10, love: 10, mood: "sad" }), "sad");
  const seen = new Set();
  for (const f of [10, 25, 40, 60, 90]) for (const w of [10, 25, 40, 60, 90]) for (const l of [10, 25, 40, 60, 90]) {
    seen.add(P.displayMood(P.current(base({ food: f, water: w, love: l, mood: "" }), T0 + 5 * 60000), { mascot: M }));
  }
  for (const m of seen) assert.ok(M.MOODS.includes(m), m + " is a mascot face");
  assert.ok(!seen.has("love"), "love is only a reaction to being petted");
});

test("the bond lifts content to happy, a pet gives the love face, and the hour is not passed", () => {
  const done = { bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 1 } };
  assert.equal(faceOf(Object.assign({ food: 62, water: 55, love: 60, mood: "content" }, done)), "happy");
  assert.equal(faceOf({}, { tapped: true }), "love");
  const calls = [];
  P.displayMood(P.current(base(), T0), { mascot: { moodFor: (s) => { calls.push(s); return "content"; } } });
  assert.equal("hour" in calls[0], false);
  assert.deepEqual([calls[0].hunger, calls[0].thirst, calls[0].affection], [62, 48, 70]);
});

// ---------- who cared ----------

test("a jump in a stat is a care by the partner; decay and our own answer are not", () => {
  const before = P.current(base(), T0 + 5 * 60000);
  const fed = P.parsePet(pet({ food: 97, bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 3 } }));
  const seen = P.detectPartnerCare(before, fed, "a");
  assert.deepEqual(seen.actions, ["feed"]); assert.equal(seen.bond, true);
  assert.equal(P.detectPartnerCare(before, P.parsePet(pet({ food: 62, water: 48, love: 70 })), "a"), null);
  const ownAlready = P.current(P.applyCare(base(), "feed", T0, "b"), T0 + 1000);
  assert.equal(P.detectPartnerCare(ownAlready, P.parsePet(pet({ food: 97, bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 3 } })), "b"), null);
  const both = P.detectPartnerCare(before, P.parsePet(pet({ food: 97, love: 95 })), "a");
  assert.deepEqual(both.actions, ["feed", "pet"]);
  // a care at a full stat shows only in the bond
  const full = P.current(base({ love: 100 }), T0);
  const bondOnly = P.detectPartnerCare(full, P.parsePet(pet({ love: 100, bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 3 } })), "a");
  assert.deepEqual(bondOnly, { actions: [], bond: true });
});

test("careLine names the partner and the pet", () => {
  assert.equal(P.careLine("Sam", "Ember", ["feed"]), "Sam fed Ember");
  assert.equal(P.careLine("Sam", "Ember", ["pet"]), "Sam petted Ember");
  assert.equal(P.careLine("Sam", "Ember", ["water"]), "Sam gave water to Ember");
  assert.equal(P.careLine("Sam", "Ember", ["feed", "pet"]), "Sam looked after Ember");
  assert.equal(P.careLine("", "", []), "Your partner looked after your blob");
});

// ---------- outfits ----------

test("levels and milestones unlock outfits, and the list never hides a locked one", () => {
  const at = (level, days) => P.unlockedIds(level, days);
  assert.deepEqual(at(1, 0), []);
  assert.deepEqual(at(2, null), ["bow"]);
  assert.deepEqual(at(5, 10), ["bow", "scarf", "glasses"]);
  assert.deepEqual(at(12, 99), ["bow", "scarf", "glasses", "hat", "flower-crown"]);
  assert.deepEqual(at(1, 100), ["party"]);
  assert.deepEqual(at(1, 400), ["party", "anniversary"], "a celebration outfit stays once earned");
  assert.equal(P.outfitList(1, null).length, M.OUTFITS.length, "every mascot outfit has an unlock rule");
  for (const id of M.OUTFITS) assert.ok(P.OUTFIT_UNLOCKS[id], id);
  for (const id of M.CELEBRATION_OUTFITS) assert.ok(P.OUTFIT_UNLOCKS[id].days, id + " is a milestone outfit");
  assert.equal(P.outfitList(1, null).find((o) => o.id === "hat").hint, "Level 8");
  assert.equal(P.outfitList(1, null).find((o) => o.id === "party").hint, "100 days");
  assert.equal(P.outfitList(1, null).find((o) => o.id === "party").full, "After 100 days together");
  assert.deepEqual(P.newlyUnlocked(at(2, 0), at(3, 0)), ["scarf"]);
});

test("choosing an outfit: one per slot, locked ones ignored, stale choices dropped", () => {
  const open = P.unlockedIds(12, 0);   // bow, scarf, glasses, hat, flower-crown
  let c = P.toggleOutfit([], "hat", open, M);
  assert.deepEqual(c, ["hat"]);
  c = P.toggleOutfit(c, "glasses", open, M);
  assert.deepEqual(c, ["hat", "glasses"]);
  c = P.toggleOutfit(c, "flower-crown", open, M);
  assert.deepEqual(c, ["flower-crown", "glasses"], "the same slot is replaced");
  c = P.toggleOutfit(c, "glasses", open, M);
  assert.deepEqual(c, ["flower-crown"], "tapping a worn outfit takes it off");
  assert.deepEqual(P.toggleOutfit(c, "party", open, M), ["flower-crown"], "locked");
  assert.deepEqual(P.sanitizeOutfit(["hat", "party", "ghost", 5], P.unlockedIds(8, 0), M), ["hat"]);
  assert.deepEqual(P.sanitizeOutfit(null, open, M), []);
});

// ---------- naming ----------

test("pet names follow the relay's rule: 1..20 letters, marks, digits, space ' . -", () => {
  assert.deepEqual(P.cleanName("  Ember  "), { ok: true, name: "Ember", error: "" });
  assert.equal(P.cleanName("Mr   Pip").name, "Mr Pip");
  assert.equal(P.cleanName("O'Neil-Jr.").ok, true);
  assert.equal(P.cleanName("Blümchen").ok, true);
  assert.equal(P.cleanName("小さな").ok, true);
  assert.equal(P.cleanName("A".repeat(20)).ok, true);
  assert.equal(P.cleanName("A".repeat(21)).ok, false);
  assert.match(P.cleanName("A".repeat(21)).error, /20/);
  assert.equal(P.cleanName("\u{1D49C}".repeat(20)).ok, true, "20 characters, counted as characters and not as UTF-16 units");
  assert.equal(P.cleanName("").ok, false); assert.equal(P.cleanName("   ").ok, false); assert.equal(P.cleanName(null).ok, false);
  assert.equal(P.cleanName("Pip!").ok, false); assert.equal(P.cleanName("a,b").ok, false); assert.equal(P.cleanName("Pip\u{1F600}").ok, false);
  assert.equal(P.cleanName("<b>").ok, false);
  assert.match(P.nameProblem("bad name"), /20/);
  assert.ok(P.nameProblem("server error").length > 5);
});

// ---------- speech bubbles ----------

const names = { you: "Amine", partner: "Sam" };
const ctxFor = (over, now = T0) => {
  const c = P.current(base(over.pet || {}), now);
  return Object.assign({ trigger: "idle", names, me: "a", petName: "Ember", pet: c, mood: P.displayMood(c, { mascot: M }), bubbles: {}, now, pick: () => 0 }, over.ctx);
};

test("my own care answers with a short line, a recovery line, or the bond line", () => {
  assert.equal(P.chooseBubble(ctxFor({ ctx: { trigger: "feed" } })).text, P.LINES.feed[0]);
  assert.match(P.chooseBubble(ctxFor({ ctx: { trigger: "pet", wasSad: true } })).text, /feel so much better/);
  assert.match(P.chooseBubble(ctxFor({ ctx: { trigger: "water", bondJustDone: true } })).text, /both visited me today/);
  assert.match(P.chooseBubble(ctxFor({ ctx: { trigger: "wait", retryIn: 272 } })).text, /4:32/);
  assert.match(P.chooseBubble(ctxFor({ ctx: { trigger: "level", level: 3, newOutfit: "Scarf" } })).text, /Level 3.*Scarf/);
  assert.equal(P.chooseBubble(ctxFor({ ctx: { trigger: "partner", line: "Sam fed Ember" } })).text, "Sam fed Ember");
  assert.equal(P.chooseBubble(ctxFor({ ctx: { trigger: "nonsense" } })), null);
});

test("unprompted lines use the partners' names", () => {
  // I cared, Sam did not
  assert.equal(P.chooseBubble(ctxFor({})).text, "Sam has not visited me today.");
  // Sam cared, I did not
  const sam = { pet: { bond: { day: "2026-06-01", a: false, b: true, done: false, streak: 0 } } };
  assert.equal(P.chooseBubble(ctxFor(sam)).text, "Sam visited me today. Your turn, Amine!");
  // nobody yet
  const none = { pet: { bond: { day: "2026-06-01", a: false, b: false, done: false, streak: 0 } } };
  assert.match(P.chooseBubble(ctxFor(none)).text, /Hello, Amine/);
  // both
  const both = { pet: { bond: { day: "2026-06-01", a: true, b: true, done: true, streak: 2 } } };
  assert.match(P.chooseBubble(ctxFor(both)).text, /both visited me today/);
  // from Sam's side the words swap
  assert.equal(P.chooseBubble(ctxFor({ ctx: { me: "b", names: { you: "Sam", partner: "Amine" } } })).text, "Amine visited me today. Your turn, Sam!");
});

test("a neglected pet is sad and says it is staying", () => {
  const sad = ctxFor({ pet: { food: 10, water: 10, love: 10, mood: "sad", bond: { day: "2026-06-01", a: false, b: false, done: false, streak: 0 } } });
  const b = P.chooseBubble(sad);
  assert.equal(b.id, "sad");
  assert.match(b.text, /not going anywhere/);
  assert.doesNotMatch(b.text, /die|dead|gone|leave/i);
});

test("bubbles are rate limited: one per 10 minutes, the same line at most every 2 hours", () => {
  const first = P.chooseBubble(ctxFor({}));
  assert.ok(first);
  const gap = P.BUBBLE.minGapMs;
  assert.equal(P.chooseBubble(ctxFor({ ctx: { bubbles: { [first.id]: T0 - 1000 } } })), null, "too soon after any bubble");
  assert.equal(P.chooseBubble(ctxFor({ ctx: { bubbles: { other: T0 - gap + 1000 } } })), null);
  assert.equal(P.chooseBubble(ctxFor({ ctx: { bubbles: { [first.id]: T0 - gap - 1000 } } })), null, "same line again before 2 hours");
  assert.equal(P.chooseBubble(ctxFor({ ctx: { bubbles: { [first.id]: T0 - P.BUBBLE.repeatMs - 1 } } })).id, first.id);
  // simulate a whole day of checks every 5 minutes: never more than 1 per 10 minutes
  let seen = {}, shown = 0, lastAt = -Infinity;
  for (let t = T0; t < T0 + 24 * HOUR; t += 5 * 60000) {
    const b = P.chooseBubble(ctxFor({ ctx: { bubbles: seen } }, t));
    if (b) { assert.ok(t - lastAt >= gap); lastAt = t; seen = Object.assign({}, seen, { [b.id]: t }); shown++; }
  }
  assert.ok(shown >= 1 && shown <= 24, "shown " + shown + " times in a day");
});

// ---------- the files ----------

test("pet files: no unsafe storage, every button is no-drag, text stays 11 px or larger, motion goes through --motion-scale", () => {
  const js = read("pet.js"), css = read("pet.css"), logic = read("pet-logic.js");
  for (const src of [js, logic]) assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|eval\(|new Function/);
  for (const m of js.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /data-no-drag/, m[0]);
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)].map((m) => (m[2] === "rem" ? parseFloat(m[1]) * 13 : parseFloat(m[1])));
  assert.ok(sizes.length > 5);
  assert.ok(Math.min(...sizes) >= 11, "smallest font " + Math.min(...sizes) + " px (the root is 13 px)");
  for (const m of css.matchAll(/animation:[^;]*;/g)) assert.match(m[0], /--motion-scale|none/, m[0]);
});

test("the shell loads the pet files in order and hands the pet element to HearthPet.attach", () => {
  const html = read("index.html"), shell = read("hearth.js");
  const order = ["mascot.js", "hearth-core.js", "pet-logic.js", "pet.js", "hearth.js"].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((n) => n > 0), "all scripts present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "scripts in dependency order");
  assert.ok(html.indexOf('href="pet.css"') > html.indexOf('href="hearth.css"'));
  assert.match(shell, /HearthPet\.attach\(pet, client\)/);
});
