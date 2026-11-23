// Hearth room logic (the /hearth/* routes). Plain functions over a Durable Object storage object and a clock, so
// they run unchanged inside the Worker and in `node --test` with an in-memory fake (tests/relay/).
//
// Everything about a couple lives in ONE hot row, `h` (names, dates, pet, taps, counters, small logs), plus one row
// per stroke (`s:<id>`). An idle sync therefore reads one small row and writes nothing (apart from a "last used"
// stamp refreshed at most once an hour).
//
// `rev` is a counter that goes up by one for every change. Each section records the rev it last changed at, so
// `sync?since=R` can answer with only the sections (and strokes) newer than R, or with just { rev } when nothing is.
// A stroke's id is the rev it was created at.

export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;   // a hearth `unpair` keeps the room this long, then deletes it
export const CLEAR_UNDO_MS = 60 * 1000;             // `unclear` works this long after a `clear`
export const SEEN_GRANULARITY_MS = 60 * 60 * 1000;  // idle syncs refresh the "last used" stamp at most this often
export const DEFAULT_TOGETHER_S = 120;              // env.TOGETHER_WINDOW_S overrides (clamped to 5..900)

export const LIMITS = {
  strokesPerRoom: 300,      // oldest strokes are trimmed past this ...
  pointsPerRoom: 20000,     // ... or past this many points in total
  recordsPerCall: 8,        // strokes in one `stroke` request
  pointsPerRecord: 600,     // points in one stroke record (longer strokes are sent as several, flagged `k`)
  strokeParamChars: 4096,   // length of the decoded `s` parameter
  colors: 16,               // colour index 0..15
  sizes: 8,                 // size index 0..7
  grid: 1000,               // x and y are integers 0..1000 (a fraction of board width / height, in per mille)
  nameChars: 20,            // each partner name and the pet name
  groupRecords: 50,         // records that may be chained into one undoable stroke
  undoDepth: 32,            // undoable strokes remembered per side
  removalLog: 64,           // undone stroke ids remembered for incremental sync
};

/** Every /hearth/<route> the Worker serves. The widget keeps the same list (widgets/hearth/hearth-core.js, checked by a test). */
export const HEARTH_ROUTES = new Set(["sync", "stroke", "undo", "clear", "unclear", "tap", "care", "set", "unpair", "reinvite",
  "buy", "gift", "open", "use", "place", "dress", "play", "claim", "quests"]);

export const PET = {
  min: 10, max: 100, start: 70,                                 // a stat never goes below `min`: the pet is sad, never dead
  rate: { food: 1.25, water: 1.875, love: 0.9375 },             // points lost per hour, from SERVER time
  gain: { food: 35, water: 35, love: 25 },                      // points per feed / water / pet
  action: { feed: "food", water: "water", pet: "love" },
  cooldownMs: 5 * 60 * 1000,                                    // per side and action
  bondXp: 5,                                                    // extra xp when both partners cared on the same UTC day
};

// ---------- the pet's world: Embers (shared coins), the shop, the room, games, quests, stickers, gifts, a diary ----------
// All of it lives inside `h.pet` (the same hot row, still small) and reaches clients through `petView`. Every write is a
// click of a partner: nothing here polls or runs on a timer.

