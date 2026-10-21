// Repeat rules, days and streaks for the To Do widget. Pure functions, no DOM.
// A day is a local "YYYY-MM-DD" key. Nothing is reset at midnight: whether a task is open
// is worked out from its rule and the day it was last done, so days the PC was off just work.
//
// task.repeat: { kind: "none" } | { kind: "daily" } | { kind: "weekdays" }
//            | { kind: "weekly", days: [0-6] }  (0 = Sunday)
//            | { kind: "interval", every: N }   (counted from task.created)
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Noon avoids DST edges when stepping whole days.
  const parse = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); };

  /** Today's key; with dayStart = 4, 01:30 still belongs to the day before. */
  function today(dayStart = 0, now = new Date()) {
    return keyOf(new Date(now.getTime() - dayStart * 3600000));
  }

  function addDays(key, n) {
    const d = parse(key);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }

  const weekday = (key) => parse(key).getDay();
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const kind = (t) => (t.repeat && t.repeat.kind) || "none";
  const repeats = (t) => kind(t) !== "none";

  /** Does the rule ask for this task on this day? One-off tasks are always "due" until done. */
  function isDue(t, key) {
    if (t.created && key < t.created) return false;
    const r = t.repeat || { kind: "none" };
    switch (r.kind) {
      case "daily": return true;
      case "weekdays": { const w = weekday(key); return w >= 1 && w <= 5; }
      case "weekly": {
        const days = r.days && r.days.length ? r.days : [weekday(t.created || key)];
        return days.includes(weekday(key));
      }
      case "interval": {
        const every = Math.max(1, Math.round(r.every || 1));
        const n = daysBetween(t.created || key, key);
        return n >= 0 && n % every === 0;
      }
      default: return true;
    }
  }

  /** The last day before `key` this repeating task was due (null if none since it was created). */
  function prevDue(t, key) {
    for (let i = 1; i <= 400; i++) {
      const k = addDays(key, -i);
      if (t.created && k < t.created) return null;
      if (isDue(t, k)) return k;
    }
    return null;
  }

  /** Mark done on `key`; streaks grow when the previous due day was done too. */
  function complete(t, key) {
    const prev = { doneOn: t.doneOn || null, streak: t.streak || 0 };
    const streak = repeats(t) && t.doneOn && t.doneOn === prevDue(t, key) ? (t.streak || 0) + 1 : 1;
    return { ...t, doneOn: key, streak: repeats(t) ? streak : 0, prev };
  }

  /** Undo today's completion, restoring the streak it had before. */
  function uncomplete(t) {
    const p = t.prev || { doneOn: null, streak: 0 };
    return { ...t, doneOn: p.doneOn, streak: p.streak, prev: null };
  }

  /** The streak as of `key`: still alive if today isn't done yet but the previous due day was. */
  function streakOn(t, key) {
    if (!repeats(t) || !t.doneOn) return 0;
    if (t.doneOn === key || t.doneOn === prevDue(t, key)) return t.streak || 0;
    return 0;
  }

  /**
   * Splits tasks into what to show today. One-off tasks finished on an earlier day are dropped
   * when clearCompleted is on (returned in `expired` so the caller can delete them).
   */
  function plan(tasks, key, clearCompleted = true) {
    const open = [], done = [], later = [], expired = [];
    for (const t of tasks) {
      // Moved to a later day ("tomorrow"): hidden from today, back on its own.
      if (t.day && t.day > key && !t.doneOn) later.push(t);
      else if (!repeats(t)) {
        if (!t.doneOn) open.push(t);
        else if (t.doneOn === key || !clearCompleted) done.push(t);
        else expired.push(t);
      } else if (t.doneOn === key) done.push(t);
      else if (isDue(t, key)) open.push(t);
      else later.push(t);
    }
    return { open, done, later, expired };
  }

  /** "Daily", "Weekdays", "Mon, Thu", "Every 3 days" (empty for one-off tasks). */
  function label(t, weekdayNames) {
    const r = t.repeat || { kind: "none" };
    switch (r.kind) {
      case "daily": return "Daily";
      case "weekdays": return "Weekdays";
      case "weekly": {
        const days = r.days && r.days.length ? r.days : [weekday(t.created)];
        if (days.length === 7) return "Daily";
        // Monday first.
        return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => weekdayNames[d]).join(", ");
      }
      case "interval": {
        const n = Math.max(1, Math.round(r.every || 1));
        return n === 1 ? "Daily" : `Every ${n} days`;
      }
      default: return "";
    }
  }

  const api = { today, addDays, weekday, daysBetween, isDue, prevDue, complete, uncomplete, streakOn, plan, label, repeats };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TodoRepeat = api;
})(typeof window !== "undefined" ? window : globalThis);
