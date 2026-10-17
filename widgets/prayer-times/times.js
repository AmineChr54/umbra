// Prayer time logic for the prayer-times widget. Pure functions, no DOM, no network.
// Browser: window.PrayerTimes. Node: module.exports (tests/widgets/prayer-times.test.mjs).
//
// The Aladhan calendar gives wall-clock "HH:MM" strings in the LOCATION's time zone (meta.timezone), not the
// machine's. Everything here converts those to real instants with Intl, so the next prayer and the countdown are
// right wherever the user's PC is, and across DST changes. `now` and the zone are always passed in.
(function (root) {
  "use strict";
  const DAY = 86400000;
  const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  const NAMES = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]; // in order through the day
  const pad = (n) => String(n).padStart(2, "0");

  const dtfs = new Map();
  function parts(ts, tz) {
    let f = dtfs.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      dtfs.set(tz, f);
    }
    const p = {};
    for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
    return p;
  }

  function validTz(tz) {
    if (typeof tz !== "string" || !tz) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
  }

  /** Offset of `tz` from UTC at instant `ts`, in ms (Berlin in summer: +7200000). */
  function tzOffsetMs(ts, tz) {
    const p = parts(ts, tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
  }

  /** "YYYY-MM-DD" of instant `ts` on the calendar of `tz`. */
  function dateKey(ts, tz) {
    const p = parts(ts, tz);
    return `${p.year}-${p.month}-${p.day}`;
  }

  /** The key `n` days after `key` (n may be negative). */
  function shiftKey(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  /** Instant at which the wall clock of `tz` shows `hhmm` ("05:41") on `key` ("2026-10-17"). */
  function zonedToUtc(key, hhmm, tz) {
    const [y, mo, d] = key.split("-").map(Number);
    const [h, mi] = hhmm.split(":").map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    const o1 = tzOffsetMs(wall, tz);
    let t = wall - o1;
    const o2 = tzOffsetMs(t, tz);
    if (o2 !== o1) t = wall - o2; // the offset changed between the guess and the answer (DST edge)
    return t;
  }

  /** "05:41", "5:41" or "05:41 (CEST)" -> "05:41"; null when it is not a time. */
  function parseHM(s) {
    const m = /(\d{1,2}):(\d{2})/.exec(String(s ?? ""));
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return `${pad(h)}:${pad(mi)}`;
  }

  function parseHijri(h) {
    if (!h || typeof h !== "object") return null;
    const d = Number(h.day), y = Number(h.year);
    const en = h.month && typeof h.month.en === "string" ? h.month.en : "";
    if (!(d >= 1 && d <= 30) || !(y > 0) || !en) return null;
    const ar = h.month && typeof h.month.ar === "string" ? h.month.ar : "";
    const len = Number(h.month && h.month.days);
    return { d, m: en, ar, y, len: len >= 29 && len <= 30 ? len : 30 };
  }

  /**
   * Reads a response of /v1/calendarByCity/{year}/{month} (or /v1/calendar) into the compact form we cache:
   * { tz, days: { "YYYY-MM-DD": { t: { Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha }, h: hijri|null } } }.
   * Days that are malformed are skipped; throws when nothing usable is left.
   */
  function parseCalendar(json) {
    const list = json && json.data;
    if (!Array.isArray(list)) throw new Error("Unexpected response from the prayer time service");
    let tz = null;
    const days = {};
    for (const e of list) {
      const g = /^(\d{2})-(\d{2})-(\d{4})$/.exec((e && e.date && e.date.gregorian && e.date.gregorian.date) || "");
      if (!g || !e.timings) continue;
      const t = {};
      let ok = true;
      for (const n of NAMES) {
        const hm = parseHM(e.timings[n]);
        if (!hm) { ok = false; break; }
        t[n] = hm;
      }
      if (!ok) continue;
      if (!tz && validTz(e.meta && e.meta.timezone)) tz = e.meta.timezone;
      days[`${g[3]}-${g[2]}-${g[1]}`] = { t, h: parseHijri(e.date.hijri) };
    }
    if (!tz) throw new Error("The prayer time service sent no time zone");
    if (!Object.keys(days).length) throw new Error("The prayer time service sent no usable days");
    return { tz, days };
  }

  const clampInt = (v, min, max, def = 0) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };

  /**
   * Adhan and iqama instants for one day. Fajr..Isha get the user's minute adjustment (-30..30), which has the same
   * effect as Aladhan's `tune`, but needs no new download. A time that comes out before the previous one (Isha
   * past midnight at high latitudes) belongs to the next calendar day.
   * adjust / iqama: { Fajr: minutes, ... }.
   */
  function dayEvents(key, day, tz, adjust = {}, iqama = {}) {
    const out = [];
    let prev = -Infinity; // previous calculated (unadjusted) time, so a big adjustment can't flip the order
    for (const name of NAMES) {
      const prayer = name !== "Sunrise";
      const adj = prayer ? clampInt(adjust[name], -30, 30) * 60000 : 0;
      let base = zonedToUtc(key, day.t[name], tz);
      if (base < prev) base = zonedToUtc(shiftKey(key, 1), day.t[name], tz);
      prev = base;
      const ts = base + adj;
      const iq = prayer ? clampInt(iqama[name], 0, 90) : 0;
      out.push({ name, key, ts, prayer, iqamaMin: iq, iqamaTs: iq > 0 ? ts + iq * 60000 : null });
    }
    return out;
  }

  /**
   * Where are we in the day? data = { tz, days }, now = ms, opts = { adjust, iqama }.
   * Returns { tz, todayKey, hasToday, rows, current, next, needsNext, iqamaPending, hijri, events }.
   * - rows: today's six events (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) with flags isCurrent / isNext / past.
   * - current: the prayer whose time has begun and not ended (null between sunrise and Dhuhr, or without data).
   *   After Isha it stays Isha until the next Fajr, even after midnight.
   * - next: the next prayer, rolling over to tomorrow's Fajr after Isha; null (needsNext) if tomorrow is missing.
   * - iqamaPending: { name, at, ms } while the current prayer's iqama is still to come.
   * - hijri: today's Hijri date, switched to tomorrow's after Maghrib (the Islamic day begins at sunset).
   */
  function schedule(data, now, opts = {}) {
    const tz = data && data.tz;
    const empty = { tz, todayKey: null, hasToday: false, rows: [], current: null, next: null, needsNext: false, iqamaPending: null, hijri: null, events: [] };
    if (!data || !validTz(tz) || !data.days) return empty;
    const todayKey = dateKey(now, tz);
    const today = data.days[todayKey];
    if (!today) return { ...empty, todayKey };
    const tomorrowKey = shiftKey(todayKey, 1);
    const events = [];
    for (const k of [shiftKey(todayKey, -1), todayKey, tomorrowKey]) {
      const day = data.days[k];
      if (day) events.push(...dayEvents(k, day, tz, opts.adjust, opts.iqama));
    }
    events.sort((a, b) => a.ts - b.ts);

    let last = null, next = null;
    for (const e of events) {
      if (e.ts <= now) last = e;
      else if (e.prayer && !next) next = e;
    }
    const current = last && last.prayer ? last : null;
    const rows = events.filter((e) => e.key === todayKey).map((e) => ({ ...e, isCurrent: e === current, isNext: e === next, past: e.ts <= now }));
    const iqamaPending = current && current.iqamaTs && now < current.iqamaTs ? { name: current.name, at: current.iqamaTs, ms: current.iqamaTs - now } : null;

    const maghrib = rows.find((r) => r.name === "Maghrib");
    const tomorrow = data.days[tomorrowKey];
    const hijri = maghrib && maghrib.past && tomorrow && tomorrow.h ? tomorrow.h : today.h;

    return { tz, todayKey, hasToday: true, rows, current, next, needsNext: !next, iqamaPending, hijri, events };
  }

  /** 4 min 05 s -> "04:05"; 1 h 02 min 09 s -> "1:02:09". Rounds up so it never shows 00:00 early. */
  function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  /**
   * Clock time of instant `ts` in `tz`. o = { hour12: bool, locale?: string }. 24-hour is always "05:41";
   * 12-hour follows the locale ("5:41 AM").
   */
  function formatTime(ts, tz, o = {}) {
    const h12 = !!o.hour12;
    const locale = o.locale || (h12 ? "en-US" : "en-GB");
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz, hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hourCycle: h12 ? "h12" : "h23",
    }).format(new Date(ts));
  }

  /** "Sat, 17 Oct" for instant `ts` in `tz`. */
  function formatDate(ts, tz, locale) {
    return new Intl.DateTimeFormat(locale || "en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(ts));
  }

  /** { d: 6, m: "Jumādá al-ūlá", ar: "...", y: 1448 } -> "6 Jumādá al-ūlá 1448" ("" for bad input). */
  function formatHijri(h, opts = {}) {
    const x = h && typeof h.d === "number" && h.y > 0 ? h : null;
    if (!x) return "";
    const month = opts.arabic && x.ar ? x.ar : x.m;
    return month ? `${x.d} ${month} ${x.y}` : "";
  }

  /**
   * 12- or 24-hour from what the host may offer: `umbra.hour12` (boolean) wins, else the locale's own clock
   * (`umbra.locale`); 24-hour when neither exists (older hosts).
   */
  function resolveHour12(hour12, locale) {
    if (typeof hour12 === "boolean") return hour12;
    if (typeof locale === "string" && locale) {
      try {
        const hc = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
        return hc === "h12" || hc === "h11";
      } catch { /* bad locale tag */ }
    }
    return false;
  }

  /** The calendar months to hold: this month, next month from the 25th (so after Isha on the last day tomorrow's Fajr is known), previous month on the 1st. */
  function monthsNeeded(now, tz) {
    const zone = validTz(tz) ? tz : undefined;
    const p = zone ? parts(now, zone) : null;
    const d = p ? { y: +p.year, m: +p.month, day: +p.day } : { y: new Date(now).getFullYear(), m: new Date(now).getMonth() + 1, day: new Date(now).getDate() };
    const at = (delta) => {
      const t = new Date(Date.UTC(d.y, d.m - 1 + delta, 1));
      const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
      return { id: `${y}-${pad(m)}`, y, m };
    };
    const out = [at(0)];
    if (d.day >= 25) out.push(at(1));
    if (d.day === 1) out.push(at(-1));
    return out;
  }

  /** Events that began within the last `windowMs` and were not announced yet (one notification per prayer per day). */
  function notifyDue(events, now, notified = {}, windowMs = 180000) {
    return events.filter((e) => e.prayer && e.ts <= now && now - e.ts <= windowMs && !notified[`${e.key}|${e.name}`]);
  }

  /** Drop notification marks older than the previous day. */
  function pruneNotified(notified, todayKey) {
    const keep = new Set([todayKey, shiftKey(todayKey, -1), shiftKey(todayKey, 1)]);
    const out = {};
    for (const [id, v] of Object.entries(notified || {})) if (keep.has(id.split("|")[0])) out[id] = v;
    return out;
  }

  const api = {
    PRAYERS, NAMES, validTz, tzOffsetMs, dateKey, shiftKey, zonedToUtc, parseHM, parseCalendar, dayEvents, schedule,
    formatCountdown, formatTime, formatDate, formatHijri, resolveHour12, monthsNeeded, notifyDue, pruneNotified, clampInt,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PrayerTimes = api;
})(typeof window !== "undefined" ? window : globalThis);