/** Items. cat: treat (used up by `use`), toy and decor (placed in the room), outfit (worn with `dress`). */
export const SHOP = Object.freeze({
  // treats: `gain` is added to the stats (capped at 100)
  berry_tart: { cat: "treat", price: 8, gain: { food: 30, love: 8 } },
  honey_cake: { cat: "treat", price: 12, gain: { food: 45, love: 12 } },
  fish_snack: { cat: "treat", price: 10, gain: { food: 50 } },
  smoothie: { cat: "treat", price: 7, gain: { water: 45 } },
  cocoa: { cat: "treat", price: 9, gain: { water: 35, love: 15 } },
  star_candy: { cat: "treat", price: 15, gain: { food: 20, water: 20, love: 20 } },
  // toys: one at a time on the rug
  ball: { cat: "toy", spot: "toy", price: 25 },
  yarn: { cat: "toy", spot: "toy", price: 30 },
  duck: { cat: "toy", spot: "toy", price: 35 },
  kite: { cat: "toy", spot: "toy", price: 45 },
  // decor, by where it goes
  plant: { cat: "decor", spot: "floorL", price: 40 },
  cactus: { cat: "decor", spot: "floorL", price: 35 },
  lamp: { cat: "decor", spot: "floorR", price: 50 },
  bookshelf: { cat: "decor", spot: "floorR", price: 70 },
  painting: { cat: "decor", spot: "wall", price: 45 },
  clock: { cat: "decor", spot: "wall", price: 40 },
  photo: { cat: "decor", spot: "wall", price: 30 },
  lights: { cat: "decor", spot: "mantel", price: 35 },
  candles: { cat: "decor", spot: "mantel", price: 25 },
  curtains_rose: { cat: "decor", spot: "window", price: 30 },
  curtains_sage: { cat: "decor", spot: "window", price: 30 },
  rug_sky: { cat: "decor", spot: "rug", price: 30 },
  rug_sage: { cat: "decor", spot: "rug", price: 30 },
  rug_gold: { cat: "decor", spot: "rug", price: 40 },
  wall_mint: { cat: "decor", spot: "wallpaper", price: 35 },
  wall_sky: { cat: "decor", spot: "wallpaper", price: 35 },
  wall_rose: { cat: "decor", spot: "wallpaper", price: 35 },
  wall_night: { cat: "decor", spot: "wallpaper", price: 50 },
  // outfits bought in the shop (level and anniversary outfits are free once unlocked)
  tophat: { cat: "outfit", slot: "head", price: 60 },
  beanie: { cat: "outfit", slot: "head", price: 45 },
  headphones: { cat: "outfit", slot: "head", price: 70 },
  star_clips: { cat: "outfit", slot: "head", price: 40 },
  shades: { cat: "outfit", slot: "face", price: 55 },
  monocle: { cat: "outfit", slot: "face", price: 50 },
  cape: { cat: "outfit", slot: "neck", price: 80 },
  bell: { cat: "outfit", slot: "neck", price: 35 },
});
/** Outfits that need no shop: unlocked by level or by days together (the date set on the Us tab). */
export const FREE_OUTFITS = Object.freeze({
  bow: { slot: "neck", level: 2 }, scarf: { slot: "neck", level: 3 }, glasses: { slot: "face", level: 5 },
  hat: { slot: "head", level: 8 }, "flower-crown": { slot: "head", level: 12 },
  party: { slot: "head", days: 100 }, anniversary: { slot: "head", days: 365 },
});
export const ROOM_SPOTS = Object.freeze(["wallpaper", "rug", "window", "wall", "mantel", "floorL", "floorR", "toy"]);
/** Mini-games: the best score that counts, Embers per point, the most Embers one game pays. */
export const GAMES = Object.freeze({
  catch: { max: 80, per: 0.34, cap: 20 },   // Berry Catch: berries caught in 30 s
  memory: { max: 40, per: 2, cap: 20 },     // Flame Memory: rounds remembered
  seek: { max: 15, per: 2, cap: 20 },       // Hide and Seek: rounds found
});
/** Daily quests: three a day, picked from these by the UTC day and the room. `n` is the target. */
export const QUESTS = Object.freeze({
  feed2: { n: 2, reward: 15 }, water2: { n: 2, reward: 15 }, pet3: { n: 3, reward: 15 },
  both: { n: 1, reward: 25 }, play1: { n: 1, reward: 15 }, play3: { n: 3, reward: 25 },
  treat1: { n: 1, reward: 20 }, buy1: { n: 1, reward: 15 }, catch20: { n: 1, reward: 25 },
  memory6: { n: 1, reward: 25 }, seek3: { n: 1, reward: 25 }, care6: { n: 6, reward: 20 },
});
/** Stickers for the album, in order. */
export const STICKERS = Object.freeze([
  "first_game", "first_treat", "first_buy", "first_gift", "first_quest", "decorated", "fashion",
  "streak7", "streak30", "level10", "level25", "level50", "quests10", "games25", "catch40", "memory10", "seek8",
  "rich", "collector", "birthday",
]);
export const WORLD = Object.freeze({
  careCoins: 2,              // per care that was needed (the same rule as its xp)
  bondCoins: 10,             // when the daily bond completes
  gameCooldownMs: 45 * 1000, // per side and game
  gameCoinsPerDay: 80,       // per side: what games can pay in one UTC day
  gameXpPerDay: 6,           // per side
  treatCooldownMs: 60 * 1000,
  maxCoins: 99999, maxCount: 99,
  logSize: 24,
  giftLove: 10,
});

const SECTIONS = ["names", "since", "petName", "pet", "taps", "together", "board"];
const pad = (n) => String(n).padStart(10, "0");
const skey = (id) => "s:" + pad(id);
const peerOf = (me) => (me === "a" ? "b" : "a");

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const prevDay = (day) => utcDay(Date.parse(day + "T00:00:00Z") - 86400000);

/** Constant-time string compare, so a key cannot be guessed byte by byte from response timing. */
export function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function togetherWindowMs(env) {
  const s = Number(env && env.TOGETHER_WINDOW_S);
  return Math.min(900, Math.max(5, Number.isFinite(s) && s > 0 ? s : DEFAULT_TOGETHER_S)) * 1000;
}

// ---------- pet ----------

export const levelOf = (xp) => Math.min(50, 1 + Math.floor(Math.sqrt(xp / 4)));

