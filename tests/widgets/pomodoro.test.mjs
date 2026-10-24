import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../../widgets/pomodoro/session.js");

const M = 60000;
const sum = (p) => p.reduce((a, x) => a + x.min, 0);
const focus = (p) => p.filter((x) => x.kind === "focus");

test("240 min with breaks: blocks within 22-33, 5 min breaks, total exactly 240", () => {
  const p = S.plan(240, true);
  assert.equal(sum(p), 240);
  for (const f of focus(p)) assert.ok(f.min >= 22 && f.min <= 33, `block ${f.min}`);
  for (const b of p.filter((x) => x.kind === "break")) assert.equal(b.min, 5);
  assert.equal(focus(p).length, 7);
  assert.equal(S.breakCount(240, true), 6);
});

test("every length sums exactly, alternates focus/break and never ends on a break", () => {
  for (let n = S.MIN_TOTAL; n <= S.MAX_TOTAL; n++) {
    const p = S.plan(n, true);
    assert.equal(sum(p), n, `n=${n}`);
    assert.equal(p[0].kind, "focus");
    assert.equal(p.at(-1).kind, "focus", `n=${n}`);
    p.forEach((x, i) => assert.equal(x.kind, i % 2 ? "break" : "focus"));
    for (const x of p) assert.ok(Number.isInteger(x.min) && x.min > 0);
  }
});

test("blocks stay within 22-33 wherever an exact fit exists", () => {
  const noFit = (n) => n < 49 || (n >= 72 && n <= 75);
  for (let n = 49; n <= S.MAX_TOTAL; n++) {
    if (noFit(n)) continue;
    for (const f of focus(S.plan(n, true))) assert.ok(f.min >= 22 && f.min <= 33, `n=${n} block ${f.min}`);
  }
  // in the 72-75 gap the closest split is used: never more than 2 min outside the range
  for (let n = 72; n <= 75; n++) for (const f of focus(S.plan(n, true))) assert.ok(f.min >= 20 && f.min <= 35, `n=${n}`);
});

test("33 min or less (and anything under 49) is one block; skip breaks is one block", () => {
  for (const n of [5, 22, 33, 34, 48]) assert.deepEqual(S.plan(n, true), [{ kind: "focus", min: n }]);
  assert.deepEqual(S.plan(240, false), [{ kind: "focus", min: 240 }]);
  assert.equal(S.breakCount(240, false), 0);
});

test("run, pause and resume keep the time left", () => {
  let s = S.create(60, true);
  s = S.start(s, 0).s;
  assert.equal(S.remaining(s, 10 * M), s.phases[0].min * M - 10 * M);
  s = S.pause(s, 10 * M).s;
  const left = S.remaining(s, 99 * M);
  assert.equal(left, s.phases[0].min * M - 10 * M);
  s = S.start(s, 100 * M).s;
  assert.equal(S.remaining(s, 100 * M), left);
});

test("restart mid-session: catch-up lands on the right phase and time left (auto)", () => {
  let s = S.create(240, true); // 7 x 30 focus, 6 x 5 break
  s = S.start(s, 0).s;
  const saved = JSON.parse(JSON.stringify(s)); // what umbra.store holds
  const r = S.advance(saved, 77 * M, true); // 30 focus + 5 + 30 focus + 5 = 70, then 7 min into focus 3
  assert.equal(r.s.idx, 4);
  assert.equal(S.focusIndex(r.s).n, 3);
  assert.equal(S.remaining(r.s, 77 * M), 23 * M);
  const credited = r.events.filter((e) => e.type === "phaseEnd").reduce((a, e) => a + e.focusMs, 0);
  assert.equal(credited, 60 * M);
  assert.equal(r.events.at(-1).at, 70 * M);
});

test("without auto start the session waits at the next phase", () => {
  let s = S.start(S.create(60, true), 0).s; // 28 + 5 + 27
  assert.equal(s.phases[0].min, 28);
  const r = S.advance(s, 200 * M, false);
  assert.equal(r.s.idx, 1);
  assert.equal(r.s.running, false);
  assert.equal(S.remaining(r.s, 200 * M), 5 * M);
});

test("the session finishes after the last block", () => {
  const r = S.advance(S.start(S.create(30, false), 0).s, 31 * M, true);
  assert.equal(r.s.done, true);
  assert.equal(S.remaining(r.s, 31 * M), 0);
  assert.deepEqual(r.events.map((e) => e.type), ["phaseEnd", "done"]);
  assert.equal(r.events[0].focusMs, 30 * M);
});

test("skip credits only the time spent; extend adds 5 min; end stops", () => {
  let s = S.start(S.create(60, true), 0).s;
  let r = S.skip(s, 10 * M, true);
  assert.equal(r.events[0].focusMs, 10 * M);
  assert.equal(r.s.idx, 1);
  assert.equal(r.s.running, true);
  s = S.extend(r.s, 5, 10 * M).s;
  assert.equal(S.remaining(s, 10 * M), 10 * M);
  assert.equal(s.total, 65);
  r = S.end(s, 12 * M);
  assert.equal(r.s.done, true);
  assert.equal(r.events[0].focusMs, 0, "a break is not focus time");
});

test("valid rejects old pomodoro state", () => {
  assert.equal(S.valid({ phase: "work", cycle: 0, running: false, total: 1500000 }), false);
  assert.equal(S.valid(S.create(90, true)), true);
});

const T = createRequire(import.meta.url)("../../widgets/pomodoro/timelapse.js");

test("timelapse settings are clamped and stay within 3600 stills", () => {
  assert.deepEqual(T.clean(null), { on: false, interval: 30, length: 30, fps: 30 });
  const c = T.clean({ on: true, interval: 0, length: 9999, fps: 60 });
  assert.equal(c.interval, 1);
  assert.ok(c.length * c.fps <= T.MAX_STILLS);
});

test("timelapse estimate follows the session minutes and the length cap", () => {
  const e = T.estimate({ interval: 30, length: 30, fps: 30 }, 60);
  assert.equal(e.frames, 120);
  assert.equal(e.seconds, 4);
  assert.equal(e.capped, false);
  const c = T.estimate({ interval: 1, length: 5, fps: 10 }, 60);
  assert.equal(c.frames, 50);
  assert.equal(c.capped, true);
});

test("timelapse errors are put in plain words", () => {
  assert.match(T.friendly("The user denied camera access"), /not allowed/);
  assert.match(T.friendly("Camera privacy setting is off"), /Windows is blocking/);
  assert.equal(T.friendly("odd"), "odd");
});
