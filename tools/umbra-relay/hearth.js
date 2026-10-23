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

export const PET = {
  min: 10, max: 100, start: 70,                                 // a stat never goes below `min`: the pet is sad, never dead
  rate: { food: 1.25, water: 1.875, love: 0.9375 },             // points lost per hour, from SERVER time
  gain: { food: 35, water: 35, love: 25 },                      // points per feed / water / pet
  action: { feed: "food", water: "water", pet: "love" },
  cooldownMs: 5 * 60 * 1000,                                    // per side and action
  bondXp: 5,                                                    // extra xp when both partners cared on the same UTC day
};

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
  };
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
    pet: { food: PET.start, water: PET.start, love: PET.start, t: now, xp: 0, bond: { day, a: false, b: false }, streak: 0, lastDone: "" },
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
  const save = async (extra) => { h.seen = now; await s.put({ h, ...(extra || {}) }); };

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
      if (gainsXp) xp += 1;
      if (bond.a && bond.b && lastDone !== day) {
        streak = lastDone === prevDay(day) ? streak + 1 : 1;
        lastDone = day;
        xp += PET.bondXp;
      }
      h.pet = { ...cur, t: now, xp, bond, streak, lastDone };
      h.cd[cd] = now;
      bump(h, "pet");
      await save();
      return { ok: true, pet: petView(h.pet, now) };
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
