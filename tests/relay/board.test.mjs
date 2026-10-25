import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, pairCouple, rec, batch, pts, SEC, MIN } from "./harness.mjs";

const line = (n, x0 = 0, y0 = 0) => Array.from({ length: n }, (_, i) => [x0 + i, y0 + (i % 50)]);

test("strokes round-trip between two clients, delta-decodable and tagged with their author", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const start = (await b.sync(0)).rev;

  const drawn = await a.call("stroke", { s: batch(rec(3, 2, [[100, 200], [110, 205], [105, 190]]), rec(0, 0, [[500, 500]])) });
  assert.equal(drawn.ok, true);
  assert.equal(drawn.ids.length, 2);
  assert.equal(drawn.rev, undefined, "write responses carry no rev: clients adopt revs from sync only");

  const got = await b.sync(start);
  assert.equal(got.board.reset, false);
  assert.deepEqual(got.board.strokes, [
    { i: drawn.ids[0], by: "a", c: 3, z: 2, k: 0, p: "100.200.10.5.-5.-15" },
    { i: drawn.ids[1], by: "a", c: 0, z: 0, k: 0, p: "500.500" },
  ]);
  assert.deepEqual(got.board.removed, []);
  assert.equal(got.board.clear, null);

  // b answers; a sees b's stroke (and its own again: clients dedupe by id)
  const reply = await b.call("stroke", { s: rec(7, 5, [[1000, 0], [0, 1000]]) });
  const back = await a.sync(start);
  assert.deepEqual(back.board.strokes.map((s) => [s.i, s.by]), [[drawn.ids[0], "a"], [drawn.ids[1], "a"], [reply.ids[0], "b"]]);
  const onlyNew = await a.sync(got.rev);
  assert.deepEqual(onlyNew.board.strokes.map((s) => s.i), reply.ids);

  // a fresh client gets the whole board
  const fresh = await b.sync(0);
  assert.equal(fresh.board.reset, true);
  assert.equal(fresh.board.strokes.length, 3);
  // and an idle poll after that is tiny
  assert.equal((await r.raw(b.path("sync", { since: fresh.rev }))).text, `{"rev":${fresh.rev}}`);
});

test("the stroke encoding survives URLSearchParams without percent escapes", async () => {
  const s = batch(rec(15, 7, [[1000, 1000], [0, 0], [500, 1000]]), rec(1, 1, [[3, 3]], true));
  assert.equal(new URLSearchParams({ s }).toString(), "s=" + s);
});

test("undo removes the caller's own last stroke only, and the other client hears about it", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const s1 = (await a.call("stroke", { s: rec(1, 1, [[10, 10], [20, 20]]) })).ids[0];
  const s2 = (await a.call("stroke", { s: rec(2, 1, [[30, 30]]) })).ids[0];
  const s3 = (await b.call("stroke", { s: rec(3, 1, [[40, 40]]) })).ids[0];
  const seen = (await b.sync(0)).rev;

  assert.deepEqual(await a.call("undo"), { ok: true, removed: [s2] }, "a's last stroke, not b's newer one");
  const d = await b.sync(seen);
  assert.deepEqual(d.board.removed, [s2]);
  assert.deepEqual(d.board.strokes, []);
  assert.equal(d.board.reset, false);
  assert.deepEqual((await b.sync(0)).board.strokes.map((s) => s.i), [s1, s3]);

  assert.deepEqual(await a.call("undo"), { ok: true, removed: [s1] });
  assert.equal((await a.call("undo")).error, "nothing to undo");
  assert.deepEqual((await b.sync(0)).board.strokes.map((s) => s.i), [s3]);
  assert.deepEqual(await b.call("undo"), { ok: true, removed: [s3] });
  assert.deepEqual((await a.sync(0)).board.strokes, []);
});

test("a stroke split into several records (k) is undone as one", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  const first = await a.call("stroke", { s: batch(rec(4, 3, line(5)), rec(4, 3, line(5, 4), true)) });
  const next = await a.call("stroke", { s: rec(4, 3, line(5, 8), true) }); // continues in a later request
  assert.equal(first.ids.length, 2);
  const all = (await b.sync(0)).board.strokes;
  assert.deepEqual(all.map((s) => s.k), [0, 0, 1, 1]);
  assert.deepEqual(await a.call("undo"), { ok: true, removed: [...first.ids, ...next.ids] });
  assert.equal((await b.sync(0)).board.strokes.length, 1);
});

