import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Cards = require("../../widgets/spider/cards.js");
const S = require("../../widgets/spider/spider-rules.js");

// A spider card id from its set (0..7) and rank (1..13). The suit of a set is set % suits.
const id = (set, rank) => set * 13 + (rank - 1);
const strip = (s) => { const { undo, ...rest } = s; return rest; };
const json = (x) => JSON.parse(JSON.stringify(x));
const mv = (index, count, to) => ({ type: "move", from: { index, count }, to: { index: to } });
const deal = { type: "deal" };
const allIds = (s) => [...s.stock, ...s.tableau.flat(), ...s.found.flat()];

/** An empty board; tests fill the columns they care about. Not a full deck, so no isValidState on these. */
function board(over = {}) {
  return {
    v: 1, seed: 1, suits: 1, stock: [], tableau: Array.from({ length: 10 }, () => []),
    faceDown: Array(10).fill(0), found: [], moves: 0, undo: [], ...over,
  };
}
/** Columns 0..n as given, the rest empty. */
const cols = (...piles) => piles.concat(Array.from({ length: 10 - piles.length }, () => []));
/** Cards of one set from rank `hi` down to rank `lo`. */
const run = (set, hi, lo) => Array.from({ length: hi - lo + 1 }, (_, i) => id(set, hi - i));

// ---------- deal ----------