/** Stat values at `now`: the stored value minus linear decay since the stored time, never below PET.min. */
function petStats(p, now) {
  const hours = Math.max(0, now - p.t) / 3600000;
  const out = {};
  for (const k of Object.keys(PET.rate)) out[k] = Math.max(PET.min, Math.min(PET.max, p[k] - PET.rate[k] * hours));
  return out;
}

/** The pet as clients see it. A pure function of the stored pet and the server clock. */
export function petView(p, now) {
  const cur = petStats(p, now);
  const food = Math.round(cur.food), water = Math.round(cur.water), love = Math.round(cur.love);
  const avg = (food + water + love) / 3;
  const day = utcDay(now);
  const b = p.bond.day === day ? p.bond : { a: false, b: false };
  const level = levelOf(p.xp);
  return {
    food, water, love,
    mood: avg >= 65 ? "happy" : avg >= 35 ? "content" : "sad",   // there is no "dead"
    level, xp: p.xp, nextXp: level >= 50 ? null : 4 * level * level,
    bond: { day, a: b.a, b: b.b, done: b.a && b.b, streak: p.lastDone === day || p.lastDone === prevDay(day) ? p.streak : 0 },
    decayPerHour: PET.rate, min: PET.min,                         // so a client can extrapolate between syncs
    // the world (see "Pet world" in the README)
    coins: p.coins || 0,
    inv: { ...(p.inv || {}) },
    room: { ...(p.room || {}) },
    wear: Array.isArray(p.wear) ? [...p.wear] : null,
    best: { ...(p.best || {}) },
    quests: questView(p, day),
    stickers: [...(p.ach || [])],
    gift: p.gift ? { ...p.gift } : null,
    log: (p.log || []).map((e) => [...e]),
    born: p.born || 0,
    counts: { ...(p.n || {}) },
  };
}

/** Fill in the world fields of a pet stored before they existed. */
function worldOf(p, now) {
  if (typeof p.coins !== "number") p.coins = 0;
  if (!p.inv || typeof p.inv !== "object") p.inv = {};
  if (!p.room || typeof p.room !== "object") p.room = {};
  if (p.wear !== null && !Array.isArray(p.wear)) p.wear = null;  // null: never dressed on the relay (a client may bring its local choice)
  if (!p.best || typeof p.best !== "object") p.best = {};
  if (!Array.isArray(p.ach)) p.ach = [];
  if (!Array.isArray(p.log)) p.log = [];
  if (!p.n || typeof p.n !== "object") p.n = {};
  if (p.gift === undefined) p.gift = null;
  if (!p.born) p.born = now;
  if (!p.earn || typeof p.earn !== "object") p.earn = {};
  return p;
}

/** Small deterministic hash (FNV-1a) for picking the day's quests. */
function hash(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}
/** The three quest ids of a UTC day for a room: always the same for both partners, different from day to day. */
export function questsFor(day, room) {
  const ids = Object.keys(QUESTS);
  const out = [];
  let x = hash(day + ":" + (room || ""));
  while (out.length < 3) {
    const id = ids[x % ids.length];
    if (!out.includes(id)) out.push(id);
    x = hash(String(x) + id);
  }
  return out;
}
/** Today's quests with progress, starting fresh when the stored ones are from another day. */
function questsToday(p, day, room) {
  if (!p.q || p.q.day !== day) p.q = { day, ids: questsFor(day, room), p: [0, 0, 0], c: [false, false, false] };
  return p.q;
}
function questView(p, day) {
  if (!p.q || p.q.day !== day) return null;                       // not drawn yet today: the first action of the day draws them
  return p.q.ids.map((id, i) => ({ id, n: QUESTS[id].n, p: Math.min(QUESTS[id].n, p.q.p[i]), reward: QUESTS[id].reward, claimed: !!p.q.c[i] }));
}
/** Count `amount` towards today's quests that match `ids` (a quest id or a list of them). */
function questStep(p, day, room, ids, amount = 1) {
  const q = questsToday(p, day, room);
  const want = Array.isArray(ids) ? ids : [ids];
  q.ids.forEach((id, i) => { if (want.includes(id)) q.p[i] = Math.min(QUESTS[id].n, q.p[i] + amount); });
}
/** A diary line: [time, side, kind, detail]. The oldest fall off. */
function logEvent(p, now, side, kind, detail) {
  p.log.push([now, side, kind, detail === undefined ? "" : detail]);
  while (p.log.length > WORLD.logSize) p.log.shift();
}
const addCoins = (p, n) => { p.coins = Math.min(WORLD.maxCoins, Math.max(0, (p.coins || 0) + n)); };
const owns = (p, id) => (p.inv[id] || 0) > 0;