test("clear records who cleared; unclear within the window brings everything back", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const ids = [
    ...(await a.call("stroke", { s: rec(1, 1, [[1, 1], [2, 2]]) })).ids,
    ...(await b.call("stroke", { s: rec(2, 2, [[3, 3]]) })).ids,
  ];
  const seen = (await b.sync(0)).rev;

  const cleared = await a.call("clear");
  assert.equal(cleared.ok, true);
  assert.equal(cleared.until, r.clock.t + 60 * SEC);
  const d = await b.sync(seen);
  assert.equal(d.board.reset, true);
  assert.deepEqual(d.board.strokes, []);
  assert.deepEqual(d.board.clear, { by: "a", at: r.clock.t, until: r.clock.t + 60 * SEC });
  assert.deepEqual((await a.sync(0)).board.strokes, []);

  // drawing after a clear shows up; unclear restores the old strokes too, in id order
  r.advance(20 * SEC);
  const fresh = (await b.call("stroke", { s: rec(5, 5, [[9, 9]]) })).ids[0];
  assert.deepEqual((await a.sync(0)).board.strokes.map((s) => s.i), [fresh]);
  assert.deepEqual(await b.call("unclear"), { ok: true }, "either side can undo a clear");
  const back = await a.sync(d.rev);
  assert.equal(back.board.reset, true);
  assert.deepEqual(back.board.strokes.map((s) => s.i), [...ids, fresh]);
  assert.equal(back.board.clear, null);
  assert.equal((await b.call("unclear")).error, "nothing to restore");
});

test("unclear is too late after the window, and the strokes stay gone", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  await a.call("clear");
  r.advance(61 * SEC);
  assert.equal((await b.call("unclear")).error, "too late");
  assert.deepEqual((await b.sync(0)).board.strokes, []);
  assert.equal((await b.sync(0)).board.clear, null);
  // a new stroke purges the old ones for good
  await b.call("stroke", { s: rec(2, 2, [[2, 2]]) });
  assert.equal((await a.sync(0)).board.strokes.length, 1);
  assert.equal((await b.call("unclear")).error, "nothing to restore");
});

test("clearing an empty board changes nothing; clearing twice only keeps the latest undoable", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  assert.deepEqual(await a.call("clear"), { ok: true, noop: true });
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  await a.call("clear");
  r.advance(5 * SEC);
  await b.call("stroke", { s: rec(2, 2, [[2, 2]]) });
  await b.call("clear");
  assert.deepEqual((await a.sync(0)).board.strokes, []);
  await a.call("unclear");
  assert.deepEqual((await a.sync(0)).board.strokes.map((s) => [s.by, s.c]), [["b", 2]], "the first clear is final");
});

test("strokes hidden by a clear cannot be undone one by one", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  await a.call("clear");
  assert.equal((await a.call("undo")).error, "nothing to undo");
  await a.call("unclear");
  assert.equal((await a.call("undo")).ok, true);
});