test("a deal has 104 unique cards: 54 in ten columns, 50 in the stock, only the top card face up", () => {
  for (const suits of [1, 2, 4]) {
    const s = S.deal(12345, suits);
    assert.equal(S.CARDS, 104);
    assert.equal(allIds(s).length, 104);
    assert.equal(new Set(allIds(s)).size, 104);
    assert.deepEqual(s.tableau.map((c) => c.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    assert.equal(s.tableau.flat().length, 54);
    assert.equal(s.stock.length, 50);
    assert.deepEqual(s.faceDown, [5, 5, 5, 5, 4, 4, 4, 4, 4, 4]);
    assert.deepEqual(s.found, []);
    assert.equal(s.moves, 0);
    assert.ok(S.isValidState(s));
  }
});

test("the same seed deals the same game, another seed another one", () => {
  assert.deepEqual(S.deal(77, 2), S.deal(77, 2));
  assert.notDeepEqual(S.deal(77, 2).tableau, S.deal(78, 2).tableau);
});

test("1, 2 and 4 suit games use that many distinct suits, evenly, 8 cards of every rank", () => {
  for (const suits of [1, 2, 4]) {
    const s = S.deal(9, suits);
    const faces = allIds(s).map((c) => S.faceId(suits, c));
    assert.ok(faces.every((f) => Cards.isCard(f)));
    const bySuit = new Map();
    for (const f of faces) bySuit.set(Cards.suitOf(f), (bySuit.get(Cards.suitOf(f)) ?? 0) + 1);
    assert.equal(bySuit.size, suits);
    for (const n of bySuit.values()) assert.equal(n, 104 / suits);
    for (let r = 1; r <= 13; r++) assert.equal(faces.filter((f) => Cards.rankOf(f) === r).length, 8);
  }
  assert.deepEqual(new Set(S.makeDeck().map((c) => Cards.suitOf(S.faceId(2, c)))), new Set([0, 1]));
  assert.equal(S.normSuits("4"), 4);
  assert.equal(S.normSuits("3"), 1);
  assert.equal(S.normSuits(undefined), 1);
});

// ---------- moves ----------

test("a single card goes on a card one rank higher, of any suit", () => {
  // two suits: set 0 is spades, set 1 is hearts
  const s = board({ suits: 2, tableau: cols([id(0, 9)], [id(1, 10)], [id(0, 9), id(1, 7)], [id(1, 6)]) });
  assert.ok(S.isLegalMove(s, mv(0, 1, 1)), "9 of spades onto 10 of hearts");
  assert.ok(S.isLegalMove(s, mv(3, 1, 2)), "6 onto a 7 of another suit");
  assert.ok(!S.isLegalMove(s, mv(2, 1, 1)), "7 on a 10 is the wrong rank");
  assert.ok(!S.isLegalMove(s, mv(3, 1, 1)), "6 on a 10");
  assert.ok(!S.isLegalMove(s, mv(0, 1, 0)), "onto the same column");
  assert.ok(!S.isLegalMove(s, mv(1, 1, 0)), "10 on a 9 (ascending)");
});

test("only a descending run of one suit moves as a unit; mixed suits move one card at a time", () => {
  // two suits: set 0 is spades, set 1 is hearts
  const spades = [id(0, 9), id(0, 8), id(0, 7), id(0, 6)];
  const s = board({ suits: 2, tableau: cols(spades, [id(1, 9)], [id(1, 9), id(0, 8)], [id(1, 10)]) });
  assert.equal(S.movableCount(s, 0, 0), 4);
  assert.equal(S.movableCount(s, 0, 1), 3);
  assert.equal(S.movableCount(s, 0, 2), 2);
  assert.ok(S.isLegalMove(s, mv(0, 4, 3)), "9 8 7 6 onto the 10 of hearts");
  assert.ok(!S.isLegalMove(s, mv(0, 3, 3)), "8 7 6 on a 10 is the wrong rank");
  assert.ok(S.isLegalMove(s, mv(0, 3, 1)), "8 7 6 of spades onto a 9 of hearts");
  assert.equal(S.movableCount(s, 2, 0), 0, "9 of hearts then 8 of spades is a mixed run");
  assert.ok(!S.isLegalMove(s, mv(2, 2, 3)));
  assert.ok(S.isLegalMove(s, mv(2, 1, 1)), "the 8 of spades alone goes on the other 9");
  const next = S.applyMove(s, mv(0, 4, 3));
  assert.deepEqual(next.tableau[3], [id(1, 10), ...spades]);
  assert.deepEqual(next.tableau[0], []);
});

test("a run with a gap or an ascending step is not a run, and face-down cards never move", () => {
  const s = board({ tableau: cols([id(0, 9), id(0, 7)], [id(0, 5), id(0, 6)], [id(0, 10), id(0, 8)], [id(0, 10)]), faceDown: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(S.movableCount(s, 0, 0), 0, "face down");
  assert.equal(S.movableCount(s, 0, 1), 1);
  assert.equal(S.movableCount(s, 1, 0), 0, "5 then 6 is ascending");
  assert.ok(!S.isLegalMove(s, mv(0, 2, 3)));
  assert.ok(!S.isLegalMove(s, mv(1, 2, 3)));
  assert.ok(!S.isLegalMove(s, mv(2, 1, 3)), "8 on 10");
});

test("any run may move to an empty column, and moving uncovers the next card", () => {
  const s = board({ tableau: cols([id(0, 12), id(0, 5), id(0, 4), id(0, 3)], [], [id(0, 11)]), faceDown: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.ok(S.isLegalMove(s, mv(0, 3, 1)));
  assert.ok(!S.isLegalMove(s, mv(0, 4, 1)), "the king is face down");
  const next = S.applyMove(s, mv(0, 3, 1));
  assert.deepEqual(next.tableau[0], [id(0, 12)]);
  assert.deepEqual(next.tableau[1], [id(0, 5), id(0, 4), id(0, 3)]);
  assert.equal(next.faceDown[0], 0, "the queen is turned over");
  assert.equal(next.faceDown[1], 0);
  assert.equal(next.moves, 1);
  assert.equal(S.applyMove(s, mv(0, 4, 1)), null);
});

// ---------- stock ----------

test("a deal is refused while any column is empty and allowed once every column has a card", () => {
  const s = S.deal(5, 1);
  assert.ok(S.canDeal(s));
  const empty = { ...s, tableau: s.tableau.map((c, i) => (i === 3 ? [] : c)), faceDown: s.faceDown.map((f, i) => (i === 3 ? 0 : f)) };
  assert.ok(!S.canDeal(empty));
  assert.ok(!S.isLegalMove(empty, deal));
  assert.equal(S.applyMove(empty, deal), null);
  const filled = { ...empty, tableau: empty.tableau.map((c, i) => (i === 3 ? [id(0, 1)] : c)) };
  assert.ok(S.canDeal(filled));
});

test("a deal puts one face-up card on every column, takes 10 from the stock, 5 deals empty it", () => {
  let s = S.deal(21, 4);
  const before = s;
  s = S.applyMove(s, deal);
  assert.equal(s.stock.length, 40);
  assert.deepEqual(s.tableau.map((c) => c.length), before.tableau.map((c) => c.length + 1));
  assert.deepEqual(s.faceDown, before.faceDown, "dealt cards are face up");
  s.tableau.forEach((c, i) => assert.equal(c[c.length - 1], before.stock[40 + i]));
  assert.equal(new Set(allIds(s)).size, 104);
  assert.ok(S.isValidState(s));
  for (let n = 0; n < 4; n++) s = S.applyMove(s, deal);
  assert.equal(s.stock.length, 0);
  assert.equal(s.moves, 5);
  assert.ok(!S.canDeal(s) && !S.isLegalMove(s, deal), "nothing left to deal");
});

// ---------- completed runs ----------

test("a K to A run of one suit leaves the board on its own and turns over the card beneath", () => {
  const s = board({
    tableau: cols([id(1, 4), ...run(0, 13, 2)], [id(0, 1)], [id(2, 5), id(2, 6)]),
    faceDown: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  const next = S.applyMove(s, mv(1, 1, 0));
  assert.equal(next.found.length, 1);
  assert.deepEqual(next.found[0], run(0, 13, 1));
  assert.deepEqual(next.tableau[0], [id(1, 4)]);
  assert.equal(next.faceDown[0], 0, "the card below is face up now");
  assert.deepEqual(next.tableau[1], []);
  assert.ok(!S.isWon(next));
});

test("a mixed-suit K to A, or a run that is not complete, stays on the board", () => {
  const mixed = run(0, 13, 2).map((c) => (c === id(0, 8) ? id(1, 8) : c)); // one heart in a row of spades
  const s = board({ suits: 2, tableau: cols(mixed, [id(0, 1)]) });
  const next = S.applyMove(s, mv(1, 1, 0));
  assert.equal(next.found.length, 0);
  assert.equal(next.tableau[0].length, 13);
  const short = board({ tableau: cols(run(0, 12, 2), [id(0, 1)]) });
  assert.equal(S.applyMove(short, mv(1, 1, 0)).found.length, 0);
});

test("a run buried under face-down cards is not removed, and a dealt card can complete one", () => {
  const stock = Array.from({ length: 10 }, (_, i) => id(1, i + 2));
  stock[9] = id(0, 1); // goes on column 9
  const s = board({
    suits: 2, stock,
    tableau: cols([id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], [id(1, 1)], run(0, 13, 2)),
  });
  assert.ok(S.canDeal(s));
  const next = S.applyMove(s, deal);
  assert.equal(next.found.length, 1);
  assert.deepEqual(next.tableau[9], []);
  assert.equal(next.tableau[8].length, 2);
  const hidden = board({ tableau: cols(run(0, 13, 2), [id(0, 1)]), faceDown: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(S.applyMove(hidden, mv(1, 1, 0)).found.length, 0, "the king is face down");
});

// ---------- undo ----------

test("undo returns the exact previous state, move by move, back to the first deal", () => {
  const start = S.deal(31, 1);
  const states = [start];
  let s = start;
  for (let n = 0; n < 60; n++) {
    const m = S.hint(s);
    if (!m) break;
    const next = S.applyMove(s, m);
    assert.ok(next, "hint gave an illegal move");
    states.push(next);
    s = next;
  }
  assert.ok(states.length > 20, "the game played on for a while");
  for (let i = states.length - 1; i > 0; i--) {
    assert.equal(S.canUndo(s), true);
    s = S.undo(s);
    assert.deepEqual(s, states[i - 1]);
  }
  assert.equal(S.canUndo(s), false);
  assert.equal(S.undo(s), null);
  assert.deepEqual(s, start);
});

test("undo undoes a deal and a run removal, and does not mutate the states it was given", () => {
  const s = board({ tableau: cols([id(1, 4), ...run(0, 13, 2)], [id(0, 1)]), faceDown: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const frozen = json(s);
  const next = S.applyMove(s, mv(1, 1, 0));
  assert.deepEqual(json(s), frozen);
  const nextFrozen = json(next);
  const back = S.undo(next);
  assert.deepEqual(json(next), nextFrozen);
  assert.deepEqual(back, s);
  const d = S.deal(2, 2), d2 = S.applyMove(d, deal);
  assert.deepEqual(S.undo(d2), d);
});

test("the undo stack is bounded and the whole saved game stays far below the 1 MB store limit", () => {
  // shuttle a card between an empty column and a 7 many times
  let s = board({ tableau: cols([id(0, 6)], [id(0, 7)]) });
  for (let n = 0; n < 600; n++) s = S.applyMove(s, s.tableau[0].length ? mv(0, 1, 1) : mv(1, 1, 0));
  assert.ok(s.moves > 300);
  assert.equal(s.undo.length, S.MAX_UNDO);
  // a realistic full state: 104 cards and a full undo stack
  let g = S.deal(99, 4);
  g = { ...g, undo: Array.from({ length: S.MAX_UNDO }, () => strip(g)) };
  const bytes = JSON.stringify({ s: g, elapsed: 1e7, counted: true, done: false }).length;
  assert.ok(bytes < 400_000, `saved game is ${bytes} bytes`);
  assert.ok(S.isValidState(g));
});

// ---------- win ----------

test("eight completed runs win the game", () => {
  // seven runs already off, the last K..2 on the board with the ace one column over
  const found = Array.from({ length: 7 }, (_, k) => run(k, 13, 1));
  const s = board({
    suits: 4, found,
    tableau: cols(run(7, 13, 2), [id(7, 1)]),
  });
  assert.ok(S.isValidState(s));
  assert.ok(!S.isWon(s));
  const won = S.applyMove(s, mv(1, 1, 0));
  assert.equal(won.found.length, 8);
  assert.ok(S.isWon(won));
  assert.ok(won.tableau.every((c) => c.length === 0));
  assert.ok(S.isValidState(won));
  assert.ok(!S.isWon(S.undo(won)));
});

test("a one-suit game can be played to the end with hints: valid at every step, never stuck on a legal hint", () => {
  let s = S.deal(4, 1);
  let steps = 0;
  while (steps++ < 4000) {
    const m = S.hint(s);
    if (!m) break;
    const next = S.applyMove(s, m);
    assert.ok(next);
    if (steps % 25 === 0) assert.ok(S.isValidState(next));
    assert.equal(new Set(allIds(next)).size, 104);
    s = next;
    if (S.isWon(s)) break;
    if (s.undo.length > 40) s = { ...s, undo: [] }; // keep the fuzz fast
  }
  assert.ok(steps > 10);
});

// ---------- validation ----------

test("isValidState accepts real states and rejects damaged ones", () => {
  const s = S.applyMove(S.deal(3, 2), deal);
  assert.ok(S.isValidState(s));
  assert.ok(S.isValidState(json(s)), "survives a JSON round trip");
  assert.ok(!S.isValidState(null));
  assert.ok(!S.isValidState({}));
  assert.ok(!S.isValidState({ ...s, v: 2 }));
  assert.ok(!S.isValidState({ ...s, suits: 3 }));
  assert.ok(!S.isValidState({ ...s, moves: -1 }));
  assert.ok(!S.isValidState({ ...s, stock: s.stock.slice(1) }), "stock not a multiple of 10");
  assert.ok(!S.isValidState({ ...s, tableau: s.tableau.slice(1) }));
  assert.ok(!S.isValidState({ ...s, faceDown: s.faceDown.map(() => 99) }));
  assert.ok(!S.isValidState({ ...s, tableau: s.tableau.map((c, i) => (i === 0 ? [...c.slice(1), c[1]] : c)) }), "duplicate card");
  assert.ok(!S.isValidState({ ...s, found: [[1, 2, 3]] }));
  assert.ok(!S.isValidState({ ...s, undo: [{ nonsense: true }] }));
  assert.ok(!S.isValidState({ ...s, undo: "x" }));
});
