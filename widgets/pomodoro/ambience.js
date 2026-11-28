// Ambient sound for focus sessions: brown/pink noise, rain, fireplace, a soft drone and vinyl hiss, generated live with Web Audio
// (no files, never repeating). clean() and want() are pure and tested in tests/widgets/pomodoro.test.mjs; engine() plays.
// Browser: window.PomodoroAmbience. Node: module.exports.
//
// Settings (umbra.store "ambient"): { on, focus: { a, av, b, bv }, brk: { a, av, b, bv } }: per phase a sound (a), an optional
// second sound mixed in (b) and their volumes 0..1. brk.a may be null: silence on breaks.
// Random events (drops, crackles) are scheduled ahead on the audio clock, so a throttled page timer never gaps them.
(function (root) {
  "use strict";
  const SOUNDS = [
    { id: "brown", name: "Brown noise" }, { id: "pink", name: "Pink noise" }, { id: "rain", name: "Rain" },
    { id: "fire", name: "Fireplace" }, { id: "drone", name: "Soft drone" }, { id: "vinyl", name: "Vinyl hiss" },
  ];
  const IDS = SOUNDS.map((s) => s.id);
  const LEVEL = 0.4;                         // gain at 100 %: the default 60 % sits near the break chimes' loudness
  const FADE_IN = 5, CROSS = 3, FADE_OUT = 2, PREVIEW = 4; // seconds
  const DEFAULTS = { on: false, focus: { a: "brown", av: 0.6, b: null, bv: 0.4 }, brk: { a: "rain", av: 0.5, b: null, bv: 0.4 } };

  const name = (id) => (SOUNDS.find((s) => s.id === id) || { name: "Silence" }).name;
  const vol = (v, d) => (typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : d);

  /** Stored settings made safe: unknown sounds fall back to the defaults, volumes clamp to 0..1, the mix never repeats the main sound. */
  function clean(p) {
    p = p && typeof p === "object" ? p : {};
    const mix = (x, d, silent) => {
      x = x && typeof x === "object" ? x : {};
      const a = IDS.includes(x.a) ? x.a : silent && x.a === null ? null : d.a;
      const b = a && IDS.includes(x.b) && x.b !== a ? x.b : null;
      return { a, av: vol(x.av, d.av), b, bv: vol(x.bv, d.bv) };
    };
    return { on: p.on === true, focus: mix(p.focus, DEFAULTS.focus, false), brk: mix(p.brk, DEFAULTS.brk, true) };
  }

  /**
   * What should sound now: null for silence, else { phase, layers: [{ id, v }] }. Only while a session runs, the switch is on and
   * the PC isn't locked (away). Breaks play their own sound unless throughBreaks keeps the focus sound going.
   */
  function want(session, prefs, opts = {}) {
    if (!prefs || !prefs.on || opts.away || !session || !session.running || session.done) return null;
    const p = session.phases && session.phases[session.idx];
    if (!p) return null;
    const phase = p.kind === "break" && !opts.throughBreaks ? "brk" : "focus";
    const m = prefs[phase];
    const layers = [m.a && { id: m.a, v: m.av }, m.a && m.b && { id: m.b, v: m.bv }].filter(Boolean);
    return layers.length ? { phase, layers } : null;
  }

  /** Summary line for the setup card. */
  function summary(prefs, throughBreaks) {
    if (!prefs.on) return "Off";
    const both = (m) => (m.a ? name(m.a) + (m.b ? " + " + name(m.b) : "") : "silence");
    return both(prefs.focus) + (throughBreaks ? ", breaks too" : " · break: " + both(prefs.brk).toLowerCase());
  }

  // ---- generators: (ctx, out, noise) -> { nodes, stops } ----
  function scatter(c, minS, maxS, fn) {
    let next = c.currentTime + Math.random() * minS;
    const id = setInterval(() => {
      if (next < c.currentTime) next = c.currentTime + 0.02;
      const end = c.currentTime + 1.6;
      while (next < end) { fn(next); next += minS + Math.random() * (maxS - minS); }
    }, 400);
    return () => clearInterval(id);
  }
  const loop = (c, buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };
  const filt = (c, type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = (c, v) => { const g = c.createGain(); g.gain.value = v; return g; };
  function burst(c, out, N, t, freq, d, amp, type = "bandpass") {
    const s = c.createBufferSource(), f = filt(c, type, freq, 1), g = c.createGain();
    s.buffer = N.white;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.0008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 3); s.stop(t + d + 0.02);
  }
  function blip(c, out, t, f, d, amp, partials = [[1, 1]]) {
    for (const [mul, pa] of partials) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(f * mul, t);
      if (partials.length === 1) o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp * pa, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
    }
  }
  const GEN = {
    brown: (c, out, N) => { const s = loop(c, N.brown); s.connect(filt(c, "lowpass", 900)).connect(gain(c, 0.9)).connect(out); return { nodes: [s], stops: [] }; },
    pink: (c, out, N) => { const s = loop(c, N.pink); s.connect(filt(c, "lowpass", 6000)).connect(gain(c, 0.5)).connect(out); return { nodes: [s], stops: [] }; },
    rain(c, out, N) {
      const a = loop(c, N.pink), b = loop(c, N.brown);
      a.connect(filt(c, "highpass", 500)).connect(filt(c, "lowpass", 7000)).connect(gain(c, 0.45)).connect(out);
      b.connect(filt(c, "lowpass", 400)).connect(gain(c, 0.3)).connect(out);
      const drops = scatter(c, 0.025, 0.14, (t) => { const r = Math.random(); blip(c, out, t, 2500 + r * 3000, 0.03, (0.04 + Math.random() * 0.1) * (r < 0.1 ? 2 : 1)); });
      return { nodes: [a, b], stops: [drops] };
    },
    fire(c, out, N) {
      const a = loop(c, N.brown), g = gain(c, 0.7);
      a.connect(filt(c, "lowpass", 500)).connect(g).connect(out);
      const flutter = scatter(c, 0.18, 0.26, (t) => g.gain.setTargetAtTime(0.45 + Math.random() * 0.4, t, 0.08));
      const crackle = scatter(c, 0.03, 0.26, (t) => { const r = Math.random(); burst(c, out, N, t, 1500 + Math.random() * 4500, 0.004 + Math.random() * 0.025, 0.08 + r * r * 0.55); });
      const pops = scatter(c, 0.9, 3.2, (t) => burst(c, out, N, t, 900, 0.04, 0.6, "lowpass"));
      return { nodes: [a], stops: [flutter, crackle, pops] };
    },
    drone(c, out) {
      const f = filt(c, "lowpass", 900), l = c.createOscillator(), lf = gain(c, 450);
      f.connect(gain(c, 0.9)).connect(out);
      l.frequency.value = 0.05; l.connect(lf).connect(f.frequency); l.start();
      const nodes = [l];
      for (const hz of [146.83, 220, 293.66, 369.99]) for (const cents of [-5, 5]) { // D3 A3 D4 F#4, each as a detuned pair
        const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = hz; o.detune.value = cents;
        o.connect(gain(c, 0.07)).connect(f); o.start(); nodes.push(o);
      }
      return { nodes, stops: [] };
    },
    vinyl(c, out, N) {
      const a = loop(c, N.pink), hum = c.createOscillator();
      a.connect(filt(c, "highpass", 2500)).connect(gain(c, 0.45)).connect(out);
      hum.frequency.value = 50; hum.connect(gain(c, 0.03)).connect(out); hum.start();
      const crack = scatter(c, 0.09, 0.7, (t) => burst(c, out, N, t, 3000 + Math.random() * 3000, 0.003, 0.25 + Math.random() * 0.5, "highpass"));
      const pop = scatter(c, 1.8, 5, (t) => burst(c, out, N, t, 1200, 0.012, 0.8, "lowpass"));
      return { nodes: [a, hum], stops: [crack, pop] };
    },
  };

  function noiseBuffers(c) {
    const make = (color) => {
      const n = c.sampleRate * 4, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (color === "white") d[i] = w * 0.5;
        else if (color === "pink") { // Paul Kellet's filter
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      return b;
    };
    return { white: make("white"), pink: make("pink"), brown: make("brown") };
  }

  /**
   * The player. sync(want) is cheap and idempotent (render calls it every second): it starts, crossfades, re-levels and fades
   * out layers to match, and resolves "playing", "idle", "blocked" (the page may not play audio before a click) or "unsupported".
   * The context is suspended once nothing plays, so an idle audio stream never keeps the PC awake.
   */
  function engine() {
    let ctx = null, N = null, idle = 0, latest = null, resuming = null, preview = null;
    const live = new Map(); // id -> { out, h, v }

    function context() {
      if (ctx) return ctx;
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); N = noiseBuffers(ctx); } catch { ctx = null; }
      return ctx;
    }
    function hold(param, t) {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
    }
    function start(id, g, secs) {
      const c = ctx, out = c.createGain(), t = c.currentTime;
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(g, t + secs);
      out.connect(c.destination);
      return { out, h: GEN[id](c, out, N) };
    }
    function fade(x, secs) {
      const t = ctx.currentTime;
      hold(x.out.gain, t); x.out.gain.setTargetAtTime(0, t, secs / 4);
      setTimeout(() => dispose(x), (secs + 0.3) * 1000);
    }
    function dispose(x) {
      x.h.stops.forEach((f) => f());
      x.h.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
      x.out.disconnect();
    }
    function sleepSoon() {
      clearTimeout(idle);
      idle = setTimeout(() => { if (!live.size && !preview && ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, (FADE_OUT + 1) * 1000);
    }
    function stopPreview(secs = 0.6) { if (preview) { clearTimeout(preview.timer); fade(preview, secs); preview = null; } }
    function apply(layers) {
      const t = ctx.currentTime, fresh = live.size === 0, target = new Map(layers.map((l) => [l.id, l.v]));
      if (layers.length) stopPreview();
      for (const [id, x] of live) if (!target.has(id)) { fade(x, layers.length ? CROSS : FADE_OUT); live.delete(id); }
      for (const [id, v] of target) {
        const g = v * LEVEL, x = live.get(id);
        if (!x) { live.set(id, { ...start(id, g, fresh ? FADE_IN : CROSS), v }); continue; }
        if (x.v !== v) { hold(x.out.gain, t); x.out.gain.setTargetAtTime(g, t, 0.15); x.v = v; }
      }
      if (!live.size) sleepSoon();
    }
    function sync(w) {
      latest = w;
      const layers = w ? w.layers : [];
      if (!layers.length && !live.size) return Promise.resolve("idle");
      const c = context();
      if (!c) return Promise.resolve(layers.length ? "unsupported" : "idle");
      if (c.state === "running") { apply(layers); return Promise.resolve(layers.length ? "playing" : "idle"); }
      if (!layers.length) { live.forEach(dispose); live.clear(); return Promise.resolve("idle"); }
      resuming = resuming || Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]).then(() => { resuming = null; });
      return resuming.then(() => {
        if (c.state !== "running") return "blocked";
        const l = latest ? latest.layers : [];
        apply(l);
        return l.length ? "playing" : "idle";
      });
    }
    /** Inside a press on the widget: lets the sound start later without a click. */
    function unlock() {
      const c = context(); // a fresh context may already be running
      if (!c) return;
      if (c.state === "running") sleepSoon(); // suspended again unless something starts
      else c.resume().then(sleepSoon).catch(() => {});
    }
    /** A short listen while choosing (only when no session sound plays): fades in, plays a few seconds, fades out. */
    function listen(id, v) {
      const c = context();
      if (!c || live.size || !GEN[id]) return;
      stopPreview(0.3);
      const go = () => {
        if (live.size) return;
        stopPreview(0.3);
        const x = start(id, v * LEVEL, 0.4);
        x.timer = setTimeout(() => { if (preview === x) stopPreview(1.2); sleepSoon(); }, PREVIEW * 1000);
        preview = x;
      };
      if (c.state === "running") go(); else c.resume().then(go).catch(() => {});
    }
    return { sync, unlock, listen, playing: () => live.size > 0 };
  }

  const api = { SOUNDS, IDS, DEFAULTS, LEVEL, name, clean, want, summary, engine };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PomodoroAmbience = api;
})(typeof window !== "undefined" ? window : globalThis);
