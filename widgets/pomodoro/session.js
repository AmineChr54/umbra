// Focus session rules: pure functions on a plain JSON-able state, no DOM, no timers, the clock is passed in.
// Browser: window.FocusSession. Node: module.exports (tests/widgets/pomodoro.test.mjs).
//
// A session is N wall-clock minutes. With breaks it is split into focus blocks of 22-33 min with exactly 5 min
// breaks between them, so that sum(focus) + 5 * breaks = N. Without breaks (the default) it is one block of N min.
// The state stores the phase list, the current index and either the end time (running) or the time left (paused),
// so it survives a restart: advance(state, now) catches up on phases that ended while Umbra was closed.
// Every change returns a new state plus a list of events ({ type, ... }) that the UI (and later hooks such as the
// timelapse, #240) can react to; the engine itself never logs, notifies or stores anything.
(function (root) {
  "use strict";

  const BREAK = 5, MIN_BLOCK = 22, MAX_BLOCK = 33, MIN_TOTAL = 5, MAX_TOTAL = 600;
  const MS = 60000;

  /** Number of focus blocks for `total` minutes with breaks: the fewest that fit in 22-33 min each. When no count
   *  fits exactly (34-48 min is too short for two blocks, 72-75 falls between two and three), the closest one. */
  function blockCount(total) {
    if (total < 2 * MIN_BLOCK + BREAK) return 1;
    let best = 1, bestDev = Infinity;
    for (let k = 1; k <= Math.ceil(total / MIN_BLOCK); k++) {
      const each = (total - BREAK * (k - 1)) / k;
      if (each >= MIN_BLOCK && each <= MAX_BLOCK) return k;
      const dev = each > MAX_BLOCK ? each - MAX_BLOCK : MIN_BLOCK - each;
      if (dev < bestDev) { best = k; bestDev = dev; }
    }
    return best;
  }

  /** Phase list for a session: [{ kind: "focus" | "break", min }], whole minutes, always starting and ending with focus. */
  function plan(total, breaks) {
    total = clampTotal(total);
    if (!breaks) return [{ kind: "focus", min: total }];
    const k = blockCount(total);
    const focus = total - BREAK * (k - 1);
    const base = Math.floor(focus / k), extra = focus - base * k;
    const out = [];
    for (let i = 0; i < k; i++) {
      if (i) out.push({ kind: "break", min: BREAK });
      out.push({ kind: "focus", min: base + (i < extra ? 1 : 0) }); // the longer blocks come first
    }
    return out;
  }

  const clampTotal = (n) => Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, Math.round(Number(n) || 0)));
  const breakCount = (total, breaks) => plan(total, breaks).filter((p) => p.kind === "break").length;
  const phaseMs = (s, i = s.idx) => s.phases[i].min * MS;

  /** A new session, not started yet. */
  function create(total, breaks) {
    const phases = plan(total, breaks);
    return { v: 1, total: clampTotal(total), breaks: !!breaks, phases, idx: 0, running: false, endsAt: 0, left: phases[0].min * MS, done: false, focused: 0 };
  }

  /** Milliseconds left in the current phase. */
  const remaining = (s, now) => (s.done ? 0 : s.running ? Math.max(0, s.endsAt - now) : s.left);

  /** Which focus period this is and how many there are: { n, of } (the break after focus n reports n too). */
  function focusIndex(s) {
    const of = s.phases.filter((p) => p.kind === "focus").length;
    let n = 0;
    for (let i = 0; i <= Math.min(s.idx, s.phases.length - 1); i++) if (s.phases[i].kind === "focus") n++;
    return { n: Math.max(1, n), of };
  }

  const nextPhase = (s) => (s.done ? null : s.phases[s.idx + 1] || null);
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const valid = (s) => !!s && s.v === 1 && Array.isArray(s.phases) && s.phases.length > 0 && Number.isInteger(s.idx)
    && s.idx >= 0 && s.idx < s.phases.length && s.phases.every((p) => (p.kind === "focus" || p.kind === "break") && p.min > 0);

  function start(s, now) {
    s = clone(s);
    if (s.done || s.running) return { s, events: [] };
    s.running = true; s.endsAt = now + s.left;
    return { s, events: [{ type: "start", idx: s.idx, at: now }] };
  }

  function pause(s, now) {
    s = clone(s);
    if (!s.running) return { s, events: [] };
    s.left = Math.max(0, s.endsAt - now); s.running = false;
    return { s, events: [{ type: "pause", idx: s.idx, at: now }] };
  }

  // Ends the current phase at `at`, having spent `spent` ms of it, and moves on. A finished phase hands over to the
  // next one at its exact end time, so catching up after a restart lands on the right phase and time left.
  function finish(s, at, spent, auto, events) {
    const p = s.phases[s.idx], focusMs = p.kind === "focus" ? Math.max(0, spent) : 0;
    s.focused = (s.focused || 0) + focusMs;
    events.push({ type: "phaseEnd", idx: s.idx, kind: p.kind, focusMs, at });
    if (s.idx + 1 >= s.phases.length) {
      s.done = true; s.running = false; s.left = 0; s.endsAt = 0;
      events.push({ type: "done", at });
      return;
    }
    s.idx++;
    s.left = phaseMs(s);
    s.running = !!auto;
    s.endsAt = auto ? at + s.left : 0;
    events.push({ type: "phaseStart", idx: s.idx, kind: s.phases[s.idx].kind, auto: !!auto, at });
  }

  /** Moves past every phase that has ended by `now`. With `auto` off, the session stops at the start of the next phase. */
  function advance(s, now, auto) {
    s = clone(s);
    const events = [];
    while (s.running && !s.done && now >= s.endsAt) finish(s, s.endsAt, phaseMs(s), auto, events);
    return { s, events };
  }

  /** Ends the current phase now (the "..." menu's Skip). The next phase starts if the session was running or `auto` is on. */
  function skip(s, now, auto) {
    s = advance(s, now, auto).s;
    if (s.done) return { s, events: [] };
    const events = [];
    finish(s, now, phaseMs(s) - remaining(s, now), s.running || auto, events);
    return { s, events };
  }

  /** Adds minutes to the current phase (and so to the session). */
  function extend(s, min, now) {
    s = clone(s);
    if (s.done) return { s, events: [] };
    s.phases[s.idx].min += min; s.total += min;
    if (s.running) s.endsAt += min * MS; else s.left += min * MS;
    return { s, events: [{ type: "extend", idx: s.idx, min, at: now }] };
  }

  /** Stops the session now; reports the focus time spent in the current phase. */
  function end(s, now) {
    s = clone(s);
    if (s.done) return { s, events: [] };
    const p = s.phases[s.idx];
    const spent = p.kind === "focus" ? Math.max(0, phaseMs(s) - remaining(s, now)) : 0;
    s.focused = (s.focused || 0) + spent;
    s.done = true; s.running = false; s.left = 0; s.endsAt = 0;
    return { s, events: [{ type: "phaseEnd", idx: s.idx, kind: p.kind, focusMs: spent, at: now }, { type: "end", at: now }] };
  }

  const api = {
    BREAK, MIN_BLOCK, MAX_BLOCK, MIN_TOTAL, MAX_TOTAL,
    blockCount, plan, breakCount, clampTotal, create, remaining, focusIndex, nextPhase, valid,
    start, pause, advance, skip, extend, end,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FocusSession = api;
})(typeof window !== "undefined" ? window : globalThis);
