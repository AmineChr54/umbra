// Pure date and streak helpers (no DOM), shared by habits.js and testable in node.
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
  /** Today's key; with dayStart = 4, 01:30 still belongs to the day before. */
  const today = (dayStart = 0, now = new Date()) => keyOf(new Date(now.getTime() - dayStart * 3600000));
  /** Monday of the week containing key. */
  const weekStart = (k) => { const d = parse(k); return addDays(k, -((d.getDay() + 6) % 7)); };

  /** target: 7 = every day, 1-6 = that many days a week. done: Set of day keys. */
  function streaks(done, target, todayKey) {
    if (target >= 7) {
      let best = 0, run = 0;
      const days = [...done].sort();
      for (let i = 0; i < days.length; i++) {
        run = i > 0 && addDays(days[i - 1], 1) === days[i] ? run + 1 : 1;
        if (run > best) best = run;
      }
      let cur = 0, k = done.has(todayKey) ? todayKey : addDays(todayKey, -1);
      while (done.has(k)) { cur++; k = addDays(k, -1); }
      return { current: cur, best, unit: "days" };
    }
    // Weekly: a week counts when it holds >= target days. The running week never breaks a streak.
    const perWeek = new Map();
    for (const k of done) { const w = weekStart(k); perWeek.set(w, (perWeek.get(w) || 0) + 1); }
    const met = (w) => (perWeek.get(w) || 0) >= target;
    const weeks = [...perWeek.keys()].filter(met).sort();
    let best = 0, run = 0;
    for (let i = 0; i < weeks.length; i++) {
      run = i > 0 && addDays(weeks[i - 1], 7) === weeks[i] ? run + 1 : 1;
      if (run > best) best = run;
    }
    const thisWeek = weekStart(todayKey);
    let w = met(thisWeek) ? thisWeek : addDays(thisWeek, -7), cur = 0;
    while (met(w)) { cur++; w = addDays(w, -7); }
    return { current: cur, best, unit: "weeks" };
  }

  const api = { keyOf, parse, addDays, today, weekStart, streaks };
  if (typeof module !== "undefined") module.exports = api; else root.Streaks = api;
})(typeof window !== "undefined" ? window : globalThis);
