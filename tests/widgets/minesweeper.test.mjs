import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../../widgets/minesweeper/engine.js");

const { HIDDEN, OPEN, FLAG, MARK } = E;
const total = (g) => g.cols * g.rows;
const mineCount = (g) => g.mine.reduce((a, b) => a + b, 0);
// 5x5 with one mine in the top-left corner: a click far away floods almost everything.
const corner = () => E.fromMines(5, 5, [0]);

test("first click is always safe, with its neighbours, over many seeds and sizes", () => {
  for (const [name, d] of Object.entries(E.DIFFICULTIES)) {
    for (let seed = 1; seed <= 300; seed++) {
      const g = E.create(d.cols, d.rows, d.mines);
      const rng = E.mulberry32(seed);
      // vary the first click: corners, edges and random cells
      const first = [0, d.cols - 1, total(g) - 1, total(g) - d.cols, Math.floor(rng() * total(g))][seed % 5];
      assert.ok(E.reveal(g, first, rng), `${name} seed ${seed}`);
      assert.equal(mineCount(g), d.mines, `${name} seed ${seed}: mine count`);
      assert.equal(g.mine[first], 0, `${name} seed ${seed}: clicked cell`);
      for (const j of E.neighbors(g, first)) assert.equal(g.mine[j], 0, `${name} seed ${seed}: neighbour ${j}`);
      assert.equal(g.status === "lost", false);
      assert.equal(g.st[first], OPEN);
      assert.equal(g.adj[first], 0, "a safe neighbourhood means a zero, so the click opens an area");
    }
  }
});

test("the same seed gives the same board, different seeds differ", () => {
  const make = (seed) => { const g = E.createLevel("intermediate"); E.reveal(g, 100, E.mulberry32(seed)); return g.mine.join(""); };
  assert.equal(make(7), make(7));
  assert.notEqual(make(7), make(8));
});

test("a nearly full board still keeps the clicked cell safe", () => {
  const g = E.create(3, 3, 8);
  E.reveal(g, 4, E.mulberry32(1));
  assert.equal(g.mine[4], 0);
  assert.equal(mineCount(g), 8);
  assert.equal(g.status, "won"); // the only safe cell was the click
});

test("adjacent counts match the mines", () => {
  const g = E.fromMines(3, 3, [0, 2]);
  assert.deepEqual(g.adj, [0, 2, 0, 1, 2, 1, 0, 0, 0]);
  assert.equal(g.mines, 2);
});

test("flood fill opens the zero area and its numbered border, not the mine", () => {
  const g = corner();
  assert.ok(E.reveal(g, 24));
  assert.equal(g.status, "won"); // 24 safe cells, all connected through zeros
  assert.equal(g.opened, 24);
  assert.equal(g.st[0], FLAG, "mine is flagged on a win");

  // a mine row splits the board: the flood stops at the numbers
  const h = E.fromMines(5, 5, [10, 11, 12, 13, 14]);
  E.reveal(h, 0);
  assert.equal(h.status, "playing");
  for (let i = 0; i < 5; i++) assert.equal(h.st[i], OPEN);          // row 0 (zeros-and-ones side)
  for (let i = 5; i < 10; i++) assert.equal(h.st[i], OPEN);          // row 1 is the number border
  for (let i = 15; i < 25; i++) assert.equal(h.st[i], HIDDEN);       // other side untouched
  assert.equal(h.adj[5], 2);
});

test("flood fill leaves flags alone", () => {
  const g = corner();
  E.toggleMark(g, 12, false); // flag a safe cell
  E.reveal(g, 24);
  assert.equal(g.st[12], FLAG);
  assert.equal(g.status, "playing");
  E.toggleMark(g, 12, false);
  E.reveal(g, 12);
  assert.equal(g.status, "won");
});

test("flags: toggle, marks cycle, no flagging opened cells, counter", () => {
  const g = E.fromMines(4, 4, [0, 15]);
  assert.equal(E.minesLeft(g), 2);
  assert.ok(E.toggleMark(g, 5, false));
  assert.equal(g.st[5], FLAG);
  assert.equal(E.minesLeft(g), 1);
  E.toggleMark(g, 5, false);
  assert.equal(g.st[5], HIDDEN);
  E.toggleMark(g, 5, true); E.toggleMark(g, 5, true);
  assert.equal(g.st[5], MARK);
  assert.equal(E.minesLeft(g), 2, "a ? is not a flag");
  E.toggleMark(g, 5, true);
  assert.equal(g.st[5], HIDDEN);
  // too many flags makes the counter negative
  for (let i = 1; i <= 4; i++) E.toggleMark(g, i, false);
  assert.equal(E.minesLeft(g), -2);
  // a flagged cell cannot be revealed, a ? can
  assert.equal(E.reveal(g, 1), false);
  E.toggleMark(g, 6, true); E.toggleMark(g, 6, true);
  assert.ok(E.reveal(g, 6));
  assert.equal(g.st[6], OPEN);
  assert.equal(E.toggleMark(g, 6, true), false, "opened cells cannot be flagged");
  // flagging does not start the game
  const h = E.createLevel("beginner");
  E.toggleMark(h, 3, false);
  assert.equal(h.status, "ready");
  assert.equal(h.placed, false);
});

