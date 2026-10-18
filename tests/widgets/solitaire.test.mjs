import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Cards = require("../../widgets/solitaire/cards.js");
const K = require("../../widgets/solitaire/klondike.js");

const S = 0, H = 1, D = 2, Cl = 3; // suits
const c = (suit, rank) => Cards.card(suit, rank);
const flat = (s) => [...s.stock, ...s.waste, ...s.foundations.flat(), ...s.tableau.flat()];
const strip = (s) => { const { undo, ...rest } = s; return rest; };
const json = (x) => JSON.parse(JSON.stringify(x));

/** An empty board; tests fill the piles they care about. Not a full deck, so no isValidState on these. */
function board(over = {}) {
  return {
    v: 1, seed: 1, draw: 1, stock: [], waste: [], fan: 0,
    foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], faceDown: [0, 0, 0, 0, 0, 0, 0],
    moves: 0, recycles: 0, undo: [], ...over,
  };
}
const mv = (from, to) => ({ type: "move", from, to });
const fromCol = (index, count = 1) => ({ pile: "tableau", index, count });
const toCol = (index) => ({ pile: "tableau", index });
const toFound = (index) => ({ pile: "foundation", index });

/** Every legal move of a state, for the random player. */
function legalMoves(s) {
  const out = [];
  const m = K.stockMove(s);
  if (m) out.push(m);
  const froms = [];
  if (s.waste.length) froms.push({ pile: "waste" });
  s.foundations.forEach((f, index) => f.length && froms.push({ pile: "foundation", index }));
  s.tableau.forEach((col, index) => { for (let n = 1; n <= col.length; n++) froms.push({ pile: "tableau", index, count: n }); });
  for (const from of froms) {
    for (let i = 0; i < 7; i++) out.push(mv(from, toCol(i)));
    for (let i = 0; i < 4; i++) out.push(mv(from, toFound(i)));
  }
  return out.filter((x) => K.isLegalMove(s, x));
}

// ---------- cards.js ----------

test("a deck has 52 unique cards, 13 per suit, ids round-trip", () => {
  const deck = Cards.makeDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) {
    const id = Cards.card(s, r);
    assert.equal(Cards.suitOf(id), s);
    assert.equal(Cards.rankOf(id), r);
    assert.ok(deck.includes(id));
  }
  assert.throws(() => Cards.card(4, 1));
  assert.throws(() => Cards.card(0, 14));
  assert.throws(() => Cards.rankOf(52));
});

test("labels, names and colours", () => {
  assert.equal(Cards.label(c(S, 1)), "A♠");
  assert.equal(Cards.label(c(H, 10)), "10♥");
  assert.equal(Cards.label(c(Cl, 13)), "K♣");
  assert.equal(Cards.name(c(H, 12)), "queen of hearts");
  assert.equal(Cards.rankLabel(11), "J");
  assert.equal(Cards.colorOf(c(H, 5)), "red");
  assert.equal(Cards.colorOf(c(D, 5)), "red");
  assert.equal(Cards.colorOf(c(S, 5)), "black");
  assert.equal(Cards.colorOf(c(Cl, 5)), "black");
  assert.ok(Cards.sameColor(c(H, 2), c(D, 9)));
  assert.ok(!Cards.sameColor(c(H, 2), c(S, 9)));
  assert.ok(Cards.sameSuit(c(S, 2), c(S, 9)));
  assert.equal(Cards.SUIT_GLYPHS.length, 4);
  assert.equal(Cards.RANK_LABELS.length, 13);
});

test("seeded shuffle is reproducible, differs per seed, keeps all cards and does not touch its input", () => {
  const a = Cards.shuffledDeck(12345), b = Cards.shuffledDeck(12345), other = Cards.shuffledDeck(12346);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, other);
  assert.deepEqual([...a].sort((x, y) => x - y), Cards.makeDeck());
  const input = [3, 1, 2];
  Cards.shuffle(input, 7);
  assert.deepEqual(input, [3, 1, 2]);
  const r1 = Cards.mulberry32(9), r2 = Cards.mulberry32(9);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  const n = Cards.randomSeed(() => 0.5);
  assert.ok(n >= 1 && n <= 999999);
});

