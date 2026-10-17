// Small iCalendar reader: VEVENT with RRULE, EXDATE, RECURRENCE-ID and TZID. Pure functions, no DOM.
// Browser: window.ICal. Node: module.exports. Times are handled as "wall clock" values (a Date.UTC of the
// local fields) while recurring, then converted to real instants per occurrence so DST is respected.
(function (root) {
  "use strict";
  const DAY = 86400000;
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function unfold(text) {
    return String(text).replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
  }

  function unescapeText(s) {
    return s.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
  }

  function parseLine(line) {
    let inQ = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ":" && !inQ) { colon = i; break; }
    }
    if (colon < 0) return null;
    const head = line.slice(0, colon).split(";");
    const params = {};
    for (const p of head.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) };
  }

  function tzOffset(ms, tz) {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  /** Wall-clock value (Date.UTC of the fields) in zone tz (null = system local, "UTC") to an instant. */
  function toInstant(wall, tz) {
    if (tz === "UTC") return wall;
    if (!tz) {
      const d = new Date(wall);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
    }
    try {
      let inst = wall - tzOffset(wall, tz);
      inst = wall - tzOffset(inst, tz);
      return inst;
    } catch { return toInstant(wall, null); }
  }

  /** An instant to a wall-clock value in zone tz. */
  function toWall(inst, tz) {
    if (tz === "UTC") return inst;
    if (!tz) { const d = new Date(inst); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); }
    try { return inst + tzOffset(inst, tz); } catch { return toWall(inst, null); }
  }

  /** DTSTART/DTEND/EXDATE value to { wall, tz, allDay }. */
  function parseDate(value, params) {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(value.trim());
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const allDay = m[4] === undefined || params.VALUE === "DATE";
    return { wall, allDay, tz: m[7] ? "UTC" : allDay ? null : params.TZID || null };
  }

  function parseDuration(s) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
    if (!m) return 0;
    const ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000;
    return m[1] === "-" ? -ms : ms;
  }

  function parseRule(value) {
    const r = { freq: "", interval: 1, count: 0, until: null, byday: [], bymonthday: [], bymonth: [], wkst: 1 };
    for (const part of value.split(";")) {
      const [k, v = ""] = part.split("=");
      switch (k.toUpperCase()) {
        case "FREQ": r.freq = v.toUpperCase(); break;
        case "INTERVAL": r.interval = Math.max(1, parseInt(v, 10) || 1); break;
        case "COUNT": r.count = parseInt(v, 10) || 0; break;
        case "UNTIL": r.until = parseDate(v, {}); break;
        case "BYDAY":
          for (const d of v.split(",")) {
            const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
            if (m) r.byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, d: DAYS.indexOf(m[2].toUpperCase()) });
          }
          break;
        case "BYMONTHDAY": r.bymonthday = v.split(",").map(Number).filter(Boolean); break;
        case "BYMONTH": r.bymonth = v.split(",").map(Number).filter(Boolean); break;
        case "WKST": { const i = DAYS.indexOf(v.toUpperCase()); if (i >= 0) r.wkst = i; break; }
      }
    }
    return r;
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

  /** Day-of-month numbers in (y, m) matching an ordinal weekday such as 2TU or -1FR (n = 0: every such weekday). */
  function nthWeekdays(y, m, d, n) {
    const out = [];
    for (let day = 1; day <= daysInMonth(y, m); day++) if (new Date(Date.UTC(y, m, day)).getUTCDay() === d) out.push(day);
    if (!n) return out;
    const pick = n > 0 ? out[n - 1] : out[out.length + n];
    return pick ? [pick] : [];
  }

  /** Candidate days (Date.UTC at midnight) of period number `i`, sorted. */
  function periodDays(rule, start, i) {
    const s = new Date(start), step = i * rule.interval;
    const sy = s.getUTCFullYear(), sm = s.getUTCMonth(), sd = s.getUTCDate();
    const midnight = Date.UTC(sy, sm, sd);
    const out = [];
    switch (rule.freq) {
      case "DAILY": {
        const day = midnight + step * DAY, dt = new Date(day);
        if (rule.bymonth.length && !rule.bymonth.includes(dt.getUTCMonth() + 1)) break;
        if (rule.byday.length && !rule.byday.some(b => b.d === dt.getUTCDay())) break;
        if (rule.bymonthday.length && !rule.bymonthday.some(n => n > 0 ? n === dt.getUTCDate() : daysInMonth(dt.getUTCFullYear(), dt.getUTCMonth()) + n + 1 === dt.getUTCDate())) break;
        out.push(day);
        break;
      }
      case "WEEKLY": {
        const back = (s.getUTCDay() - rule.wkst + 7) % 7;
        const weekStart = midnight - back * DAY + step * 7 * DAY;
        const wanted = rule.byday.length ? rule.byday.map(b => b.d) : [s.getUTCDay()];
        for (const d of wanted) out.push(weekStart + ((d - rule.wkst + 7) % 7) * DAY);
        break;
      }
      case "MONTHLY": case "YEARLY": {
        const months = rule.freq === "MONTHLY"
          ? [{ y: sy + Math.floor((sm + step) / 12), m: (((sm + step) % 12) + 12) % 12 }]
          : (rule.bymonth.length ? rule.bymonth : [sm + 1]).map(m => ({ y: sy + step, m: m - 1 }));
        for (const { y, m } of months) {
          if (rule.freq === "MONTHLY" && rule.bymonth.length && !rule.bymonth.includes(m + 1)) continue;
          const dim = daysInMonth(y, m);
          let nums = [];
          if (rule.bymonthday.length) nums = rule.bymonthday.map(n => (n > 0 ? n : dim + n + 1));
          else if (rule.byday.length) for (const b of rule.byday) nums.push(...nthWeekdays(y, m, b.d, b.n));
          else nums = [sd];
          if (rule.bymonthday.length && rule.byday.length) nums = nums.filter(n => rule.byday.some(b => b.d === new Date(Date.UTC(y, m, n)).getUTCDay()));
          for (const n of nums) if (n >= 1 && n <= dim) out.push(Date.UTC(y, m, n));
        }
        break;
      }
    }
    return out.sort((a, b) => a - b);
  }

  /** Wall-clock start values of every occurrence from `startWall` up to `limitWall`. */
  function occurrences(rule, startWall, limitWall, exWalls) {
    const tod = startWall - Math.floor(startWall / DAY) * DAY;
    const out = [];
    let n = 0;
    for (let i = 0; i < 20000; i++) {
      const days = periodDays(rule, startWall, i);
      for (const day of days) {
        const w = day + tod;
        if (w < startWall) continue;
        if (rule.until && w > rule.until.wall + (rule.until.allDay ? DAY - 1 : 0)) return out;
        if (rule.count && ++n > rule.count) return out;
        if (w > limitWall) return out;
        if (!exWalls.has(w)) out.push(w);
      }
      const first = days.length ? days[0] + tod : 0;
      if (first > limitWall) break;
      // A rule that never matches (e.g. 31 February) must not spin forever.
      if (!days.length && i > 500 && rule.freq !== "DAILY") break;
      if (rule.freq === "YEARLY" && i > 300) break;
    }
    return out;
  }

  function readEvents(text) {
    const events = [];
    let cur = null;
    for (const line of unfold(text)) {
      const p = parseLine(line);
      if (!p) continue;
      if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") cur = { ex: [], props: {} };
      else if (p.name === "END" && p.value.toUpperCase() === "VEVENT") { if (cur) events.push(cur); cur = null; }
      else if (cur) {
        if (p.name === "EXDATE") for (const v of p.value.split(",")) { const d = parseDate(v, p.params); if (d) cur.ex.push(d); }
        else cur.props[p.name] = p;
      }
    }
    return events;
  }

  /**
   * Events overlapping [fromMs, toMs), recurring ones expanded, sorted by start.
   * Returns [{ start, end, allDay, summary, location, uid }] with epoch-ms instants.
   */
  function expand(text, fromMs, toMs) {
    const out = [];
    const raw = readEvents(text);
    const overridden = new Set();
    for (const e of raw) {
      const rid = e.props["RECURRENCE-ID"];
      if (rid && e.props.UID) { const d = parseDate(rid.value, rid.params); if (d) overridden.add(e.props.UID.value + "|" + toInstant(d.wall, d.tz)); }
    }
    for (const e of raw) {
      const P = e.props;
      if (!P.DTSTART || (P.STATUS && P.STATUS.value.toUpperCase() === "CANCELLED")) continue;
      const ds = parseDate(P.DTSTART.value, P.DTSTART.params);
      if (!ds) continue;
      let durMs;
      if (P.DTEND) {
        const de = parseDate(P.DTEND.value, P.DTEND.params);
        durMs = de ? toInstant(de.wall, de.tz) - toInstant(ds.wall, ds.tz) : 0;
      } else if (P.DURATION) durMs = parseDuration(P.DURATION.value);
      else durMs = ds.allDay ? DAY : 0;
      if (durMs < 0) durMs = 0;
      const info = {
        allDay: ds.allDay,
        summary: unescapeText(P.SUMMARY ? P.SUMMARY.value : "").trim() || "(no title)",
        location: unescapeText(P.LOCATION ? P.LOCATION.value : "").trim(),
        uid: P.UID ? P.UID.value : "",
      };
      const add = (startInst) => {
        const end = startInst + durMs;
        const hit = durMs === 0 ? startInst >= fromMs && startInst < toMs : startInst < toMs && end > fromMs;
        if (hit) out.push({ ...info, start: startInst, end });
      };
      const rule = P.RRULE ? parseRule(P.RRULE.value) : null;
      if (!rule || !rule.freq) { add(toInstant(ds.wall, ds.tz)); continue; }
      const tz = ds.tz;
      const exWalls = new Set(e.ex.map(x => (x.allDay || x.tz === tz ? x.wall : toWall(toInstant(x.wall, x.tz), tz))));
      const limitWall = toWall(toMs, tz) + DAY;
      for (const w of occurrences(rule, ds.wall, limitWall, exWalls)) {
        const inst = toInstant(w, tz);
        if (info.uid && overridden.has(info.uid + "|" + inst)) continue;
        add(inst);
      }
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  const api = { expand, parseRule, parseDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ICal = api;
})(typeof window !== "undefined" ? window : globalThis);
