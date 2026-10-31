// Timelapse helpers for the Pomodoro widget: pure settings/estimate/error rules (no DOM), tested in tests/widgets/pomodoro.test.mjs.
// Browser: window.PomodoroTimelapse. Node: module.exports.
(function (root) {
  "use strict";
  const MAX_STILLS = 3600; // the host's cap per video
  const DEFAULTS = { on: false, interval: 30, length: 30, fps: 30 };
  const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  /** Clean saved settings: interval 1-3600 s, max video length 1-3600 s, fps 1-60, and length * fps within the host's 3600 stills. */
  function clean(t) {
    t = t || {};
    const fps = num(t.fps, 1, 60, DEFAULTS.fps);
    const length = Math.min(num(t.length, 1, 3600, DEFAULTS.length), Math.floor(MAX_STILLS / fps));
    return { on: t.on === true, interval: num(t.interval, 1, 3600, DEFAULTS.interval), length: Math.max(1, length), fps };
  }

  /** What a session of `minutes` will give: photos taken and the resulting video seconds (capped by the chosen length). */
  function estimate(t, minutes) {
    t = clean(t);
    const cap = t.length * t.fps, raw = Math.floor((minutes * 60) / t.interval);
    const frames = Math.max(1, Math.min(cap, raw));
    return { frames, seconds: frames / t.fps, capped: raw > cap };
  }

  /** Plain-words version of a host error. */
  function friendly(msg) {
    const m = String(msg || "");
    if (/click/i.test(m)) return "Click Start on the widget to begin the timelapse.";
    if (/den(y|ied)|not allowed|approv|declin/i.test(m)) return "Camera access was not allowed for this widget. Allow it in Settings > My widgets.";
    if (/privacy|access is off|blocked/i.test(m)) return "Windows is blocking the camera. Turn on Settings > Privacy & security > Camera for desktop apps.";
    if (/no camera|not found|no webcam/i.test(m)) return "No webcam was found.";
    if (/another|already|in use/i.test(m)) return "The camera is already used by another timelapse or app.";
    return m || "The timelapse could not start.";
  }

  /** What the status pill shows for a host state: kind (rec, held, busy, saved, err, idle), text, an optional tooltip and action label. */
  function status(s, { busy = false, error = "", folder = "" } = {}) {
    const st = s && s.state, photos = (n) => `${n} photo${n === 1 ? "" : "s"}`;
    if (st === "recording") return { kind: "rec", text: `Recording · ${photos(s.framesCaptured || 0)}` };
    if (st === "paused") return { kind: "held", text: `Timelapse paused · ${photos(s.framesCaptured || 0)}` };
    if (st === "rendering") return { kind: "busy", text: "Making the video..." };
    if (s && s.file) {
      const where = s.folder || folder, title = `${s.file} in ${where}`;
      // Recording can stop early (disk full, camera lost) and still save what it had.
      return error ? { kind: "err", text: `${error.replace(/\.?$/, ".")} What was recorded is saved in ${where}.`, title } : { kind: "saved", text: `Video saved in ${where}`, title };
    }
    if (error) return { kind: "err", text: error, action: "Try again" };
    if (busy) return { kind: "busy", text: "Starting the camera..." };
    return { kind: "idle", text: "Timelapse not running", action: "Start" };
  }

  const api = { MAX_STILLS, DEFAULTS, clean, estimate, friendly, status };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PomodoroTimelapse = api;
})(typeof window !== "undefined" ? window : globalThis);