test("clearMarks drops ? only", () => {
  const g = E.fromMines(3, 3, [0]);
  E.toggleMark(g, 1, true); E.toggleMark(g, 1, true);
  E.toggleMark(g, 2, true);
  assert.equal(E.clearMarks(g), 1);
  assert.equal(g.st[1], HIDDEN);
  assert.equal(g.st[2], FLAG);
});

test("chord opens the other neighbours when the flag count matches", () => {
  const g = E.fromMines(3, 3, [0]);
  E.reveal(g, 4);                       // the centre shows 1
  assert.equal(g.st[4], OPEN);
  assert.equal(g.adj[4], 1);
  assert.equal(E.chord(g, 4), false, "no flags yet");
  E.toggleMark(g, 0, false);
  assert.ok(E.chord(g, 4));
  assert.equal(g.status, "won");
  for (let i = 1; i < 9; i++) assert.equal(g.st[i], OPEN);
});

test("chord with a wrong flag hits the mine and loses", () => {
  const g = E.fromMines(3, 3, [0]);
  E.reveal(g, 4);
  E.toggleMark(g, 8, false);            // wrong flag
  assert.ok(E.chord(g, 4));
  assert.equal(g.status, "lost");
  assert.equal(g.exploded, 0);
  assert.equal(E.cellView(g, 0), "boom");
  assert.equal(E.cellView(g, 8), "wrong");
});

test("chord ignores too few or too many flags, closed cells and zeros", () => {
  const g = E.fromMines(4, 4, [0, 1]);
  E.reveal(g, 5);                       // adj 2
  assert.equal(g.adj[5], 2);
  E.toggleMark(g, 0, false);
  assert.equal(E.chord(g, 5), false, "one flag of two");
  E.toggleMark(g, 1, false);
  E.toggleMark(g, 4, false);
  assert.equal(E.chord(g, 5), false, "three flags of two");
  assert.equal(E.chord(g, 10), false, "closed cell");
  E.toggleMark(g, 4, false);
  assert.ok(E.chord(g, 5));
});

test("revealing a mine loses and shows every mine", () => {
  const g = E.fromMines(4, 4, [0, 15]);
  E.reveal(g, 5);
  E.toggleMark(g, 3, false);            // wrong flag on a safe cell
  assert.ok(E.reveal(g, 15));
  assert.equal(g.status, "lost");
  assert.equal(g.exploded, 15);
  assert.equal(E.cellView(g, 15), "boom");
  assert.equal(E.cellView(g, 0), "mine");
  assert.equal(E.cellView(g, 3), "wrong");
  // nothing changes once the game is over
  assert.equal(E.reveal(g, 6), false);
  assert.equal(E.toggleMark(g, 6, false), false);
  assert.equal(E.chord(g, 5), false);
});

test("a correctly flagged mine stays a flag after losing elsewhere", () => {
  const g = E.fromMines(4, 4, [0, 15]);
  E.reveal(g, 5);
  E.toggleMark(g, 0, false);
  E.reveal(g, 15);
  assert.equal(E.cellView(g, 0), "flag");
});

test("winning needs every safe cell, flags the mines and stops input", () => {
  const g = E.fromMines(3, 3, [0, 8]);
  E.reveal(g, 2);
  assert.equal(g.status, "playing");
  const safe = [...Array(9).keys()].filter((i) => !g.mine[i]);
  for (const i of safe) E.reveal(g, i);
  assert.equal(g.status, "won");
  assert.equal(E.minesLeft(g), 0);
  assert.equal(E.cellView(g, 0), "flag");
  assert.equal(E.reveal(g, 0), false);
  assert.equal(E.toggleMark(g, 0, true), false);
});

test("a full random game can be won by solving from the mine map", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = E.createLevel("expert");
    const rng = E.mulberry32(seed);
    E.reveal(g, 0, rng);
    for (let i = 0; i < total(g); i++) if (!g.mine[i]) E.reveal(g, i, rng);
    assert.equal(g.status, "won", `seed ${seed}`);
    assert.equal(g.opened, total(g) - g.mines);
  }
});

test("restore round-trips through JSON and rejects bad data", () => {
  const g = E.createLevel("beginner");
  E.reveal(g, 40, E.mulberry32(3));
  E.toggleMark(g, 0, true);
  const back = E.restore(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(back, g);
  assert.equal(E.restore(null), null);
  assert.equal(E.restore({}), null);
  const bad = JSON.parse(JSON.stringify(g)); bad.st.pop();
  assert.equal(E.restore(bad), null);
  const bad2 = JSON.parse(JSON.stringify(g)); bad2.mines = 3;
  assert.equal(E.restore(bad2), null, "mine count must match");
  const fresh = E.restore(JSON.parse(JSON.stringify(E.createLevel("expert"))));
  assert.equal(fresh.status, "ready");
  assert.equal(fresh.mines, 99);
});

test("create validates its size and clamps the mine count", () => {
  assert.throws(() => E.create(1, 5, 1));
  assert.equal(E.create(3, 3, 99).mines, 8);
  assert.deepEqual(E.createLevel("nope").cols, 9);
});
