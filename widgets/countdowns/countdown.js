// Date math for the Countdowns widget. Pure functions, no DOM.
// A day is a local "YYYY-MM-DD" key; a time is "HH:MM" (24 h). Everything is worked out from `now`,
// so nothing needs resetting at midnight and yearly events simply roll over.
//
// event: { title, date: "YYYY-MM-DD", time?: "HH:MM", start?: "YYYY-MM-DD", repeat: "none" | "yearly",
//          period?: "year" | "month" | "week", created?: "YYYY-MM-DD" }
(function (root) {
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isKey = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s));
  const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  // Noon avoids DST edges when stepping whole days.
  function parse(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); }
  /** Local midnight of a day key, plus an optional "HH:MM". */
  function at(key, time) {
    const [y, m, d] = key.split("-").map(Number);
    const [h, min] = isTime(time) ? time.split(":").map(Number) : [0, 0];
    return new Date(y, m - 1, d, h, min);
  }
  const today = (now = new Date()) => keyOf(now);
  function addDays(key, n) { const d = parse(key); d.setDate(d.getDate() + n); return keyOf(d); }
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate(); // m is 0-based

  /** Same month and day in another year; 29 Feb becomes 28 Feb in common years. */
  function inYear(key, year) {
    const [, m, d] = key.split("-").map(Number);
    return `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m - 1)))}`;
  }

  /** Adds whole months to a day key, clamping the day (31 Jan + 1 month = 28/29 Feb). */
  function addMonths(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(y, m - 1 + n, 1, 12);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, daysInMonth(t.getFullYear(), t.getMonth())))}`;
  }

  /** Calendar difference from day `a` to a later day `b`: { years, months, days }. */
  function calendarDiff(a, b) {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    let months = (by - ay) * 12 + (bm - am);
    if (addMonths(a, months) > b) months--;
    const days = daysBetween(addMonths(a, months), b);
    return { years: Math.floor(months / 12), months: months % 12, days };
  }

  /** First day of the current week, month or year, and the first day of the next one. */
  function periodRange(period, todayKey, weekStart = 1) {
    const [y, m] = todayKey.split("-").map(Number);
    if (period === "year") return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
    if (period === "month") { const s = `${y}-${pad(m)}-01`; return { start: s, end: addMonths(s, 1) }; }
    const back = (parse(todayKey).getDay() - weekStart + 7) % 7;
    const s = addDays(todayKey, -back);
    return { start: s, end: addDays(s, 7) };
  }

  /**
   * Where an item stands right now:
   *   start, end   day keys of the progress span (end = the event day, or the day after a period)
   *   target       Date the countdown reaches zero (event day + time, or the end of the period)
   *   days, elapsed  whole days in the span and days already gone (for the dot grid)
   *   pct          0..1 by the clock
   *   dayDiff      days from today to the event day (negative once a one-off event is past)
   */
  function status(ev, now = new Date(), weekStart = 1) {
    const t = today(now);
    let start, end, target;
    if (ev.period) {
      ({ start, end } = periodRange(ev.period, t, weekStart));
      target = at(end);
    } else {
      end = isKey(ev.date) ? ev.date : t;
      if (ev.repeat === "yearly") {
        const year = Number(t.slice(0, 4));
        end = inYear(end, year) >= t ? inYear(end, year) : inYear(end, year + 1);
        start = inYear(end, Number(end.slice(0, 4)) - 1);
      } else {
        start = isKey(ev.start) ? ev.start : isKey(ev.created) ? ev.created : t;
        if (start > end) start = end;
      }
      target = at(end, ev.time);
    }
    const from = at(start);
    const span = target - from;
    const pct = span > 0 ? Math.min(1, Math.max(0, (now - from) / span)) : now >= target ? 1 : 0;
    const days = Math.max(1, daysBetween(start, end));
    const elapsed = Math.min(days, Math.max(0, daysBetween(start, t)));
    return { start, end, target, pct, days, elapsed, today: t, dayDiff: daysBetween(t, end), msLeft: target - now };
  }

  function hm(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  function ymd({ years, months, days }) {
    if (years) return months ? `${years}y ${months}mo` : `${years}y`;
    if (months) return days ? `${months}mo ${days}d` : `${months}mo`;
    return `${days}d`;
  }

  /**
   * Human remaining time: "Today", "Tomorrow", "In 26d", "2mo 13d left", "1y 2mo left",
   * "5h 12m" (time set, under a day away), "Yesterday", "3d ago", "2mo ago".
   */
  function remaining(ev, s) {
    const d = s.dayDiff;
    const timed = !ev.period && isTime(ev.time);
    if (timed && s.msLeft > 0 && s.msLeft < DAY) return hm(s.msLeft);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d === -1) return "Yesterday";
    if (d < 0) {
      const diff = calendarDiff(s.end, s.today);
      return `${diff.years || diff.months ? ymd({ ...diff, days: 0 }) : `${-d}d`} ago`;
    }
    const diff = calendarDiff(s.today, s.end);
    if (!diff.years && !diff.months) return `In ${d}d`;
    return `${ymd(diff)} left`;
  }

  /** What's left of a period: "76d left", "Last day", "5h 12m left". */
  function periodLeft(s) {
    if (s.msLeft < DAY) return `${hm(s.msLeft)} left`;
    const d = daysBetween(s.today, s.end);
    return d === 1 ? "Last day" : `${d}d left`;
  }

  /** Floor, so it never says 100% before the end (or 0% once it has begun). */
  function percent(pct) {
    if (pct >= 1) return 100;
    if (pct <= 0) return 0;
    return Math.min(99, Math.max(1, Math.floor(pct * 100)));
  }

  /**
   * Fits n equal cells into a w x h box, as big as possible: { unit, n, cols, rows, cell }.
   * Falls back from days to weeks (and months) when the cells would be smaller than minCell px.
   */
  function dotGrid(days, w, h, minCell = 4.2, maxCell = 16) {
    const units = [{ unit: "day", size: 1 }, { unit: "week", size: 7 }, { unit: "month", size: 30.44 }];
    let best = null;
    for (const u of units) {
      const n = Math.max(1, Math.ceil(days / u.size));
      best = { unit: u.unit, size: u.size, n, ...fit(n, w, h, maxCell) };
      if (best.cell >= minCell) break;
    }
    return best;
  }

  // Cells are capped at maxCell, so short spans stay on as few rows as possible (a week is one row).
  function fit(n, w, h, maxCell) {
    let best = { cols: n, rows: 1, cell: 0 };
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows);
      const cell = Math.min(w / cols, h / rows, maxCell);
      if (cell > best.cell) best = { cols, rows, cell };
      if (h / rows < best.cell) break; // more rows only shrink cells from here
    }
    return best;
  }

  const api = { keyOf, isKey, isTime, parse, at, today, addDays, addMonths, daysBetween, inYear, calendarDiff,
    periodRange, status, remaining, periodLeft, percent, dotGrid, hm };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Countdown = api;
})(typeof window !== "undefined" ? window : globalThis);
