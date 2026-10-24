// Hearth pet logic (#214): the pure part of the Pet view. No DOM, no network, no timers; tests/widgets/hearth-pet.test.mjs
// drives it with fake relay answers shaped like tools/umbra-relay/README.md ("Pet").
// Browser: window.HearthPetLogic. Node: module.exports.
//
// THE RELAY OWNS THE RULES. Stats decay on its clock, cooldowns are per side and action, xp and levels, the daily bond and the
// streak are computed there (UTC day). This file only
//   * reads what the relay returned (`parsePet`),
//   * shows the decay between two syncs, exactly as the README says a client may ("max(min, value - decayPerHour * hours)"),
//   * makes an optimistic guess for the instant after a click (README numbers; replaced by the answer of `care`),
//   * decides what the client alone decides: which face, which speech bubble, which outfits are unlocked, name checks.
//
// Not in the relay today (see the PR): outfits (no field, no route), who cared and with what (inferred below from jumps in
// the numbers), and the hungry/thirsty/sleepy faces (the relay mood is only happy | content | sad).
(function (root) {
  "use strict";

  // ---------- constants from the README ----------

  const STATS = Object.freeze(["food", "water", "love"]);
  /** care?action=...  `gain` is the README's number and is used for the optimistic preview only. */
  const ACTIONS = Object.freeze({
    feed: Object.freeze({ id: "feed", stat: "food", gain: 35, label: "Feed", verb: "fed" }),
    water: Object.freeze({ id: "water", stat: "water", gain: 35, label: "Water", verb: "gave water to" }),
    pet: Object.freeze({ id: "pet", stat: "love", gain: 25, label: "Pet", verb: "petted" }),
  });
  const ACTION_IDS = Object.freeze(["feed", "water", "pet"]);
  const DEFAULT_RATE = Object.freeze({ food: 1.25, water: 1.875, love: 0.9375 }); // used only when a (old) answer has no decayPerHour
  const MIN_STAT = 10, MAX_STAT = 100;
  const COOLDOWN_S = 300;            // "Each side may repeat an action after 5 minutes"; the real value always comes from `retryIn`
  const MAX_LEVEL = 50;
  const NAME_MAX = 20;
  const BUCKETS = Object.freeze(["happy", "content", "sad"]);

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

  // ---------- UTC days (the relay's "day") ----------

  const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const prevDay = (day) => utcDay(Date.parse(day + "T00:00:00Z") - 86400000);
  /** Milliseconds until the next UTC midnight (the bond starts over then). */
  const msToUtcMidnight = (ms) => 86400000 - (((ms % 86400000) + 86400000) % 86400000);

  // ---------- levels and xp ----------

  /** The relay's curve: level = min(50, 1 + floor(sqrt(xp / 4))). The relay's own `level` is what is shown. */
  const levelOfXp = (xp) => Math.min(MAX_LEVEL, 1 + Math.floor(Math.sqrt(Math.max(0, num(xp, 0)) / 4)));
  /** xp where `level` starts, and the xp the relay calls `nextXp` for that level (= where level + 1 starts). */
  const xpAtLevel = (level) => (level <= 1 ? 0 : 4 * (level - 1) * (level - 1));
  const nextXpAt = (level) => (level >= MAX_LEVEL ? null : 4 * level * level);

  /** True when the relay's level, xp and nextXp agree with the curve above (the tests pin it; the UI never depends on it). */
  const curveAgrees = (pet) => !!pet && pet.level === levelOfXp(pet.xp) && pet.nextXp === nextXpAt(pet.level);

  /** { level, xp, nextXp, floorXp, fraction 0..1, maxed }. Uses the relay's numbers; the curve only supplies where the level started. */
  function progress(pet) {
    const level = Math.max(1, Math.floor(num(pet && pet.level, 1)));
    const xp = Math.max(0, num(pet && pet.xp, 0));
    const nextXp = pet && pet.nextXp !== null && pet.nextXp !== undefined && Number.isFinite(Number(pet.nextXp)) ? Number(pet.nextXp) : null;
    const maxed = nextXp === null;
    const floorXp = Math.min(xp, xpAtLevel(level));
    const span = maxed ? 0 : Math.max(1, nextXp - floorXp);
    return { level, xp, nextXp, floorXp, maxed, fraction: maxed ? 1 : clamp((xp - floorXp) / span, 0, 1), toGo: maxed ? 0 : Math.max(0, nextXp - xp) };
  }

  // ---------- reading the relay's pet ----------

  /** A clean pet from `sync.pet` or the answer to `care`, or null when it is not one. Stats stay as sent. */
  function parsePet(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!STATS.every((k) => Number.isFinite(Number(raw[k])))) return null;
    const rate = raw.decayPerHour && typeof raw.decayPerHour === "object" ? raw.decayPerHour : {};
    const b = raw.bond && typeof raw.bond === "object" ? raw.bond : {};
    const bond = { day: /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : "", a: !!b.a, b: !!b.b, done: !!(b.a && b.b), streak: Math.max(0, Math.floor(num(b.streak, 0))) };
    return {
      food: clamp(num(raw.food, 0), 0, MAX_STAT), water: clamp(num(raw.water, 0), 0, MAX_STAT), love: clamp(num(raw.love, 0), 0, MAX_STAT),
      mood: BUCKETS.includes(raw.mood) ? raw.mood : "",
      level: Math.max(1, Math.floor(num(raw.level, 1))), xp: Math.max(0, num(raw.xp, 0)),
      nextXp: raw.nextXp === null ? null : Number.isFinite(Number(raw.nextXp)) ? Number(raw.nextXp) : nextXpAt(Math.max(1, Math.floor(num(raw.level, 1)))),
      bond,
      rate: { food: num(rate.food, DEFAULT_RATE.food), water: num(rate.water, DEFAULT_RATE.water), love: num(rate.love, DEFAULT_RATE.love) },
      min: clamp(num(raw.min, MIN_STAT), 0, MAX_STAT),
    };
  }

  /** A change detector for "is this a new pet answer": the numbers that move when the relay writes (not the extrapolation). */
  const petSig = (p) => (p ? [p.food, p.water, p.love, p.xp, p.level, p.bond.day, p.bond.a, p.bond.b, p.bond.streak].join("|") : "");

  // ---------- showing the decay between syncs ----------

  /** The bond as it reads on the UTC day of `nowMs`: a new day empties it, and the streak survives only one missed-free day. */
  function rollBond(bond, nowMs) {
    const day = utcDay(nowMs);
    if (!bond.day || day <= bond.day) return Object.assign({}, bond);
    // The day the streak last counted: the answer's own day when it was done, else the day before it (when there was a streak at all).
    const lastDone = bond.done ? bond.day : bond.streak > 0 ? prevDay(bond.day) : "";
    return { day, a: false, b: false, done: false, streak: lastDone && lastDone === prevDay(day) ? bond.streak : 0 };
  }

  /** happy | content | sad from the three stats. Mirrors tools/umbra-relay/hearth.js petView (average >= 65 / >= 35); the README
   *  only promises the three words. Used while extrapolating; a fresh answer's own `mood` wins (see `current`). */
  const bucketOf = (food, water, love) => { const avg = (food + water + love) / 3; return avg >= 65 ? "happy" : avg >= 35 ? "content" : "sad"; };

  /**
   * The pet at `nowMs` from a base { pet, asOf, trusted } (asOf = the server time the stats are from).
   * Stats fall linearly and stop at `min`. Without a trusted asOf (a saved snapshot before the first sync) nothing is extrapolated.
   * Returns whole-number stats, the relay's level/xp/nextXp, the bond rolled to today, `bucket` and `ageMs`.
   */
  function current(base, nowMs) {
    const p = base.pet;
    const hours = base.trusted ? Math.max(0, nowMs - base.asOf) / 3600000 : 0;
    const exact = {};
    for (const k of STATS) exact[k] = Math.max(Math.min(p.min, p[k]), Math.min(MAX_STAT, p[k] - p.rate[k] * hours));
    const food = Math.round(exact.food), water = Math.round(exact.water), love = Math.round(exact.love);
    const ageMs = base.trusted ? Math.max(0, nowMs - base.asOf) : 0;
    const bucket = p.mood && ageMs < 120000 ? p.mood : bucketOf(food, water, love);
    return {
      food, water, love, exact, bucket, ageMs,
      level: p.level, xp: p.xp, nextXp: p.nextXp,
      bond: base.trusted ? rollBond(p.bond, nowMs) : Object.assign({}, p.bond),
      min: p.min,
    };
  }

  /**
   * The instant after a click, before the relay answers: the stat goes up by the README's gain (capped at 100) and our side of
   * today's bond is set. xp, level and streak are NOT guessed; they arrive with the answer. Returns a new base.
   */
  function applyCare(base, action, nowMs, me) {
    const a = ACTIONS[action];
    if (!a) return base;
    const cur = current(base, nowMs);
    const p = Object.assign({}, base.pet, { mood: "" });
    for (const k of STATS) p[k] = cur.exact[k];
    p[a.stat] = Math.min(MAX_STAT, p[a.stat] + a.gain);
    const bond = Object.assign({}, cur.bond);
    if (me === "a" || me === "b") bond[me] = true;
    bond.done = bond.a && bond.b;
    p.bond = bond;
    return { pet: p, asOf: nowMs, trusted: true };
  }

  /** Who has cared today from my side: { you, partner } booleans. */
  const bondSides = (bond, me) => ({ you: !!bond[me === "b" ? "b" : "a"], partner: !!bond[me === "b" ? "a" : "b"] });

  // ---------- the face ----------

  function mascotApi() {
    if (root.HearthMascot) return root.HearthMascot;
    if (typeof require === "function") { try { return require("./mascot.js"); } catch (e) { /* no mascot */ } }
    return null;
  }

  /**
   * The mascot mood for the pet now. Inputs to HearthMascot.moodFor (needs 0..100, 100 = full):
   *   hunger = food, thirst = water, affection = love.
   * Tuning for the relay (the mascot module is untouched):
   *   * the relay bottoms out at 10, so every face is reachable; the mascot's thresholds are used as they are
   *     (love < 25 sad, food or water < 30 hungry or thirsty, love < 45 sleepy, all >= 70 or bonded happy).
   *   * when the relay's own bucket says "sad" (the average is low) the face is sad whatever the single numbers say.
   *   * `hour` is NOT passed: moodFor would make the pet sleepy every night and hide the result of care.
   *   * `bonded` (both partners cared today) lifts content to happy: the bond's bonus mood.
   *   * `tapped` shows the "love" face for a moment after a pet.
   */
  function displayMood(pet, opts) {
    const o = opts || {};
    const M = o.mascot || mascotApi();
    const input = { hunger: pet.food, thirst: pet.water, affection: pet.bucket === "sad" ? Math.min(pet.love, 24) : pet.love, bonded: !!pet.bond.done, tapped: !!o.tapped };
    if (M && typeof M.moodFor === "function") return M.moodFor(input);
    return o.tapped ? "love" : pet.bucket === "sad" ? "sad" : pet.bucket === "happy" ? "happy" : "content"; // no mascot module: the relay's word
  }

  // ---------- cooldowns ----------

  /** Seconds left (whole, rounded up) of `action`'s cooldown, 0 when ready. `cd` is { feed: untilMs, ... } in local time. */
  const cooldownLeft = (cd, action, nowMs) => Math.max(0, Math.ceil((((cd && cd[action]) || 0) - nowMs) / 1000));
  /** 272 -> "4:32" */
  const fmtClock = (sec) => { const s = Math.max(0, Math.ceil(sec)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  /** What the relay told us for a `care` call: the pet, a cooldown, or a problem. */
  function careOutcome(r) {
    if (r && r.ok === true) { const pet = parsePet(r.pet); if (pet) return { kind: "ok", pet }; }
    if (r && r.error === "too soon") return { kind: "wait", retryIn: Math.max(1, Math.ceil(num(r.retryIn, COOLDOWN_S))) };
    if (r && typeof r.error === "string") return { kind: "error", message: r.error };
    return { kind: "error", message: "" };
  }

  // ---------- who cared (the relay does not say; the numbers do) ----------

  /**
   * Compare the pet we were showing (`before`, from `current`, at the time of the new answer) with the new relay pet.
   * Decay never raises a stat, so a rise means someone cared; the answer to our own `care` is adopted before the next sync, so
   * what is left here is the partner. Returns { actions: ["feed"...], bond: bool } or null when nothing happened.
   */
  function detectPartnerCare(before, next, me) {
    if (!before || !next) return null;
    const actions = ACTION_IDS.filter((id) => next[ACTIONS[id].stat] - before.exact[ACTIONS[id].stat] >= 1.5);
    const peer = me === "a" ? "b" : "a";
    const bondFlip = before.bond.day === next.bond.day && next.bond[peer] && !before.bond[peer];
    if (!actions.length && !bondFlip) return null;
    return { actions, bond: !!bondFlip };
  }

  /** "Sam fed Ember" / "Sam petted Ember" / "Sam looked after Ember" (several actions or only the bond). */
  function careLine(who, petName, actions) {
    const name = petName || "your blob", s = who || "Your partner";
    return actions && actions.length === 1 ? `${s} ${ACTIONS[actions[0]].verb} ${name}` : `${s} looked after ${name}`;
  }

  // ---------- outfits ----------

  const OUTFIT_UNLOCKS = Object.freeze({
    bow: Object.freeze({ level: 2 }),
    scarf: Object.freeze({ level: 3 }),
    glasses: Object.freeze({ level: 5 }),
    hat: Object.freeze({ level: 8 }),
    "flower-crown": Object.freeze({ level: 12 }),
    party: Object.freeze({ days: 100 }),         // a celebration outfit: kept for ever once 100 days together have passed
    anniversary: Object.freeze({ days: 365 }),   // ... and once a year has passed
  });
  const OUTFIT_LABELS = Object.freeze({ bow: "Bow", scarf: "Scarf", glasses: "Glasses", hat: "Hat", "flower-crown": "Flowers", party: "Party hat", anniversary: "Gold crown" });
  const OUTFIT_ORDER = Object.freeze(["bow", "scarf", "glasses", "hat", "flower-crown", "party", "anniversary"]);

  /** [{ id, label, unlocked, hint }] in display order. `days` = whole days together (null when no date was set). */
  function outfitList(level, days) {
    const lv = Math.max(1, Math.floor(num(level, 1)));
    const d = Number.isFinite(days) && days !== null ? days : -1;
    return OUTFIT_ORDER.map((id) => {
      const u = OUTFIT_UNLOCKS[id];
      const unlocked = u.level ? lv >= u.level : d >= u.days;
      return { id, label: OUTFIT_LABELS[id], unlocked, hint: u.level ? "Level " + u.level : u.days + " days", full: u.level ? "Reach level " + u.level : "After " + u.days + " days together" };
    });
  }
  const unlockedIds = (level, days) => outfitList(level, days).filter((o) => o.unlocked).map((o) => o.id);

  /** Ids unlocked in `next` but not in `prev` (for "New outfit: Scarf"). */
  const newlyUnlocked = (prev, next) => next.filter((id) => !prev.includes(id));

  /** What can be worn: only unlocked, known ids, one per slot (the mascot's normalizeOutfit decides the slots). */
  function sanitizeOutfit(choice, unlocked, mascot) {
    const M = mascot || mascotApi();
    const list = (Array.isArray(choice) ? choice : []).filter((id) => unlocked.includes(id));
    return M ? M.normalizeOutfit(list) : list;
  }

  /** Tap on an outfit: off if worn, else on (replacing what the same slot wore). Locked ids do nothing. */
  function toggleOutfit(choice, id, unlocked, mascot) {
    if (!unlocked.includes(id)) return sanitizeOutfit(choice, unlocked, mascot);
    const M = mascot || mascotApi();
    const cur = sanitizeOutfit(choice, unlocked, M);
    return cur.includes(id) ? cur.filter((x) => x !== id) : sanitizeOutfit(cur.concat(id), unlocked, M);
  }

  // ---------- naming ----------

  const NAME_RE = /^[\p{L}\p{M}\p{N} '.\-]+$/u;
  /** The relay's rule for names (README "Names and dates"): trimmed, spaces collapsed, 1..20 characters, letters marks digits space ' . - */
  function cleanName(raw) {
    const s = String(raw == null ? "" : raw).normalize("NFC").replace(/\s+/g, " ").trim();
    const n = [...s].length;
    if (n === 0) return { ok: false, name: "", error: "Type a name first." };
    if (n > NAME_MAX) return { ok: false, name: s, error: `Up to ${NAME_MAX} characters, please.` };
    if (!NAME_RE.test(s)) return { ok: false, name: s, error: "Use letters, numbers, spaces and ' . - only." };
    return { ok: true, name: s, error: "" };
  }
  /** A relay error from `set` -> a sentence. */
  function nameProblem(message) {
    if (message === "bad name") return `Names are 1 to ${NAME_MAX} letters, numbers, spaces and ' . - (no emoji).`;
    if (message === "nothing to set") return "There was nothing to change.";
    return "The relay did not take that name. Try again in a moment.";
  }

  // ---------- speech bubbles ----------

  const BUBBLE = Object.freeze({
    showMs: 9000,              // how long a bubble stays
    minGapMs: 10 * 60 * 1000,  // at most one unprompted bubble per 10 minutes
    repeatMs: 2 * 60 * 60 * 1000, // and the same unprompted line at most every 2 hours
  });
  const LINES = Object.freeze({
    feed: ["Yum, thank you!", "Nom nom nom.", "That hit the spot."],
    water: ["Ahh, so fresh.", "Glug glug, thank you!", "Just what I needed."],
    pet: ["That feels lovely.", "More snuggles, please.", "I love you both."],
  });

  /**
   * One speech bubble, or null. ctx: { trigger, names: { you, partner }, petName, pet (from `current`), mood, action, wasSad,
   * bondJustDone, level, newOutfit, retryIn, bubbles: { id: lastShownAt }, now, pick?: (n) => index }.
   * Triggers "feed" | "water" | "pet" (my own click), "partner" (ctx.line = careLine(...)), "level", "wait" (cooldown) always answer.
   * "open" and "idle" are the unprompted ones: rate-limited by BUBBLE and quiet when there is nothing to say.
   * Text uses the partners' names and no emoji; nothing in here ever threatens the pet.
   */
  function chooseBubble(ctx) {
    const pick = ctx.pick || ((n) => Math.floor(Math.random() * n));
    const you = (ctx.names && ctx.names.you) || "you", partner = (ctx.names && ctx.names.partner) || "your partner";
    const t = ctx.trigger;
    if (LINES[t]) {
      if (ctx.wasSad) return { id: "recovered", text: "Thank you. I feel so much better!", ms: BUBBLE.showMs };
      if (ctx.bondJustDone) return { id: "bond-done", text: "You both visited me today. I love you both!", ms: BUBBLE.showMs };
      return { id: t, text: LINES[t][pick(LINES[t].length)], ms: 5000 };
    }
    if (t === "partner") return { id: "partner", text: ctx.line || `${partner} looked after me.`, ms: BUBBLE.showMs };
    if (t === "level") return { id: "level", text: `Level ${ctx.level}!` + (ctx.newOutfit ? ` New outfit: ${ctx.newOutfit}.` : ""), ms: BUBBLE.showMs };
    if (t === "wait") return { id: "wait", text: ctx.retryIn > 0 ? `Not yet, I am happy for now. Again in ${fmtClock(ctx.retryIn)}.` : "Not yet, I am happy for now.", ms: 5000 };
    if (t !== "open" && t !== "idle") return null;

    const now = ctx.now, seen = ctx.bubbles || {};
    const last = Math.max(0, ...Object.values(seen).map((v) => num(v, 0)));
    if (now - last < BUBBLE.minGapMs) return null;
    const side = bondSides(ctx.pet.bond, ctx.me);
    const p = ctx.pet;
    const lines = [];
    if (p.bond.done) lines.push({ id: "bond-done", text: "You both visited me today. Thank you!" });
    if (p.bucket === "sad" || ctx.mood === "sad") lines.push({ id: "sad", text: "I am a little sad, but I am not going anywhere. A bit of care and I feel better." });
    if (ctx.mood === "hungry") lines.push({ id: "hungry", text: "My tummy is rumbling." });
    if (ctx.mood === "thirsty") lines.push({ id: "thirsty", text: "I could use some water." });
    if (ctx.mood === "sleepy") lines.push({ id: "sleepy", text: "I would love a cuddle." });
    if (!p.bond.done && side.you && !side.partner) lines.push({ id: "partner-missing", text: `${partner} has not visited me today.` });
    if (!p.bond.done && !side.you && side.partner) lines.push({ id: "your-turn", text: `${partner} visited me today. Your turn, ${you}!` });
    if (!side.you && !side.partner) lines.push({ id: "hello", text: `Hello, ${you}! Come say hi today.` });
    const fresh = lines.find((l) => now - num(seen[l.id], 0) >= BUBBLE.repeatMs);
    return fresh ? { id: fresh.id, text: fresh.text, ms: BUBBLE.showMs } : null;
  }

  const api = {
    STATS, ACTIONS, ACTION_IDS, DEFAULT_RATE, MIN_STAT, MAX_STAT, COOLDOWN_S, MAX_LEVEL, NAME_MAX, BUBBLE, LINES,
    OUTFIT_UNLOCKS, OUTFIT_LABELS, OUTFIT_ORDER,
    utcDay, prevDay, msToUtcMidnight,
    levelOfXp, xpAtLevel, nextXpAt, curveAgrees, progress,
    parsePet, petSig, rollBond, bucketOf, current, applyCare, bondSides,
    displayMood, cooldownLeft, fmtClock, careOutcome, detectPartnerCare, careLine,
    outfitList, unlockedIds, newlyUnlocked, sanitizeOutfit, toggleOutfit,
    cleanName, nameProblem, chooseBubble,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthPetLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