/** Days together from the Us tab's date, or -1 when none is set. */
function daysTogether(since, now) {
  if (!since) return -1;
  return Math.floor((Date.parse(utcDay(now) + "T00:00:00Z") - Date.parse(since + "T00:00:00Z")) / 86400000);
}
/** May this outfit be worn now? Free ones by level or days together, shop ones when owned. */
function canWear(h, id, now) {
  const free = FREE_OUTFITS[id];
  if (free) return free.level ? levelOf(h.pet.xp) >= free.level : daysTogether(h.since, now) >= free.days;
  const item = SHOP[id];
  return !!item && item.cat === "outfit" && owns(h.pet, id);
}
const slotOf = (id) => (FREE_OUTFITS[id] || SHOP[id] || {}).slot;

/** Stickers earned by the state as it is now; returns the new ones (also written to the diary). */
function checkStickers(h, now, side) {
  const p = h.pet, have = new Set(p.ach), n = p.n;
  const filled = ROOM_SPOTS.filter((s) => p.room[s]).length;
  const outfits = Object.keys(p.inv).filter((id) => SHOP[id] && SHOP[id].cat === "outfit").length;
  const owned = Object.keys(p.inv).filter((id) => SHOP[id] && SHOP[id].cat !== "treat").length;
  const lv = levelOf(p.xp);
  const rules = {
    first_game: (n.games || 0) >= 1, first_treat: (n.treats || 0) >= 1, first_buy: (n.buys || 0) >= 1,
    first_gift: (n.gifts || 0) >= 1, first_quest: (n.quests || 0) >= 1, decorated: filled >= 4, fashion: outfits >= 3,
    streak7: p.streak >= 7, streak30: p.streak >= 30, level10: lv >= 10, level25: lv >= 25, level50: lv >= 50,
    quests10: (n.quests || 0) >= 10, games25: (n.games || 0) >= 25, catch40: (p.best.catch || 0) >= 40,
    memory10: (p.best.memory || 0) >= 10, seek8: (p.best.seek || 0) >= 8, rich: p.coins >= 300, collector: owned >= 15,
    birthday: !!p.bdayDone,
  };
  const got = STICKERS.filter((id) => rules[id] && !have.has(id));
  for (const id of got) { p.ach.push(id); logEvent(p, now, side, "sticker", id); }
  return got;
}
/** Answer of a world action: ok, the pet as clients see it, and what was just earned. */
function worldAnswer(h, now, side, extra) {
  const stickers = checkStickers(h, now, side);
  bump(h, "pet");
  return { ok: true, ...(extra || {}), stickers, pet: petView(h.pet, now) };
}

// ---------- validation ----------

