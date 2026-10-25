// Hearth Overview, pure logic: no DOM, no network, no clock of its own (every function takes the date it needs).
// Browser: window.HearthOverviewLogic. Node: module.exports (tests/widgets/hearth-overview.test.mjs).
//
// Dates are "YYYY-MM-DD" strings, compared by calendar day. "Today" is always the viewer's LOCAL calendar day
// (localToday), never UTC, so the count rolls over at the viewer's midnight on both PCs, in any time zone and across DST.
// The names and the validation limits mirror the relay's `set` route (tools/umbra-relay/hearth.js: cleanName, validDate).
(function (root) {
  "use strict";

  const LIMITS = Object.freeze({
    nameChars: 20,                 // relay: each partner name
    minDate: "1970-01-01",         // relay: earliest together-since date
    futureToleranceDays: 2,        // see daysTogether
    optimisticMs: 60000,           // how long our own just-saved value hides an older synced one
  });
  const HEART = "\u{1F49B}";

  // ---------- calendar dates ----------

  const pad = (n, w) => String(n).padStart(w, "0");
  const ymd = (y, m, d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

  /** Is y-m-d a real calendar day? (2023-02-29 is not.) */
  function isRealDate(y, m, d) {
    if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1) return false;
    const t = new Date(Date.UTC(2000, m - 1, d));
    t.setUTCFullYear(y);
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  /** "2024-02-14" -> { y, m, d }, or null when it isn't a real calendar date. */
  function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    return isRealDate(y, mo, d) ? { y, m: mo, d } : null;
  }

  /** The viewer's local calendar day for an instant, as YYYY-MM-DD. Uses the local getters, which follow the system time zone. */
  function localToday(date) {
    const t = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  const dayNumber = (p) => Date.UTC(p.y, p.m - 1, p.d) / 86400000; // whole days since 1970 in UTC: no DST in it
  /** Whole calendar days from `a` to `b` (both YYYY-MM-DD), negative when b is earlier; null when either is not a real date. */
  function diffDays(a, b) {
    const pa = parseYmd(a), pb = parseYmd(b);
    return pa && pb ? Math.round(dayNumber(pb) - dayNumber(pa)) : null;
  }

  /**
   * Days together: calendar days from `since` to the viewer's local today (0 on the day itself), or null when there is no
   * valid date. Counting calendar days, not elapsed milliseconds, is what keeps it right across DST (a day can have 23 or
   * 25 hours) and time zones (midnight comes at a different instant for everyone).
   *
   * The partner may live a day ahead of us (UTC+14 against UTC-12 is up to two calendar dates), so a date that is at most
   * `futureToleranceDays` after our today counts as 0 ("day one") instead of vanishing; anything further is not shown.
   */
  function daysTogether(since, today) {
    const n = diffDays(since, today);
    if (n === null || n < -LIMITS.futureToleranceDays) return null;
    return Math.max(0, n);
  }

  /** Milliseconds until the viewer's next local midnight (plus a small margin), for the one timer that rolls the count over. */
  function msToNextMidnight(now) {
    const t = now instanceof Date ? now : new Date();
    const next = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1); // local midnight; the constructor handles DST
    return Math.max(1000, next.getTime() - t.getTime() + 50);
  }

  // ---------- names and dates the user types ----------

  const NAME_RE = /^[\p{L}\p{M}\p{N} '.\-]+$/u;

  /** Same rule as the relay's cleanName: NFC, whitespace collapsed, trimmed, 1..20 characters of letters/marks/digits/space/'/./-. */
  function cleanName(raw) {
    const s = String(raw == null ? "" : raw).normalize("NFC").replace(/\s+/g, " ").trim();
    const n = [...s].length;
    return n >= 1 && n <= LIMITS.nameChars && NAME_RE.test(s) ? s : null;
  }

  /** { ok: true, value } or { ok: false, error } with a sentence to show as it is. An empty name is { ok: true, value: "" } (= leave it alone). */
  function validateName(raw) {
    const s = String(raw == null ? "" : raw).normalize("NFC").replace(/\s+/g, " ").trim();
    if (!s) return { ok: true, value: "" };
    if ([...s].length > LIMITS.nameChars) return { ok: false, error: `Names have at most ${LIMITS.nameChars} characters.` };
    if (!NAME_RE.test(s)) return { ok: false, error: "Use letters, numbers, spaces, ' . or - only." };
    return { ok: true, value: s };
  }

  /** "2024-2-14", "2024/02/14" and "2024.2.14" -> "2024-02-14" (shape only, not checked as a real date); null otherwise. */
  function parseDateInput(text) {
    const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(String(text == null ? "" : text));
    return m ? `${m[1]}-${pad(m[2], 2)}-${pad(m[3], 2)}` : null;
  }

  /**
   * The together-since date a user typed, checked against the viewer's local `today` (YYYY-MM-DD).
   * An empty field is { ok: true, value: "" } (= leave it alone). The future is refused here, in the viewer's own calendar;
   * the relay allows up to tomorrow in UTC so a partner a few time zones ahead can still save "today".
   */
  function validateSince(text, today) {
    if (!String(text == null ? "" : text).trim()) return { ok: true, value: "" };
    const iso = parseDateInput(text);
    if (!iso) return { ok: false, error: "Use the format YYYY-MM-DD, like 2024-02-14." };
    if (!parseYmd(iso)) return { ok: false, error: "That date does not exist." };
    if (iso < LIMITS.minDate) return { ok: false, error: "Pick a date from 1970 on." };
    if (diffDays(iso, today) < 0) return { ok: false, error: "The date can't be in the future." };
    return { ok: true, value: iso };
  }

  /**
   * What to send to the relay's `set` route. Each partner sets only their own name (`names=Ada,` for side a, `names=,Bo` for b;
   * an empty half leaves the other side alone). Only changed fields are sent. Returns
   *   { ok: true, params: null }                       nothing changed
   *   { ok: true, params: { names?, since? }, changes } something to send
   *   { ok: false, errors: { name?, since? } }         nothing is sent
   * `current` is what the relay has now: { name (this side's), since }.
   */
  function buildSetParams(o) {
    const me = o && o.me === "b" ? "b" : "a";
    const current = (o && o.current) || {};
    const draft = (o && o.draft) || {};
    const errors = {};
    const params = {}, changes = {};
    const n = validateName(draft.name);
    if (!n.ok) errors.name = n.error;
    else if (n.value && n.value !== (current.name || "")) {
      params.names = me === "a" ? `${n.value},` : `,${n.value}`;
      changes.name = n.value;
    }
    const s = validateSince(draft.since, o && o.today);
    if (!s.ok) errors.since = s.error;
    else if (s.value && s.value !== (current.since || "")) {
      params.since = s.value;
      changes.since = s.value;
    }
    if (errors.name || errors.since) return { ok: false, errors };
    return Object.keys(params).length ? { ok: true, params, changes } : { ok: true, params: null };
  }

  /** A relay `set` answer's { error } as a sentence. */
  function setErrorText(message) {
    switch (message) {
      case "bad name": return "Use letters, numbers, spaces, ' . or - only.";
      case "bad date": return "The relay did not accept that date. Pick a day in the past.";
      case "nothing to set": return "Nothing to save.";
      default: return "The relay did not understand that. Please try again in a moment.";
    }
  }

  /**
   * Our own save shows up in the next sync, but until then the old value would flash back. `pending` is
   * { name?, since?, at } from a successful save. Returns the values to show and what is still pending
   * (a field is dropped once the synced value equals it, and all of it after `optimisticMs`).
   */
  function overlayPending(synced, me, pending, now) {
    const names = { a: synced.names.a, b: synced.names.b };
    let since = synced.togetherSince || "";
    if (!pending || !(now - pending.at < LIMITS.optimisticMs)) return { names, since, pending: null };
    const left = { at: pending.at };
    if (pending.name !== undefined && names[me] !== pending.name) { names[me] = pending.name; left.name = pending.name; }
    if (pending.since !== undefined && since !== pending.since) { since = pending.since; left.since = pending.since; }
    return { names, since, pending: left.name !== undefined || left.since !== undefined ? left : null };
  }

  /** The letter in the circle: the first character (a whole code point, upper case), or "?" when there is no name yet. */
  function initialOf(name) {
    const first = [...String(name == null ? "" : name).trim()][0];
    return first ? first.toLocaleUpperCase() : "?";
  }

  // ---------- milestones ----------

  const isDayMilestone = (n) => n === 100 || n === 365 || n === 500 || n === 1000 || (n > 1000 && n % 1000 === 0);
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  /** The day an anniversary falls on in year `y` for a date: 29 February is celebrated on 28 February in non-leap years. */
  function anniversaryDay(sinceParts, y) {
    return sinceParts.m === 2 && sinceParts.d === 29 && !isLeap(y) ? { m: 2, d: 28 } : { m: sinceParts.m, d: sinceParts.d };
  }

  /**
   * The milestones that fall on `today` (YYYY-MM-DD, the viewer's local day), most important first. Usually none.
   *   { kind: "anniversary", years, days, outfit }   the date comes round again (1 year, 2 years, ...)
   *   { kind: "days", days, outfit }                 100, 365, 500, 1000 days, then every 1000
   * `outfitFor(days)` is the mascot's milestoneOutfit, which names the pet outfit a milestone unlocks (anniversaries
   * always unlock "anniversary"). `key` is unique per milestone and date, so a celebration plays once.
   */
  function milestonesOn(since, today, outfitFor) {
    const sp = parseYmd(since), tp = parseYmd(today);
    if (!sp || !tp) return [];
    const days = diffDays(since, today);
    if (days === null || days < 1) return [];
    const out = [];
    const years = tp.y - sp.y;
    const a = anniversaryDay(sp, tp.y);
    if (years >= 1 && tp.m === a.m && tp.d === a.d) out.push({ kind: "anniversary", years, days, outfit: "anniversary", key: `${since}:y${years}` });
    if (isDayMilestone(days)) out.push({ kind: "days", days, outfit: (typeof outfitFor === "function" && outfitFor(days)) || null, key: `${since}:d${days}` });
    return out;
  }

  /**
   * The pet outfits the milestones up to `today` have unlocked ("party" from 100 days, "anniversary" from the first
   * anniversary), for the pet view to offer. Derived from the date alone, so both partners and every copy agree.
   */
  function unlockedOutfits(since, today, outfitFor) {
    const sp = parseYmd(since);
    const days = diffDays(since, today);
    if (!sp || days === null || days < 1) return [];
    const set = new Set();
    const oF = typeof outfitFor === "function" ? outfitFor : () => null;
    for (const d of [100, 365, 500, 1000]) if (days >= d && oF(d)) set.add(oF(d));
    for (let d = 2000; d <= days; d += 1000) if (oF(d)) set.add(oF(d));
    const tp = parseYmd(today);
    const years = tp.y - sp.y;
    if (years >= 1) {
      const a = anniversaryDay(sp, tp.y);
      if (years > 1 || tp.m > a.m || (tp.m === a.m && tp.d >= a.d)) set.add("anniversary");
    }
    return [...set];
  }

  /** The line shown on the day: "Happy 2 years", "Happy 1,000 days". `fmt` formats numbers (umbra.fmt(n, 0)). */
  function milestoneLine(m, fmt) {
    const f = typeof fmt === "function" ? fmt : (n) => String(n);
    if (!m) return "";
    if (m.kind === "anniversary") return `Happy ${m.years} ${m.years === 1 ? "year" : "years"} ${HEART}`;
    return `Happy ${f(m.days)} days ${HEART}`;
  }

  // ---------- confetti ----------

  /** Deterministic given `rnd` (a () => [0,1) function): where each piece starts, how long it falls, which colour. */
  function confettiPieces(count, rnd) {
    const r = typeof rnd === "function" ? rnd : Math.random;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        x: Math.round(r() * 100),                 // % from the left
        delay: Math.round(r() * 700),             // ms
        dur: 1800 + Math.round(r() * 1400),       // ms
        drift: Math.round((r() - 0.5) * 60),      // px sideways
        spin: Math.round((r() - 0.5) * 720),      // deg
        color: Math.floor(r() * 4),               // index into the Meadow palette
        w: 5 + Math.floor(r() * 4),
        h: 8 + Math.floor(r() * 5),
      });
    }
    return out;
  }

  const api = {
    LIMITS, HEART,
    isRealDate, parseYmd, localToday, diffDays, daysTogether, msToNextMidnight,
    cleanName, validateName, parseDateInput, validateSince, buildSetParams, setErrorText, overlayPending, initialOf,
    milestonesOn, unlockedOutfits, milestoneLine, confettiPieces,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthOverviewLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