// ---------- deal ----------

test("deal layout: columns of 1..7, top face up, 24 in the stock, all 52 cards once", () => {
  const s = K.deal(4242, 1);
  assert.deepEqual(s.tableau.map((x) => x.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(s.faceDown, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(s.stock.length, 24);
  assert.equal(s.waste.length, 0);
  assert.deepEqual(s.foundations, [[], [], [], []]);
  assert.equal(new Set(flat(s)).size, 52);
  assert.ok(K.isValidState(s));
  assert.deepEqual(K.deal(4242, 1), s);
  assert.notDeepEqual(K.deal(4243, 1).tableau, s.tableau);
  assert.equal(K.deal(1, 3).draw, 3);
  assert.equal(K.deal(1, 7).draw, 1);
});

// ---------- legal moves ----------

test("tableau placement: alternating colours, descending, only a king on an empty column", () => {
  assert.ok(K.canPlaceOnTableau(c(H, 6), c(S, 7)));
  assert.ok(K.canPlaceOnTableau(c(Cl, 6), c(D, 7)));
  assert.ok(!K.canPlaceOnTableau(c(D, 6), c(H, 7)), "same colour");
  assert.ok(!K.canPlaceOnTableau(c(H, 5), c(S, 7)), "wrong rank");
  assert.ok(!K.canPlaceOnTableau(c(H, 8), c(S, 7)), "ascending");
  assert.ok(K.canPlaceOnTableau(c(S, 13), null));
  assert.ok(!K.canPlaceOnTableau(c(S, 12), null));
});

test("foundation placement: ace first, then the same suit upwards", () => {
  assert.ok(K.canPlaceOnFoundation(c(S, 1), null));
  assert.ok(!K.canPlaceOnFoundation(c(S, 2), null));
  assert.ok(K.canPlaceOnFoundation(c(S, 2), c(S, 1)));
  assert.ok(!K.canPlaceOnFoundation(c(H, 2), c(S, 1)));
  assert.ok(!K.canPlaceOnFoundation(c(S, 3), c(S, 1)));
});

test("moving a run between columns flips the card that is exposed", () => {
  const s = board({
    tableau: [[c(Cl, 9), c(H, 7), c(S, 6), c(D, 5)], [c(D, 8)], [], [], [], [], []],
    faceDown: [1, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(K.movableCount(s, 0, 0), 0, "face-down card");
  assert.equal(K.movableCount(s, 0, 1), 3);
  assert.ok(K.isLegalMove(s, mv(fromCol(0, 3), toCol(1)))  === false, "7 of hearts is red on a red 8");
  const t = board({
    tableau: [[c(Cl, 9), c(H, 7), c(S, 6), c(D, 5)], [c(Cl, 8)], [], [], [], [], []],
    faceDown: [1, 0, 0, 0, 0, 0, 0],
  });
  const n = K.applyMove(t, mv(fromCol(0, 3), toCol(1)));
  assert.deepEqual(n.tableau[0], [c(Cl, 9)]);
  assert.deepEqual(n.tableau[1], [c(Cl, 8), c(H, 7), c(S, 6), c(D, 5)]);
  assert.deepEqual(n.faceDown, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(n.moves, 1);
  assert.equal(K.applyMove(t, mv(fromCol(0, 4), toCol(1))), null, "includes a face-down card");
  assert.equal(K.applyMove(t, mv(fromCol(0, 1), toCol(0))), null, "same column");
});

test("a run must itself be in sequence", () => {
  const s = board({ tableau: [[c(H, 7), c(S, 6), c(S, 5)], [c(Cl, 8)], [], [], [], [], []] });
  assert.equal(K.movableCount(s, 0, 0), 0);
  assert.equal(K.movableCount(s, 0, 1), 0);
  assert.equal(K.movableCount(s, 0, 2), 1);
  assert.equal(K.applyMove(s, mv(fromCol(0, 3), toCol(1))), null);
});

test("kings go to empty columns, other cards do not", () => {
  const s = board({ tableau: [[c(S, 13), c(H, 12)], [c(D, 12)], [], [], [], [], []] });
  assert.ok(K.isLegalMove(s, mv(fromCol(0, 2), toCol(2))));
  assert.ok(!K.isLegalMove(s, mv(fromCol(1, 1), toCol(2))));
});

test("foundation moves: aces start piles, builds by suit, can come back, runs cannot go up", () => {
  const s = board({
    waste: [c(S, 1)],
    tableau: [[c(S, 2)], [c(H, 1)], [c(H, 5), c(Cl, 4)], [], [], [], []],
  });
  assert.ok(K.isLegalMove(s, mv({ pile: "waste" }, toFound(2))));
  let n = K.applyMove(s, mv({ pile: "waste" }, toFound(2)));
  assert.deepEqual(n.foundations[2], [c(S, 1)]);
  assert.deepEqual(n.waste, []);
  assert.ok(!K.isLegalMove(n, mv(fromCol(1), toFound(2))), "hearts ace on spades pile");
  n = K.applyMove(n, mv(fromCol(0), toFound(2)));
  assert.deepEqual(n.foundations[2], [c(S, 1), c(S, 2)]);
  assert.ok(!K.isLegalMove(s, mv(fromCol(2, 2), toFound(0))), "two cards at once");
  // Taking a card back down from the foundation.
  const back = K.applyMove(n, mv({ pile: "foundation", index: 2 }, toCol(1)));
  assert.equal(back, null, "2 of spades on an ace of hearts is not a tableau move");
  const m = board({ foundations: [[c(S, 1), c(S, 2)], [], [], []], tableau: [[c(H, 3)], [], [], [], [], [], []] });
  const taken = K.applyMove(m, mv({ pile: "foundation", index: 0 }, toCol(0)));
  assert.deepEqual(taken.tableau[0], [c(H, 3), c(S, 2)]);
  assert.deepEqual(taken.foundations[0], [c(S, 1)]);
});

test("autoFoundationMove picks the matching pile, or the first empty one for an ace", () => {
  const s = board({
    foundations: [[], [c(H, 1)], [], []],
    waste: [c(H, 2)],
    tableau: [[c(S, 1)], [c(D, 4)], [], [], [], [], []],
  });
  assert.deepEqual(K.autoFoundationMove(s, { pile: "waste" }), mv({ pile: "waste" }, toFound(1)));
  assert.deepEqual(K.autoFoundationMove(s, { pile: "tableau", index: 0 }), mv(fromCol(0), toFound(0)));
  assert.equal(K.autoFoundationMove(s, { pile: "tableau", index: 1 }), null);
  assert.equal(K.autoFoundationMove(s, { pile: "tableau", index: 2 }), null, "empty column");
  assert.equal(K.autoFoundationMove(s, { pile: "foundation", index: 1 }), null);
});

// ---------- stock, waste, draw-3, recycle ----------

test("draw-1 moves one card; the stock top is the last card", () => {
  const s = K.deal(99, 1);
  const top = s.stock[s.stock.length - 1];
  const n = K.applyMove(s, { type: "draw" });
  assert.equal(n.stock.length, 23);
  assert.deepEqual(n.waste, [top]);
  assert.equal(n.fan, 1);
  assert.equal(n.moves, 1);
});

test("draw-3 turns three cards, the last drawn on top, and fans them", () => {
  const s = K.deal(99, 3);
  const [a, b, d] = [s.stock[23], s.stock[22], s.stock[21]];
  const n = K.applyMove(s, { type: "draw" });
  assert.equal(n.stock.length, 21);
  assert.deepEqual(n.waste, [a, b, d]);
  assert.equal(K.topCard(n.waste), d);
  assert.equal(n.fan, 3);
  // Playing the top card leaves two fanned.
  const m = board({ draw: 3, waste: [c(S, 9), c(H, 3), c(D, 4), c(Cl, 13)], fan: 3, tableau: [[], [], [], [], [], [], []] });
  const out = K.applyMove(m, mv({ pile: "waste" }, toCol(0)));
  assert.equal(out.fan, 2);
  assert.equal(out.waste.length, 3);
});

test("draw-3 near the end of the stock takes what is left", () => {
  const s = board({ draw: 3, stock: [c(S, 1), c(S, 2)] });
  const n = K.applyMove(s, { type: "draw" });
  assert.deepEqual(n.waste, [c(S, 2), c(S, 1)]);
  assert.equal(n.stock.length, 0);
  assert.equal(n.fan, 2);
});

test("recycling the empty stock puts the waste back in its original draw order", () => {
  let s = K.deal(5, 1);
  const original = s.stock.slice();
  assert.equal(K.applyMove(s, { type: "recycle" }), null, "stock not empty");
  for (let i = 0; i < 24; i++) s = K.applyMove(s, K.stockMove(s));
  assert.equal(s.stock.length, 0);
  assert.equal(s.waste.length, 24);
  assert.deepEqual(K.stockMove(s), { type: "recycle" });
  assert.equal(K.applyMove(s, { type: "draw" }), null, "nothing to draw");
  const r = K.applyMove(s, { type: "recycle" });
  assert.deepEqual(r.stock, original);
  assert.deepEqual(r.waste, []);
  assert.equal(r.recycles, 1);
  assert.equal(r.fan, 0);
  assert.equal(K.stockMove(board()), null);
});

test("draw-3 cycles through the whole stock and recycles without losing cards", () => {
  let s = K.deal(5, 3);
  for (let i = 0; i < 8; i++) s = K.applyMove(s, K.stockMove(s));
  assert.equal(s.stock.length, 0);
  s = K.applyMove(s, K.stockMove(s));
  assert.equal(s.stock.length, 24);
  assert.ok(K.isValidState(s));
});

// ---------- undo ----------

test("undo restores the exact previous state, move after move", () => {
  const s0 = K.deal(777, 1);
  const s1 = K.applyMove(s0, { type: "draw" });
  const s2 = K.applyMove(s1, { type: "draw" });
  assert.ok(!K.canUndo(s0));
  assert.equal(K.undo(s0), null);
  assert.deepEqual(K.undo(s2), s1);
  assert.deepEqual(K.undo(K.undo(s2)), s0);
  assert.equal(s0.undo.length, 0, "the old state is never mutated");
  assert.equal(s2.moves, 2);
});

test("a long random game can be undone all the way back to the deal", () => {
  let seed = 1;
  const rnd = Cards.mulberry32(2024);
  for (const draw of [1, 3]) {
    seed++;
    const start = K.deal(seed, draw);
    let s = start, played = 0;
    for (let i = 0; i < 150; i++) {
      const moves = legalMoves(s);
      if (!moves.length) break;
      s = K.applyMove(s, moves[Math.floor(rnd() * moves.length)]);
      assert.ok(s, "a legal move applies");
      played++;
      assert.equal(new Set(flat(s)).size, 52);
      assert.ok(K.isValidState(s));
    }
    assert.ok(played > 20);
    const snapshots = [];
    let u = s;
    while (K.canUndo(u)) { u = K.undo(u); snapshots.push(u); }
    assert.equal(snapshots.length, played);
    assert.deepEqual(u, start);
  }
});

test("the undo stack is bounded and the saved game stays small", () => {
  let s = K.deal(31, 1);
  for (let i = 0; i < K.MAX_UNDO + 120; i++) s = K.applyMove(s, K.stockMove(s));
  assert.equal(s.undo.length, K.MAX_UNDO);
  assert.ok(K.isValidState(s));
  const bytes = Buffer.byteLength(JSON.stringify(s));
  assert.ok(bytes < 200 * 1024, `saved game is ${bytes} bytes`);
  assert.deepEqual(json(s), s, "plain JSON survives a round trip");
});

test("isValidState rejects broken saves", () => {
  const s = K.deal(8, 1);
  assert.ok(K.isValidState(json(s)));
  assert.ok(!K.isValidState(null));
  assert.ok(!K.isValidState({ ...s, v: 2 }));
  assert.ok(!K.isValidState({ ...s, draw: 2 }));
  assert.ok(!K.isValidState({ ...s, stock: s.stock.slice(1) }), "missing card");
  assert.ok(!K.isValidState({ ...s, stock: [...s.stock.slice(1), s.stock[1]] }), "duplicate card");
  assert.ok(!K.isValidState({ ...s, faceDown: [0, 0, 0, 0, 0, 0, 9] }));
  assert.ok(!K.isValidState({ ...s, faceDown: [1, 1, 2, 3, 4, 5, 6] }), "a column cannot be all face down");
  assert.ok(!K.isValidState({ ...s, undo: [{ nope: true }] }));
  assert.ok(!K.isValidState({ ...s, fan: 2 }), "fan larger than the waste");
});

// ---------- win and auto-complete ----------

test("win is detected when the last card reaches a foundation", () => {
  const found = [0, 1, 2, 3].map((suit) => Array.from({ length: suit === 0 ? 12 : 13 }, (_, i) => c(suit, i + 1)));
  const s = board({ foundations: found, tableau: [[c(S, 13)], [], [], [], [], [], []] });
  assert.ok(!K.isWon(s));
  assert.equal(K.foundationCount(s), 51);
  const n = K.applyMove(s, mv(fromCol(0), toFound(0)));
  assert.ok(K.isWon(n));
  assert.equal(K.foundationCount(n), 52);
  assert.ok(K.isValidState(n));
  assert.deepEqual(K.undo(n), s, "undoing the winning move");
  assert.ok(!K.isWon(K.deal(1, 1)));
});

/** Foundations hold A-5 of every suit and each suit's 6-K sits in its own column, all face up. */
function nearlyDone(extra = {}) {
  const foundations = [0, 1, 2, 3].map((suit) => [1, 2, 3, 4, 5].map((r) => c(suit, r)));
  const tableau = [0, 1, 2, 3].map((suit) => Array.from({ length: 8 }, (_, i) => c(suit, 13 - i)));
  return board({ foundations, tableau: [...tableau, [], [], []], ...extra });
}

test("auto-complete plans every remaining card when all cards are face up", () => {
  const s = nearlyDone();
  assert.ok(K.isValidState(s));
  assert.ok(K.canAutoComplete(s));
  const plan = K.autoPlan(s);
  assert.equal(plan.length, 32);
  let g = s;
  for (const m of plan) { g = K.applyMove(g, m); assert.ok(g); }
  assert.ok(K.isWon(g));
  assert.equal(K.autoPlan(g), null, "already won");
});

test("auto-complete also cycles the stock when it has to", () => {
  const base = nearlyDone();
  // The four sixes are not in their columns but in the stock (top = last) and the waste.
  const tableau = base.tableau.map((col, i) => (i < 4 ? col.slice(0, -1) : col));
  const s = { ...base, tableau, stock: [c(S, 6), c(H, 6)], waste: [c(D, 6), c(Cl, 6)], fan: 1 };
  assert.ok(K.isValidState(s));
  const plan = K.autoPlan(s);
  assert.ok(plan);
  assert.ok(plan.some((m) => m.type === "draw" || m.type === "recycle"));
  let g = s;
  for (const m of plan) { g = K.applyMove(g, m); assert.ok(g); }
  assert.ok(K.isWon(g));
});

test("auto-complete is refused while a card is face down or when the position is stuck", () => {
  assert.ok(!K.canAutoComplete(K.deal(3, 1)));
  const stuck = board({
    tableau: [[c(S, 1), c(H, 2)], [c(H, 1), c(S, 2)], [], [], [], [], []],
  });
  assert.equal(K.autoPlan(stuck), null);
  const hidden = nearlyDone({ faceDown: [1, 0, 0, 0, 0, 0, 0] });
  assert.equal(K.autoPlan(hidden), null);
});
