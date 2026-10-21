// Event Radar core: date keys, the text parser behind the Add window, overlap detection, grouping and the
// timeline layout. No DOM and no umbra.* calls, so it can be tested in plain node.
(function (root) {
  "use strict";

  const STATUSES = ["going", "maybe", "todo", "deadline", "no"];

  // ---------- date keys ("YYYY-MM-DD", compared as strings) ----------

  const pad = (n) => String(n).padStart(2, "0");
  const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isKey(s) {
    const m = typeof s === "string" && KEY_RE.exec(s);
    if (!m) return false;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
  }
  const toUtc = (k) => { const m = KEY_RE.exec(k); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  const fromUtc = (ms) => { const d = new Date(ms); return key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
  const diffDays = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 864e5);
  const addDays = (k, n) => fromUtc(toUtc(k) + n * 864e5);
  const todayKey = (now = new Date()) => key(now.getFullYear(), now.getMonth() + 1, now.getDate());
  /** Local-time Date for formatting with Intl. */
  const toDate = (k) => { const m = KEY_RE.exec(k); return new Date(+m[1], +m[2] - 1, +m[3]); };
  const weekday = (k) => new Date(toUtc(k)).getUTCDay();

  function validEvent(e) {
    return !!e && typeof e.id === "string" && typeof e.title === "string" && e.title.trim() !== "" &&
      isKey(e.start) && isKey(e.end) && e.end >= e.start && STATUSES.includes(e.status);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- text parser ----------

  const MONTHS = {
    jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, "märz": 3, maerz: 3,
    apr: 4, april: 4, may: 5, mai: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11,
    dec: 12, december: 12, dez: 12, dezember: 12,
  };
  const MON = "(january|januar|jan|february|februar|feb|march|märz|maerz|mar|april|apr|may|mai|june|juni|jun|july|juli|jul|august|aug|september|sept|sep|october|oktober|oct|okt|november|nov|december|dezember|dec|dez)(?![a-zäöü])";

  // Each scheme returns candidate matches { index, length, s:{d,m,y?}, e:{d,m,y?} }; the last one in a line wins,
  // so a number earlier in the title ("v1.5 release 12.04.") can't be mistaken for the date.
  const DASH = "[-–—]";
  const SCHEMES = [
    {
      // 2026-10-23 or 2026-10-23 - 2026-10-25
      re: new RegExp(`(\\d{4})-(\\d{2})-(\\d{2})(?:\\s*(?:${DASH}|to|\\.\\.)\\s*(\\d{4})-(\\d{2})-(\\d{2}))?`, "gi"),
      make: (m) => ({ s: { y: +m[1], m: +m[2], d: +m[3] }, e: m[4] ? { y: +m[4], m: +m[5], d: +m[6] } : null }),
    },
    {
      // 05.10.-09.10.   10.-12.04.   21.04.–28.04.   17.04 - 19.04   (year optional)
      re: new RegExp(`(\\d{1,2})\\.(?:(\\d{1,2})(?:\\.(\\d{4}))?)?\\.?\\s*${DASH}\\s*(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?\\.?`, "g"),
      make: (m) => ({
        s: { d: +m[1], m: m[2] ? +m[2] : null, y: m[3] ? +m[3] : undefined },
        e: { d: +m[4], m: +m[5], y: m[6] ? +m[6] : undefined },
      }),
    },
    {
      // 23.10.   23.10   23.10.2026
      re: /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?/g,
      make: (m) => ({ s: { d: +m[1], m: +m[2], y: m[3] ? +m[3] : undefined }, e: null }),
    },
    {
      // 23 Oct - 25 Oct   23.-25. Oct   23-25 Oct
      re: new RegExp(`(\\d{1,2})\\.?(?:\\s*${MON})?\\s*${DASH}\\s*(\\d{1,2})\\.?\\s*${MON}(?:\\s*(\\d{4}))?`, "gi"),
      make: (m) => {
        const em = MONTHS[m[4].toLowerCase()], sm = m[2] ? MONTHS[m[2].toLowerCase()] : em;
        return { s: { d: +m[1], m: sm }, e: { d: +m[3], m: em, y: m[5] ? +m[5] : undefined } };
      },
    },
    {
      // 23 Oct   23. Oktober 2026
      re: new RegExp(`(\\d{1,2})\\.?\\s*${MON}(?:\\s*(\\d{4}))?`, "gi"),
      make: (m) => ({ s: { d: +m[1], m: MONTHS[m[2].toLowerCase()], y: m[3] ? +m[3] : undefined }, e: null }),
    },
  ];

  function dayOk(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && isKey(key(y, m, d)); }

  /** Finds the date in `text`: { index, length, s, e } with raw (maybe yearless) parts, or null. */
  function findDate(text) {
    for (const scheme of SCHEMES) {
      let best = null;
      for (const m of text.matchAll(scheme.re)) {
        const p = scheme.make(m);
        const sm = p.s.m ?? (p.e && p.e.m);
        // a candidate must at least name real days and months (in a leap year, so 29.02. isn't dropped here)
        if (!dayOk(2024, sm, p.s.d) || (p.e && !dayOk(2024, p.e.m, p.e.d))) continue;
        best = { index: m.index, length: m[0].length, s: p.s, e: p.e };
      }
      if (best) return best;
    }
    return null;
  }

  /** Turns the raw parts into start/end keys. A missing year means the next time the range is not over yet. */
  function resolveDates(p, today) {
    const s = { ...p.s };
    const e = p.e ? { ...p.e } : { ...p.s };
    if (s.m == null) s.m = s.d > e.d ? (e.m === 1 ? 12 : e.m - 1) : e.m; // "10.-12.04." / "30.-02.11."
    const ty = +today.slice(0, 4);
    const md = (x) => x.m * 100 + x.d;
    const wraps = md(e) < md(s);
    let ys = s.y, ye = e.y;
    if (ys == null && ye == null) {
      ys = ty; ye = wraps ? ty + 1 : ty;
      if (key(ye, e.m, e.d) < today) { ys++; ye++; }
    } else if (ys == null) ys = ye - (wraps ? 1 : 0);
    else if (ye == null) ye = ys + (wraps ? 1 : 0);
    const start = key(ys, s.m, s.d), end = key(ye, e.m, e.d);
    if (!isKey(start) || !isKey(end) || end < start) return null;
    return { start, end };
  }

  // Order matters: "Not going" must win over "going", and "Going day1??" over the "??" of maybe.
  const STATUS_WORDS = [
    ["no", /not going|won'?t go|\bcan'?t\b|\bcant\b|cannot|not attending|\bskip|cancel+ed|hölle nein|\bnein\b|😭|❌|🚫/i],
    ["deadline", /\bdeadline\b|\bdue\b|\bfrist\b/i],
    ["todo", /need to do|\bto ?do\b|free to do|\bmuss\b/i],
    ["going", /\bgoing\b|\bgo\b|\byes\b|\bconfirmed\b|\bdabei\b|✈|✅/i],
    ["maybe", /maybe|\bmight\b|low priority|\bunsure\b|vielleicht|take a small look|\?\?/i],
  ];
  function classify(text) {
    for (const [status, re] of STATUS_WORDS) if (re.test(text)) return { status, re };
    return null;
  }

  const FILLER = /[-–—_]{3,}/;
  const SEP_EDGES = /^[\s\-–—:,|·]+|[\s\-–—:,|·]+$/g;
  const BIS = /\b(bis|until|by|due)\s*[-–:]?\s*$/i;

  /**
   * One line of free text -> { raw, ok, event } or { raw, ok: false, error }, or null for blank/ruler lines.
   * Understands lines like "Tirana - Albania 07.10.-10.10. ------ (4)" and "Hackathon 26.10.-27.10. Going".
   */
  function parseLine(raw, opts) {
    const today = (opts && opts.today) || todayKey();
    const fallback = (opts && opts.defaultStatus) || "going";
    const line = String(raw).trim();
    if (!line || /^[\s\-–—_=*#.]+$/.test(line)) return null;

    // "Name date ------ status": the long run of dashes splits the line.
    const cut = FILLER.exec(line);
    const left = cut ? line.slice(0, cut.index) : line;
    const right = cut ? line.slice(cut.index).replace(/[-–—_]+/g, " ").trim() : "";

    const hit = findDate(left);
    if (!hit) return { raw, ok: false, error: "No date found" };
    const dates = resolveDates(hit, today);
    if (!dates) return { raw, ok: false, error: "That isn't a real date" };

    let before = left.slice(0, hit.index);
    let after = left.slice(hit.index + hit.length);
    const bis = BIS.test(before);
    before = before.replace(BIS, "");

    let title = before.replace(SEP_EDGES, "");
    let note = after.replace(SEP_EDGES, "");
    if (!title) { title = note; note = ""; }
    if (!title) return { raw, ok: false, error: "No title" };

    const found = classify(`${note} ${right}`);
    if (found && note) {
      // drop the status word from the note: "(Deadline)" -> "", "Hackathon - Going" -> "Hackathon"
      note = note.replace(found.re, "").replace(/\(\s*\)/g, "").replace(SEP_EDGES, "");
    }
    note = note.replace(/^\((.*)\)$/, "$1").trim(); // "(32h Hackathon)" -> "32h Hackathon"
    const status = found ? found.status : bis || /\b(deadline|frist)\b/i.test(title) ? "deadline" : fallback;

    return {
      raw,
      ok: true,
      event: {
        id: uid(),
        title: title.slice(0, 80),
        start: dates.start,
        end: dates.end,
        status,
        ...(note ? { note: note.slice(0, 80) } : {}),
      },
    };
  }

  function parseLines(text, opts) {
    return String(text).split(/\r?\n/).map((l) => parseLine(l, opts)).filter(Boolean);
  }

  const sameEvent = (a, b) => a.title.toLowerCase() === b.title.toLowerCase() && a.start === b.start && a.end === b.end;

  // ---------- plan logic ----------

  const cmp = (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title);
  const sortEvents = (list) => [...list].sort(cmp);
  const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;

  /** id -> events it overlaps with. Only things you will attend count: a deadline or a "maybe" blocks nothing. */
  function findClashes(events) {
    const out = new Map();
    const going = events.filter((e) => e.status === "going");
    for (let i = 0; i < going.length; i++) {
      for (let j = i + 1; j < going.length; j++) {
        if (!overlaps(going[i], going[j])) continue;
        for (const [a, b] of [[going[i], going[j]], [going[j], going[i]]]) {
          if (!out.has(a.id)) out.set(a.id, []);
          out.get(a.id).push(b);
        }
      }
    }
    return out;
  }

  /** Running now / the next 7 days / later / past, each sorted; empty groups are left out. */
  function group(events, today) {
    const soonEnd = addDays(today, 7);
    const g = { now: [], soon: [], later: [], past: [] };
    for (const e of sortEvents(events)) {
      if (e.end < today) g.past.push(e);
      else if (e.start <= today) g.now.push(e);
      else if (e.start <= soonEnd) g.soon.push(e);
      else g.later.push(e);
    }
    g.now.sort((a, b) => a.end.localeCompare(b.end) || cmp(a, b));
    g.past.reverse();
    return [
      { id: "now", label: "Now", items: g.now },
      { id: "soon", label: "Next 7 days", items: g.soon },
      { id: "later", label: "Later", items: g.later },
      { id: "past", label: "Past", items: g.past },
    ].filter((x) => x.items.length);
  }

  /** "in 5d", "day 2/3", "due in 4d", "3d ago". */
  function whenLabel(e, today) {
    if (e.end < today) {
      const n = diffDays(e.end, today);
      return n === 1 ? "yesterday" : `${n}d ago`;
    }
    if (e.status === "deadline") {
      const n = diffDays(today, e.end);
      return n === 0 ? "due today" : n === 1 ? "due tomorrow" : `due in ${n}d`;
    }
    if (e.start <= today) {
      const total = diffDays(e.start, e.end) + 1;
      return total === 1 ? "today" : `day ${diffDays(e.start, today) + 1}/${total}`;
    }
    const n = diffDays(today, e.start);
    return n === 1 ? "tomorrow" : `in ${n}d`;
  }

  /** Days from `today` to the same day of the month `months` later (clamped to that month's last day). */
  function daysAhead(today, months) {
    const d = toDate(today);
    const end = new Date(d.getFullYear(), d.getMonth() + months + 1, 0); // last day of the target month
    end.setDate(Math.min(d.getDate(), end.getDate()));
    return diffDays(today, key(end.getFullYear(), end.getMonth() + 1, end.getDate()));
  }

  /**
   * Vertical timeline layout: time runs down, one `dayPx` per day. Events become bars (y1..y2) packed into
   * side-by-side lanes, and each gets a label row at its start, nudged down so labels never overlap.
   */
  function timeline(events, today, o) {
    const days = (o && o.days) || daysAhead(today, (o && o.months) || 3);
    const dayPx = (o && o.dayPx) || 12, minBar = (o && o.minBar) || 8, labelH = (o && o.labelH) || 18;
    const last = addDays(today, days - 1);
    const lanes = []; // bottom-most occupied pixel per lane
    const items = [];
    let later = 0, labelEnd = 0;
    for (const e of sortEvents(events)) {
      if (e.status === "no" || e.end < today) continue;
      if (e.start > last) { later++; continue; }
      const s = Math.max(0, diffDays(today, e.start)), t = Math.min(days - 1, diffDays(today, e.end));
      const y1 = s * dayPx, y2 = Math.max(y1 + minBar, (t + 1) * dayPx);
      let lane = lanes.findIndex((end) => end + 2 <= y1);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = y2;
      const labelY = Math.max(y1, labelEnd);
      labelEnd = labelY + labelH;
      items.push({ event: e, y1, y2, lane, labelY, clippedTop: e.start < today });
    }
    return { items, lanes: lanes.length, later, dayPx, days, last, height: Math.max(days * dayPx, labelEnd) };
  }

  root.EventCore = {
    STATUSES, key, isKey, diffDays, addDays, todayKey, toDate, weekday, validEvent, uid,
    parseLine, parseLines, sameEvent, sortEvents, overlaps, findClashes, group, whenLabel, timeline,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.EventCore;
})(typeof window !== "undefined" ? window : globalThis);