test("stroke validation: indexes, grid, length and shape", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const err = async (s) => (await a.call("stroke", { s })).error;
  assert.equal(await err(""), "no strokes");
  assert.equal(await err("1.1"), "bad stroke");
  assert.equal(await err("a.b.c.d"), "bad stroke");
  assert.equal(await err("1.1.5"), "bad stroke");
  assert.equal(await err("1.1.5.5.3"), "bad stroke", "a dangling delta");
  assert.equal(await err("16.0.5.5"), "bad stroke", "colour index 0..15");
  assert.equal(await err("0.8.5.5"), "bad stroke", "size index 0..7");
  assert.equal(await err("0.0.1001.5"), "bad stroke", "x within 0..1000");
  assert.equal(await err("0.0.5.1001"), "bad stroke");
  assert.equal(await err("0.0.5.5.-6.0"), "bad stroke", "a delta may not leave the grid");
  assert.equal(await err("0.0.995.5.6.0"), "bad stroke");
  assert.equal(await err("0.0.5.5.1.1x"), "bad stroke");
  assert.equal(await err("0.0.5.5_"), "bad stroke");
  assert.equal(await err("0.0.5.5.1.1.1.1.1"), "bad stroke");
  assert.equal(await err("0.0.-5.5"), "bad stroke");
  assert.equal(await err(Array(9).fill("0.0.5.5").join("_")), "too many strokes");
  assert.equal(await err(rec(0, 0, line(601))), "stroke too long");
  assert.equal(await err("0.0.1.1" + ".0.0".repeat(2000)), "too long");
  assert.equal((await a.call("stroke", { s: rec(0, 0, line(600)) })).ok, true, "600 points is the most one record may have");
  assert.equal((await a.call("stroke", { s: Array(8).fill("15.7.0.0.1000.1000").join("_") })).ok, true, "8 records, and a delta that ends exactly on the grid edge");
  assert.equal((await b.sync(0)).board.strokes.length, 9, "nothing from the rejected calls was stored");
  // the whole URL is limited too, and the answer is still 200 JSON
  const huge = await r.raw(a.path("stroke", { s: "0.0.5.5", pad: "x".repeat(6000) }));
  assert.equal(huge.status, 200);
  assert.deepEqual(huge.body, { error: "too long" });
});

test("a near-4KB batch of full-size records is accepted", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const s = batch(...Array.from({ length: 3 }, () => rec(2, 2, line(300))));
  assert.ok(s.length > 2500 && s.length < 4096, String(s.length));
  assert.equal((await a.call("stroke", { s })).ids.length, 3);
  assert.equal((await b.sync(0)).board.strokes.length, 3);
});

test("stroke cap: the oldest strokes are trimmed past 300", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  let last;
  for (let i = 0; i < 330; i += 8) {
    last = await a.call("stroke", { s: batch(...Array.from({ length: Math.min(8, 330 - i) }, (_, j) => rec(i % 16, 0, [[i + j, 1]]))) });
  }
  const board = (await b.sync(0)).board.strokes;
  assert.equal(board.length, 300);
  assert.equal(board.at(-1).i, last.ids.at(-1));
  assert.equal(board[0].p.split(".")[0], "30", "strokes 0..29 are gone");
  const st = r.storageOf("r:" + a.room);
  assert.equal([...st.m.keys()].filter((k) => k.startsWith("s:")).length, 300, "and really deleted from storage");
});

test("point cap: the oldest strokes are trimmed past 20,000 points", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  for (let i = 0; i < 40; i++) await a.call("stroke", { s: rec(1, 1, line(600, 0, i)) }); // 24,000 points
  const strokes = (await b.sync(0)).board.strokes;
  assert.equal(strokes.length, 33);
  assert.ok(strokes.length * 600 <= 20000);
  assert.equal(strokes.at(-1).p.split(".")[1], "39", "the newest survived");
});

test("undoing a stroke that was trimmed away falls through to the next one", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  for (let i = 0; i < 40; i++) await b.call("stroke", { s: batch(...Array(8).fill(rec(2, 2, [[5, 5]]))) }); // b floods: a's stroke is trimmed
  assert.equal((await b.sync(0)).board.strokes.every((s) => s.by === "b"), true);
  assert.equal((await a.call("undo")).error, "nothing to undo");
});

test("a client whose since fell behind the removal log gets a full board", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const old = (await b.sync(0)).rev;
  for (let i = 0; i < 70; i++) { await a.call("stroke", { s: rec(1, 1, [[i, 0]]) }); await a.call("undo"); }
  await a.call("stroke", { s: rec(2, 2, [[999, 999]]) });
  const d = await b.sync(old);
  assert.equal(d.board.reset, true);
  assert.equal(d.board.strokes.length, 1);
  // a recent client still gets the cheap path
  const recent = (await b.sync(0)).rev;
  await a.call("undo");
  assert.equal((await b.sync(recent)).board.reset, false);
});

test("stroke writes are visible to the idle check: a new stroke makes the next sync non-idle", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const { rev } = await b.sync(0);
  await a.call("stroke", { s: rec(1, 1, [[1, 1]]) });
  const d = await b.sync(rev);
  assert.ok(d.rev > rev);
  assert.deepEqual(Object.keys(d).sort(), ["board", "now", "rev"]);
});