const NAME_RE = /^[\p{L}\p{M}\p{N} '.\-]+$/u;
/** Trimmed, single-spaced name of 1..20 characters from letters, digits, space ' . - ; else null. */
export function cleanName(raw) {
  const s = String(raw).normalize("NFC").replace(/\s+/g, " ").trim();
  const n = [...s].length;
  return n >= 1 && n <= LIMITS.nameChars && NAME_RE.test(s) ? s : null;
}

function validDate(s, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "1970-01-01" && s <= utcDay(now + 86400000);
}

const STROKE_RE = /^k?\d{1,2}\.\d{1,2}\.\d{1,4}\.\d{1,4}(\.-?\d{1,4}\.-?\d{1,4})*$/;

/**
 * Parses the `s` parameter of `stroke`: records joined by "_", each "[k]c.z.x.y(.dx.dy)*" (see README).
 * Returns { recs: [{ k, c, z, p, n }] } or { error }.
 */
export function parseStrokes(raw) {
  if (!raw) return { error: "no strokes" };
  if (raw.length > LIMITS.strokeParamChars) return { error: "too long" };
  const parts = raw.split("_");
  if (parts.length > LIMITS.recordsPerCall) return { error: "too many strokes" };
  const recs = [];
  for (const part of parts) {
    if (!STROKE_RE.test(part)) return { error: "bad stroke" };
    const k = part[0] === "k" ? 1 : 0;
    const t = (k ? part.slice(1) : part).split(".").map(Number);
    const [c, z, x, y] = t, rest = t.slice(2);
    const n = rest.length / 2;
    if (c >= LIMITS.colors || z >= LIMITS.sizes || x > LIMITS.grid || y > LIMITS.grid) return { error: "bad stroke" };
    if (n > LIMITS.pointsPerRecord) return { error: "stroke too long" };
    let px = x, py = y;
    for (let i = 2; i < rest.length; i += 2) {
      px += rest[i]; py += rest[i + 1];
      if (px < 0 || px > LIMITS.grid || py < 0 || py > LIMITS.grid) return { error: "bad stroke" };
    }
    recs.push({ k, c, z, p: rest.join("."), n });
  }
  return { recs };
}

// ---------- state ----------

function newHearth(now) {
  const rv = {};
  for (const s of SECTIONS) rv[s] = 1;
  const day = utcDay(now);
  return {
    rev: 1, rv, brs: 1,                                  // brs: rev of the last clear / unclear (a sync older than this resets the board)
    names: { a: "", b: "" }, since: "", petName: "",
    pet: worldOf({ food: PET.start, water: PET.start, love: PET.start, t: now, xp: 0, bond: { day, a: false, b: false }, streak: 0, lastDone: "" }, now),
    cd: {},                                              // care cooldowns, "<side><action>" -> time
    taps: { a: { n: 0, at: 0 }, b: { n: 0, at: 0 } },    // shown to the other side
    tw: { a: 0, b: 0 },                                  // taps not yet matched into a together moment
    tg: { n: 0, at: 0 },
    sn: 0, sp: 0,                                        // stroke records / points stored
    last: { a: [], b: [] },                              // each side's undoable strokes, newest last (a stroke = list of record ids)
    clr: null,                                           // { by, at, until, upTo } while the last clear can still be undone
    rm: [], rmFloor: 0,                                  // [rev, id, id...] undone strokes, for incremental sync
    seen: now,
    gone: null,                                          // { at, by } after an unpair
  };
}

const bump = (h, ...sections) => {
  h.rev += 1;
  for (const s of sections) h.rv[s] = h.rev;
  return h.rev;
};

/** Deletes the strokes hidden by the last clear for good. */
async function purgeClear(s, h) {
  const hidden = await s.list({ prefix: "s:", end: skey(h.clr.upTo + 1) });
  const keys = [];
  for (const [k, v] of hidden) { keys.push(k); h.sp -= v.n; }
  for (let i = 0; i < keys.length; i += 100) await s.delete(keys.slice(i, i + 100));
  h.sn -= keys.length;
  h.clr = null;
}

/** Drops the oldest strokes while the room is over its stroke or point cap. */
async function trim(s, h) {
  while (h.sn > LIMITS.strokesPerRoom || h.sp > LIMITS.pointsPerRoom) {
    const oldest = await s.list({ prefix: "s:", limit: 16 });
    if (!oldest.size) { h.sn = 0; h.sp = 0; return; }
    const keys = [];
    for (const [k, v] of oldest) {
      if (h.sn <= LIMITS.strokesPerRoom && h.sp <= LIMITS.pointsPerRoom) break;
      keys.push(k); h.sn -= 1; h.sp -= v.n;
    }
    await s.delete(keys);
  }
}

const strokeView = (r) => ({ i: r.i, by: r.by, c: r.c, z: r.z, k: r.k, p: r.p });

// ---------- the routes ----------

/**
 * Runs one authenticated hearth call against a room's storage.
 * `q` is the URLSearchParams of the request (room, me, key, ...). Always returns a plain object: errors are
 * `{ error }`, an unusable pairing is `{ paired: false, reason }`, so the Worker can answer every call with status 200.
 */
export async function handleHearth(s, route, q, env, now) {
  const me = q.get("me");
  if (me !== "a" && me !== "b") return { error: "bad request" };
  const v = await s.get(["ka", "kb", "h"]);
  const key = q.get("key") || "";
  // Unknown room and wrong key look the same, so a stranger learns nothing about which rooms exist.
  if (!v.get("ka") || !key || !safeEq(key, v.get("k" + me))) return { paired: false, reason: "unknown", now };

  const h = v.get("h") || newHearth(now);
  const fresh = !v.get("h");
  const migrated = !h.pet.born;
  worldOf(h.pet, now);                                             // rooms from before the pet world get its fields, once
  const room = q.get("room") || "";
  const save = async (extra) => { h.seen = now; await s.put({ h, ...(extra || {}) }); };
  if (migrated && !fresh && !h.gone) await save();                // so `born` stays the day the world arrived

  if (h.gone) {
    if (route === "unpair") return { ok: true, graceUntil: h.gone.at + GRACE_MS };
    if (!(route === "reinvite" && h.gone.by !== me)) {
      return { paired: false, reason: "unpaired", by: h.gone.by === me ? "you" : "peer", graceUntil: h.gone.at + GRACE_MS, now };
    }
  }
  const peer = peerOf(me);

  switch (route) {
    case "sync": {
      const asked = Number(q.get("since"));
      let since = Number.isInteger(asked) && asked > 0 ? asked : 0;
      if (since > h.rev) since = 0;                                   // the client is ahead of the room (room was recreated): start over
      if (fresh || now - h.seen >= SEEN_GRANULARITY_MS) await save();
      if (since === h.rev) return { rev: h.rev };                     // idle: nothing changed, a few bytes
      const out = { rev: h.rev, now };
      if (h.rv.names > since) out.names = h.names;
      if (h.rv.since > since) out.togetherSince = h.since;
      if (h.rv.petName > since) out.petName = h.petName;
      if (h.rv.pet > since) out.pet = petView(h.pet, now);
      if (h.rv.taps > since) out.taps = h.taps;
      if (h.rv.together > since) out.together = h.tg;
      if (h.rv.board > since) {
        const reset = since < h.brs || since < h.rmFloor;
        const from = Math.max(reset ? 0 : since, h.clr ? h.clr.upTo : 0);
        const rows = await s.list({ prefix: "s:", start: skey(from + 1) });
        out.board = {
          reset,                                                      // true: replace your whole board with `strokes`
          strokes: [...rows.values()].map(strokeView),
          removed: reset ? [] : h.rm.filter((r) => r[0] > since).flatMap((r) => r.slice(1)),
          clear: h.clr && now < h.clr.until ? { by: h.clr.by, at: h.clr.at, until: h.clr.until } : null,
        };
      }
      return out;
    }

    case "stroke": {
      const parsed = parseStrokes(q.get("s") || "");
      if (parsed.error) return { error: parsed.error };
      if (h.clr && now >= h.clr.until) await purgeClear(s, h);
      const rows = {}, ids = [];
      for (const r of parsed.recs) {
        const id = bump(h, "board");
        rows[skey(id)] = { i: id, by: me, c: r.c, z: r.z, k: r.k, p: r.p, n: r.n };
        h.sn += 1; h.sp += r.n; ids.push(id);
        const st = h.last[me], top = st[st.length - 1];
        if (r.k && top && top.length < LIMITS.groupRecords) top.push(id);
        else { st.push([id]); if (st.length > LIMITS.undoDepth) st.shift(); }
      }
      await s.put(rows);
      await trim(s, h);
      await save();
      return { ok: true, ids };
    }

    case "undo": {
      const st = h.last[me];
      const hidden = (id) => !!h.clr && id <= h.clr.upTo;
      let target = null, got = null;
      while (st.length) {
        const visible = st[st.length - 1].filter((id) => !hidden(id));
        if (!visible.length) break;                                   // the rest is hidden by a clear that can still be undone
        got = await s.get(visible.map(skey));
        const present = visible.filter((id) => got.has(skey(id)));
        st.pop();
        if (present.length) { target = present; break; }              // else it was trimmed away: look further back
      }
      if (!target) { await save(); return { error: "nothing to undo" }; }
      await s.delete(target.map(skey));
      h.sn -= target.length;
      for (const id of target) h.sp -= got.get(skey(id)).n;
      const rev = bump(h, "board");
      h.rm.push([rev, ...target]);
      while (h.rm.length > LIMITS.removalLog) h.rmFloor = Math.max(h.rmFloor, h.rm.shift()[0]);
      await save();
      return { ok: true, removed: target };
    }

    case "clear": {
      if (h.clr) await purgeClear(s, h);                              // only the latest clear can be undone
      if (h.sn === 0) { await save(); return { ok: true, noop: true }; }
      const rev = bump(h, "board");
      h.brs = rev;
      h.clr = { by: me, at: now, until: now + CLEAR_UNDO_MS, upTo: rev };
      await save();
      return { ok: true, until: h.clr.until };
    }

    case "unclear": {
      if (!h.clr) return { error: "nothing to restore" };
      if (now >= h.clr.until) return { error: "too late" };
      h.brs = bump(h, "board");
      h.clr = null;
      await save();
      return { ok: true };
    }

    case "tap": {
      const rev = bump(h, "taps");
      h.taps[me] = { n: h.taps[me].n + 1, at: now };
      h.tw[me] = now;
      const other = h.tw[peer];
      const together = other > 0 && now - other <= togetherWindowMs(env);
      if (together) {
        h.tg = { n: h.tg.n + 1, at: now };
        h.rv.together = rev;
        h.tw = { a: 0, b: 0 };                                        // both taps are used up
      }
      await save();
      return { ok: true, together };
    }

    case "care": {
      const action = q.get("action");
      const stat = PET.action[action];
      if (!stat) return { error: "bad action" };
      const cd = me + action, lastCare = h.cd[cd] || 0;
      if (now >= lastCare && now - lastCare < PET.cooldownMs) {
        return { error: "too soon", retryIn: Math.ceil((PET.cooldownMs - (now - lastCare)) / 1000) };
      }
      const cur = petStats(h.pet, now);
      const gainsXp = cur[stat] < 90;
      cur[stat] = Math.min(PET.max, cur[stat] + PET.gain[stat]);
      const day = utcDay(now);
      const bond = h.pet.bond.day === day ? { ...h.pet.bond } : { day, a: false, b: false };
      bond[me] = true;
      let { xp, streak, lastDone } = h.pet;
      const p = h.pet;
      if (gainsXp) { xp += 1; addCoins(p, WORLD.careCoins); }
      let bonded = false;
      if (bond.a && bond.b && lastDone !== day) {
        streak = lastDone === prevDay(day) ? streak + 1 : 1;
        lastDone = day;
        xp += PET.bondXp;
        addCoins(p, WORLD.bondCoins);
        bonded = true;
      }
      Object.assign(p, cur, { t: now, xp, bond, streak, lastDone });
      questStep(p, day, room, { feed: "feed2", water: "water2", pet: "pet3" }[action]);
      questStep(p, day, room, "care6");
      if (bonded) { questStep(p, day, room, "both"); logEvent(p, now, me, "bond", streak); }
      logEvent(p, now, me, action);
      // The pet's birthday (the day it hatched, a year or more ago): caring for it that day earns its sticker.
      if (p.born && utcDay(p.born).slice(5) === day.slice(5) && utcDay(p.born) < day) p.bdayDone = true;
      h.cd[cd] = now;
      const out = worldAnswer(h, now, me, { coins: (gainsXp ? WORLD.careCoins : 0) + (bonded ? WORLD.bondCoins : 0) });
      await save();
      return out;
    }

    case "buy": case "gift": {
      const id = q.get("item") || "";
      const item = Object.prototype.hasOwnProperty.call(SHOP, id) ? SHOP[id] : null;
      if (!item) return { error: "bad item" };
      const p = h.pet;
      if (route === "gift" && p.gift) return { error: "a gift is already waiting" };
      if (route === "buy" && item.cat !== "treat" && owns(p, id)) return { error: "already yours" };
      if ((p.inv[id] || 0) >= WORLD.maxCount) return { error: "too many" };
      if (p.coins < item.price) return { error: "not enough embers", need: item.price - p.coins };
      addCoins(p, -item.price);
      if (route === "buy") {
        p.inv[id] = (p.inv[id] || 0) + 1;
        p.n.buys = (p.n.buys || 0) + 1;
        logEvent(p, now, me, "buy", id);
      } else {
        p.gift = { from: me, item: id, t: now };
        logEvent(p, now, me, "gift", id);
      }
      questStep(p, utcDay(now), room, "buy1");
      const out = worldAnswer(h, now, me);
      await save();
      return out;
    }

    case "open": {
      const p = h.pet;
      if (!p.gift) return { error: "no gift" };
      if (p.gift.from === me) return { error: "it is for your partner" };
      const id = p.gift.item;
      p.inv[id] = Math.min(WORLD.maxCount, (p.inv[id] || 0) + 1);
      p.n.gifts = (p.n.gifts || 0) + 1;
      const cur = petStats(p, now);
      cur.love = Math.min(PET.max, cur.love + WORLD.giftLove);
      Object.assign(p, cur, { t: now });
      logEvent(p, now, me, "open", id);
      p.gift = null;
      const out = worldAnswer(h, now, me, { item: id });
      await save();
      return out;
    }

    case "use": {
      const id = q.get("item") || "";
      const item = Object.prototype.hasOwnProperty.call(SHOP, id) ? SHOP[id] : null;
      if (!item || item.cat !== "treat") return { error: "bad item" };
      const p = h.pet;
      if (!owns(p, id)) return { error: "none left" };
      const cd = me + "use", last = h.cd[cd] || 0;
      if (now >= last && now - last < WORLD.treatCooldownMs) return { error: "too soon", retryIn: Math.ceil((WORLD.treatCooldownMs - (now - last)) / 1000) };
      p.inv[id] -= 1;
      if (p.inv[id] <= 0) delete p.inv[id];
      const cur = petStats(p, now);
      for (const [k, v] of Object.entries(item.gain)) cur[k] = Math.min(PET.max, cur[k] + v);
      Object.assign(p, cur, { t: now, xp: p.xp + 1 });
      p.n.treats = (p.n.treats || 0) + 1;
      h.cd[cd] = now;
      questStep(p, utcDay(now), room, "treat1");
      logEvent(p, now, me, "use", id);
      const out = worldAnswer(h, now, me);
      await save();
      return out;
    }

    case "place": {
      const spot = q.get("spot") || "";
      const id = q.get("item") || "";
      if (!ROOM_SPOTS.includes(spot)) return { error: "bad spot" };
      const p = h.pet;
      if (id) {
        const item = Object.prototype.hasOwnProperty.call(SHOP, id) ? SHOP[id] : null;
        if (!item || item.spot !== spot) return { error: "bad item" };
        if (!owns(p, id)) return { error: "not yours yet" };
        p.room[spot] = id;
      } else delete p.room[spot];
      logEvent(p, now, me, "place", id);
      const out = worldAnswer(h, now, me);
      await save();
      return out;
    }

    case "dress": {
      const raw = q.get("items");
      if (raw === null) return { error: "bad request" };
      const ids = raw ? raw.split(",") : [];
      if (ids.length > 3) return { error: "bad outfit" };
      const bySlot = {};
      for (const id of ids) {
        const slot = slotOf(id);
        if (!slot) return { error: "bad outfit" };
        if (!canWear(h, id, now)) return { error: "not unlocked" };
        bySlot[slot] = id;
      }
      h.pet.wear = ["head", "face", "neck"].filter((sl) => bySlot[sl]).map((sl) => bySlot[sl]);
      const out = worldAnswer(h, now, me);
      await save();
      return out;
    }

    case "play": {
      const game = q.get("game") || "";
      const g = Object.prototype.hasOwnProperty.call(GAMES, game) ? GAMES[game] : null;
      if (!g) return { error: "bad game" };
      const score = Number(q.get("score"));
      if (!Number.isInteger(score) || score < 0) return { error: "bad score" };
      const cd = me + "g" + game, last = h.cd[cd] || 0;
      if (now >= last && now - last < WORLD.gameCooldownMs) return { error: "too soon", retryIn: Math.ceil((WORLD.gameCooldownMs - (now - last)) / 1000) };
      const p = h.pet, day = utcDay(now);
      const counted = Math.min(score, g.max);
      // What games may still pay today on this side.
      const e = p.earn[me] && p.earn[me].day === day ? p.earn[me] : { day, coins: 0, xp: 0 };
      const full = Math.min(g.cap, Math.floor(counted * g.per));
      const coins = Math.max(0, Math.min(full, WORLD.gameCoinsPerDay - e.coins));
      const xp = counted > 0 && e.xp < WORLD.gameXpPerDay ? 1 : 0;
      e.coins += coins; e.xp += xp;
      p.earn[me] = e;
      addCoins(p, coins);
      const cur = petStats(p, now);
      cur.love = Math.min(PET.max, cur.love + 5);                    // playing together cheers it up
      Object.assign(p, cur, { t: now, xp: p.xp + xp });
      const record = counted > (p.best[game] || 0);
      if (record) p.best[game] = counted;
      p.n.games = (p.n.games || 0) + 1;
      h.cd[cd] = now;
      questStep(p, day, room, ["play1", "play3"]);
      const goal = { catch: ["catch20", 20], memory: ["memory6", 6], seek: ["seek3", 3] }[game];
      if (counted >= goal[1]) questStep(p, day, room, goal[0]);
      logEvent(p, now, me, "play", game + ":" + counted);
      const out = worldAnswer(h, now, me, { coins, record, capped: coins < full });
      await save();
      return out;
    }

    case "claim": {
      const i = Number(q.get("q"));
      if (!Number.isInteger(i) || i < 0 || i > 2) return { error: "bad quest" };
      const p = h.pet;
      const qs = questsToday(p, utcDay(now), room);
      const id = qs.ids[i];
      if (qs.c[i]) return { error: "already claimed" };
      if (qs.p[i] < QUESTS[id].n) return { error: "not done yet" };
      qs.c[i] = true;
      addCoins(p, QUESTS[id].reward);
      p.xp += 2;
      p.n.quests = (p.n.quests || 0) + 1;
      logEvent(p, now, me, "quest", id);
      const out = worldAnswer(h, now, me, { coins: QUESTS[id].reward });
      await save();
      return out;
    }

    case "quests": {
      // Draws today's quests (before any action has) so a client can show them; changes nothing else.
      const p = h.pet, day = utcDay(now);
      if (p.q && p.q.day === day) return { ok: true, pet: petView(p, now) };
      questsToday(p, day, room);
      bump(h, "pet");
      await save();
      return { ok: true, pet: petView(p, now) };
    }

    case "set": {
      const changes = {};
      const names = q.get("names");
      if (names !== null) {
        const parts = names.split(",");
        if (parts.length !== 2) return { error: "names needs two parts: a,b" };
        const next = { ...h.names };
        for (const [i, side] of ["a", "b"].entries()) {
          if (parts[i].trim() === "") continue;                       // empty part: leave that side's name as it is
          const n = cleanName(parts[i]);
          if (!n) return { error: "bad name" };
          next[side] = n;
        }
        if (next.a !== h.names.a || next.b !== h.names.b) changes.names = next;
      }
      const since = q.get("since");
      if (since !== null) {
        if (!validDate(since, now)) return { error: "bad date" };
        if (since !== h.since) changes.since = since;
      }
      const petName = q.get("petName");
      if (petName !== null) {
        const n = cleanName(petName);
        if (!n) return { error: "bad name" };
        if (n !== h.petName) changes.petName = n;
      }
      if (names === null && since === null && petName === null) return { error: "nothing to set" };
      const touched = Object.keys(changes);
      if (touched.length) {
        bump(h, ...touched);
        Object.assign(h, changes);
        await save();
      }
      return { ok: true };
    }

    case "unpair": {
      h.gone = { at: now, by: me };
      await save();
      await s.setAlarm(now + GRACE_MS);
      return { ok: true, graceUntil: now + GRACE_MS };
    }

    case "reinvite": {
      // The Worker generated the new key and hands it out as a one-time code. The OTHER side's old key stops
      // working right now, and a room in its unpair grace period is active again.
      const nk = q.get("nk") || "";
      if (!/^[0-9a-f]{32}$/.test(nk)) return { error: "bad request" };
      h.gone = null;
      await save({ ["k" + peer]: nk });
      return { ok: true, side: peer };
    }
  }
  return { error: "not found" };
}
