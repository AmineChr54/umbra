// Break sounds for the Pomodoro widget, synthesized with Web Audio (no sound files). kindFor is pure and tested in
// tests/widgets/pomodoro.test.mjs. Browser: window.PomodoroSounds. Node: module.exports.
//
// "break": a break starts (or the session is done): two soft bell tones falling G5 -> C5. Calm, time to step away.
// "focus": a break ends: three quick rising tones C5 E5 G5, the last one ringing. Back to it.
// Web Audio only plays after the page had a click (Chromium and WebKit autoplay rules): unlock() runs on every press on the
// widget, and play() answers false when it could not sound (a reload with no click since), so the toast keeps its own sound.
// The context is suspended between sounds so an idle audio stream never keeps the PC awake.
(function (root) {
  "use strict";
  const VOLUME = 0.25, RESUME_MS = 300, IDLE_MS = 1000;
  // f: Hz, t: start offset (s), d: length (s), ring: loudness of the octave above (a bell-like shimmer)
  const VOICES = {
    break: [
      { f: 783.99, t: 0, d: 1.4, type: "sine", ring: 0.2 },
      { f: 523.25, t: 0.34, d: 1.9, type: "sine", ring: 0.2 },
    ],
    focus: [
      { f: 523.25, t: 0, d: 0.32, type: "triangle", ring: 0.08 },
      { f: 659.25, t: 0.13, d: 0.32, type: "triangle", ring: 0.08 },
      { f: 783.99, t: 0.26, d: 1.3, type: "triangle", ring: 0.12 },
    ],
  };

  /** Which sound a session event gets: "break" when a break starts or the session is done, "focus" when focus starts again, else null. */
  function kindFor(e, s) {
    if (!e) return null;
    if (e.type === "done") return "break";
    if (e.type !== "phaseStart") return null;
    const kind = e.kind || (s && s.phases && s.phases[e.idx] && s.phases[e.idx].kind);
    return kind === "break" ? "break" : kind === "focus" ? "focus" : null;
  }

  let ctx = null, idle = 0;
  function context() {
    const C = root.AudioContext || root.webkitAudioContext;
    if (!ctx && C) { try { ctx = new C(); } catch { ctx = null; } }
    return ctx;
  }
  function sleepSoon(ms) {
    clearTimeout(idle);
    idle = setTimeout(() => { if (ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, ms);
  }

  /** Call inside a press on the widget: lets later sounds play without a click. */
  function unlock() {
    const c = context();
    if (!c || c.state === "running") return;
    c.resume().then(() => sleepSoon(IDLE_MS)).catch(() => {});
  }

  function tone(c, out, n, t0) {
    const start = t0 + n.t, stop = start + n.d;
    for (const [mul, amp] of [[1, 1], [2, n.ring]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = n.type;
      o.frequency.value = n.f * mul;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(amp, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, stop);
      o.connect(g).connect(out);
      o.start(start);
      o.stop(stop + 0.05);
    }
  }

  /** Plays "break" or "focus". Resolves true when it sounded, false when the page may not play audio yet. */
  async function play(kind) {
    const notes = VOICES[kind], c = context();
    if (!notes || !c) return false;
    if (c.state !== "running") {
      try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, RESUME_MS))]); } catch { /* not allowed yet */ }
    }
    if (c.state !== "running") return false;
    const out = c.createGain();
    out.gain.value = VOLUME;
    out.connect(c.destination);
    const t0 = c.currentTime + 0.03;
    for (const n of notes) tone(c, out, n, t0);
    const len = Math.max(...notes.map((n) => n.t + n.d));
    sleepSoon(len * 1000 + IDLE_MS);
    return true;
  }

  const api = { VOICES, kindFor, unlock, play };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PomodoroSounds = api;
})(typeof window !== "undefined" ? window : globalThis);
