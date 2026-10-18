import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Cards = require("../../widgets/freecell/cards.js");
const K = require("../../widgets/freecell/freecell-rules.js");

const S = 0, H = 1, D = 2, Cl = 3; // suits: spades, hearts, diamonds, clubs
const c = (suit, rank) => Cards.card(suit, rank);
const json = (x) => JSON.parse(JSON.stringify(x));
const all = (s) => [...s.cells.filter((x) => x !== null), ...s.foundations.flat(), ...s.tableau.flat()];

/** An empty board; tests fill the piles they care about. Not a full deck, so no isValidState on these. */
function board(over = {}) {
  return {
    v: 1, seed: 1, cells: [null, null, null, null], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], [], []], moves: 0, undo: [], ...over,
  };
}
const fromCol = (index, count = 1) => ({ pile: "tableau", index, count });
const fromCell = (index) => ({ pile: "cell", index });
const toCol = (index) => ({ pile: "tableau", index });
const toCell = (index) => ({ pile: "cell", index });
const toFound = (index) => ({ pile: "foundation", index });
const mv = (from, to) => ({ from, to });

/** A descending, alternating run of `n` cards starting with a king-high red card. */
function run(n, startRank = 13) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(c(i % 2 === 0 ? H : S, startRank - i));
  return out;
}

/** A tiny deterministic random player, for invariants over whole games. */
function randomGame(seed, steps) {
  let s = K.deal(seed);
  const rnd = Cards.mulberry32(seed * 7 + 1);
  const trail = [s];
  for (let i = 0; i < steps; i++) {
    const moves = K.legalMoves(s);
    if (!moves.length) break;
    s = K.applyMove(s, moves[Math.floor(rnd() * moves.length)]);
    trail.push(s);
  }
  return trail;
}

// ---------- deal ----------

test("a deal has 52 unique cards in 8 columns: four of 7 and four of 6", () => {
  const s = K.deal(1234);
  assert.deepEqual(s.tableau.map((col) => col.length), [7, 7, 7, 7, 6, 6, 6, 6]);
  assert.equal(s.cells.length, 4);
  assert.ok(s.cells.every((x) => x === null));
  assert.equal(s.foundations.length, 4);
  assert.ok(s.foundations.every((f) => f.length === 0));
  const cards = all(s);
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards).size, 52);
  assert.ok(cards.every(Cards.isCard));
  assert.equal(s.seed, 1234);
  assert.equal(s.moves, 0);
  assert.deepEqual(s.undo, []);
  assert.ok(K.isValidState(s));
});

test("the same game number always gives the same deal, different numbers differ", () => {
  assert.deepEqual(K.deal(42), K.deal(42));
  assert.notDeepEqual(K.deal(42).tableau, K.deal(43).tableau);
  assert.deepEqual(json(K.deal(999999)), json(K.deal(999999)));
});

test("game numbers outside 1..999999 are rejected", () => {
  for (const bad of [0, -1, 1000000, 1.5, NaN, "12", null, undefined]) assert.throws(() => K.deal(bad), RangeError, String(bad));
  assert.ok(K.isSeed(1) && K.isSeed(999999) && !K.isSeed(0) && !K.isSeed(1000000));
  for (let i = 0; i < 50; i++) assert.ok(K.isSeed(Cards.randomSeed()));
});

// ---------- supermove capacity ----------

test("capacity is (free cells + 1) * 2^(empty columns excluding the target)", () => {
  // 4 free cells, no empty column.
  assert.equal(K.capacity(board({ tableau: Array.from({ length: 8 }, () => [c(S, 5)]) })), 5);
  // Table of free cells x empty columns on a board whose other columns are occupied.
  for (let free = 0; free <= 4; free++) {
    for (let empty = 0; empty <= 7; empty++) {
      const cells = [null, null, null, null].map((_, i) => (i < 4 - free ? c(Cl, i + 1) : null));
      const tableau = Array.from({ length: 8 }, (_, i) => (i < empty ? [] : [c(D, i + 1)]));
      const s = board({ cells, tableau });
      assert.equal(K.freeCellCount(s), free);
      assert.equal(K.emptyColumns(s), empty);
      assert.equal(K.capacity(s), (free + 1) * 2 ** empty, `${free} cells, ${empty} empty`);
      // The target column is not counted, whether it is empty or not.
      if (empty > 0) assert.equal(K.capacity(s, 0), (free + 1) * 2 ** (empty - 1));
      assert.equal(K.capacity(s, 7), (free + 1) * 2 ** empty);
    }
  }
});

test("a run longer than the capacity is refused, one within it is accepted", () => {
  // Two free cells and no empty column: capacity 3. Column 1 ends in a black 10 to build on.
  const cells = [c(Cl, 1), c(Cl, 2), null, null];
  const rest = [[c(D, 1)], [c(D, 2)], [c(D, 3)], [c(D, 4)], [c(D, 5)], [c(D, 6)]];
  const four = board({ cells, tableau: [run(4, 9), [c(S, 10)], ...rest] }); // 9H 8S 7H 6S
  assert.equal(K.capacity(four, 1), 3);
  assert.equal(K.isLegalMove(four, mv(fromCol(0, 4), toCol(1))), false);
  assert.equal(K.applyMove(four, mv(fromCol(0, 4), toCol(1))), null);
  const three = board({ cells, tableau: [run(3, 9), [c(S, 10)], ...rest] }); // 9H 8S 7H
  const moved = K.applyMove(three, mv(fromCol(0, 3), toCol(1)));
  assert.ok(moved);
  assert.deepEqual(moved.tableau[1], [c(S, 10), ...run(3, 9)]);
  assert.deepEqual(moved.tableau[0], []);
});

test("moving to an empty column uses the other empty columns but not the target", () => {
  // Free cells: 1 (so 2 per step). Empty columns: 6 and 7. Moving to column 6: capacity 2 * 2^1 = 4.
  const cells = [c(Cl, 1), c(Cl, 2), c(Cl, 3), null];
  const tableau = [run(5, 12), [c(D, 13)], [c(D, 9)], [c(D, 8)], [c(D, 7)], [c(D, 6)], [], []];
  const s = board({ cells, tableau });
  assert.equal(K.capacity(s, 6), 4);
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 5), toCol(6))), false);
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 4), toCol(6))), true);
  // Onto a non-empty column both empty columns help: capacity 2 * 2^2 = 8.
  assert.equal(K.capacity(s, 1), 8);
  const t = board({ cells, tableau: [run(5, 12), [c(S, 13)], [c(D, 9)], [c(D, 8)], [c(D, 7)], [c(D, 6)], [], []] });
  const onKing = K.applyMove(t, mv(fromCol(0, 5), toCol(1)));
  assert.ok(onKing, "all five cards of the run fit onto the black king");
  assert.equal(onKing.tableau[1].length, 6);
});

test("with no free cell and no empty column only a single card moves", () => {
  const cells = [c(Cl, 1), c(Cl, 2), c(Cl, 3), c(Cl, 4)];
  const tableau = [run(2, 9), [c(S, 10)], [c(D, 1)], [c(D, 2)], [c(D, 3)], [c(D, 4)], [c(D, 5)], [c(D, 6)]];
  const s = board({ cells, tableau });
  assert.equal(K.capacity(s, 1), 1);
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 2), toCol(1))), false);
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 1), toCol(1))), false, "8S does not go on a 10");
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 2), toCol(0))), false);
});

// ---------- legality ----------

test("tableau needs alternating colour and exactly one rank lower", () => {
  const s = board({ tableau: [[c(S, 9)], [c(H, 8)], [c(D, 8)], [c(Cl, 8)], [c(H, 7)], [c(S, 7)], [c(H, 10)], []] });
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toCol(0))), true, "red 8 on black 9");
  assert.equal(K.isLegalMove(s, mv(fromCol(2), toCol(0))), true);
  assert.equal(K.isLegalMove(s, mv(fromCol(3), toCol(0))), false, "black 8 on black 9");
  assert.equal(K.isLegalMove(s, mv(fromCol(4), toCol(0))), false, "7 on 9 skips a rank");
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toCol(1))), false, "going up is not allowed");
  assert.equal(K.isLegalMove(s, mv(fromCol(5), toCol(1))), true, "black 7 on red 8");
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toCol(0))), false, "onto itself");
});

test("any card may go to an empty column, but not a whole column into an empty one", () => {
  const s = board({ tableau: [[c(S, 3)], [c(Cl, 4), c(H, 9), c(Cl, 8)], [], [], [], [], [], []] });
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toCol(2))), false, "a lone card would only change column");
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toCol(2))), true);
  assert.equal(K.isLegalMove(s, mv(fromCol(1, 2), toCol(2))), true, "part of a column");
  assert.equal(K.isLegalMove(s, mv(fromCol(1, 3), toCol(2))), false, "4C 9H 8C is not a run");
});

test("cells hold one card each and only singles park there", () => {
  const s = board({ cells: [c(S, 2), null, null, null], tableau: [run(2, 9), [c(S, 12)], [], [], [], [], [], []] });
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toCell(1))), true);
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toCell(0))), false, "occupied cell");
  assert.equal(K.isLegalMove(s, mv(fromCol(0, 2), toCell(1))), false, "a pair cannot park in one cell");
  assert.equal(K.isLegalMove(s, mv(fromCell(0), toCell(2))), false, "cell to cell is pointless");
  assert.equal(K.isLegalMove(s, mv(fromCell(0), toCol(2))), true, "back to an empty column");
  assert.equal(K.isLegalMove(s, mv(fromCell(1), toCol(2))), false, "empty cell is not a source");
});

test("foundations start at an ace, follow one suit upward and never give cards back", () => {
  const s = board({
    cells: [c(S, 1), c(S, 3), null, null],
    foundations: [[c(H, 1)], [], [], []],
    tableau: [[c(H, 2)], [c(D, 1)], [c(H, 3)], [c(S, 2)], [], [], [], []],
  });
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toFound(0))), true, "2H on AH");
  assert.equal(K.isLegalMove(s, mv(fromCol(2), toFound(0))), false, "3H skips the 2H");
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toFound(0))), false, "AD on the hearts pile");
  assert.equal(K.isLegalMove(s, mv(fromCol(1), toFound(1))), true, "an ace takes any empty pile");
  assert.equal(K.isLegalMove(s, mv(fromCell(0), toFound(2))), true);
  assert.equal(K.isLegalMove(s, mv(fromCol(3), toFound(0))), false, "2S on hearts");
  assert.equal(K.isLegalMove(s, mv({ pile: "foundation", index: 0 }, toCol(4))), false, "no taking cards back");
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toFound(4))), false);
});

test("malformed moves are rejected without throwing", () => {
  const s = K.deal(5);
  const bad = [
    null, undefined, {}, { from: fromCol(0) }, { to: toCol(1) },
    mv(fromCol(8), toCol(0)), mv(fromCol(-1), toCol(0)), mv(fromCol(0, 0), toCol(1)), mv(fromCol(0, 99), toCol(1)),
    mv(fromCol(0, 1.5), toCol(1)), mv(fromCol(0), toCol(8)), mv(fromCol(0), toCell(4)), mv(fromCol(0), toFound(4)),
    mv(fromCell(0), toCol(0)), mv(fromCell(9), toCol(0)), mv({ pile: "waste" }, toCol(0)), mv(fromCol(0), { pile: "stock" }),
    mv(fromCol(0), toCol("1")), mv({ pile: "tableau", index: "0" }, toCol(1)),
  ];
  for (const m of bad) {
    assert.equal(K.isLegalMove(s, m), false, JSON.stringify(m));
    assert.equal(K.applyMove(s, m), null);
  }
});

test("only a valid alternating run can be picked up", () => {
  const s = board({ tableau: [[c(Cl, 4), c(H, 9), c(S, 8), c(D, 3)], [], [], [], [], [], [], []] });
  assert.equal(K.maxRun(s, 0), 1, "3D does not continue 8S");
  assert.equal(K.runFrom(s, 0, 1), 0);
  assert.equal(K.runFrom(s, 0, 3), 1);
  const t = board({ tableau: [[c(Cl, 4), c(H, 9), c(S, 8), c(D, 7)], [], [], [], [], [], [], []] });
  assert.equal(K.maxRun(t, 0), 3);
  assert.equal(K.runFrom(t, 0, 0), 0);
  assert.equal(K.runFrom(t, 0, 1), 3);
  assert.equal(K.sourceCards(t, fromCol(0, 4)), null);
  assert.deepEqual(K.sourceCards(t, fromCol(0, 3)), [c(H, 9), c(S, 8), c(D, 7)]);
  assert.equal(K.maxRun(t, 5), 0);
});

// ---------- applyMove and undo ----------

test("applyMove never mutates its input and counts player moves", () => {
  const s = K.deal(77);
  const before = json(s);
  const m = K.legalMoves(s)[0];
  const next = K.applyMove(s, m);
  assert.deepEqual(json(s), before);
  assert.equal(next.moves, 1);
  assert.equal(next.undo.length, 1);
  assert.equal(all(next).length, 52);
  assert.ok(K.isValidState(next));
});

test("undo restores the previous state exactly, undo stack included", () => {
  for (const seed of [1, 2, 3, 100, 31337]) {
    const trail = randomGame(seed, 120);
    for (let i = trail.length - 1; i > 0; i--) assert.deepEqual(K.undo(trail[i]), trail[i - 1], `seed ${seed} step ${i}`);
    assert.equal(K.undo(trail[0]), null);
    assert.equal(K.canUndo(trail[0]), false);
  }
});

test("undo takes back automatic moves together with the move that caused them", () => {
  const s = board({
    foundations: [[c(S, 1)], [c(H, 1), c(H, 2)], [c(D, 1), c(D, 2)], []],
    tableau: [[c(S, 3), c(Cl, 9)], [c(S, 2)], [c(H, 10)], [], [], [], [], []],
  });
  const afterUser = K.applyMove(s, mv(fromCol(0), toCell(0)));
  const plan = K.autoPlan(afterUser);
  assert.deepEqual(plan.map((m) => m.to.pile), ["foundation", "foundation"], "2S then 3S go home");
  let t = afterUser;
  for (const m of plan) t = K.applyMove(t, m, { auto: true });
  assert.equal(t.moves, 1, "automatic moves are not counted");
  assert.equal(t.undo.length, 3);
  assert.deepEqual(K.undo(t), s);
});

test("the undo stack is bounded", () => {
  let s = K.deal(9);
  for (let i = 0; i < K.MAX_UNDO + 40; i++) {
    const moves = K.legalMoves(s);
    s = K.applyMove(s, moves[i % moves.length]);
    assert.ok(s.undo.length <= K.MAX_UNDO);
  }
  assert.equal(s.undo.length, K.MAX_UNDO);
  assert.ok(K.isValidState(s));
  assert.ok(K.isValidState(json(s)), "survives the store round trip");
});

// ---------- auto-move safety ----------

test("aces and twos go home at once", () => {
  const s = board({
    foundations: [[c(S, 1)], [], [], []],
    tableau: [[c(S, 2)], [c(D, 1)], [c(H, 2)], [], [], [], [], []],
  });
  assert.equal(K.isSafeToHome(s, c(S, 2)), true);
  assert.equal(K.isSafeToHome(s, c(D, 1)), true);
  assert.deepEqual(K.nextAutoMove(s), mv(fromCol(0), toFound(0)));
  assert.equal(K.autoPlan(s).length, 2, "2S and AD; the 2H waits for its ace");
});

test("a card is not sent home while a lower card of the other colour still needs it", () => {
  // 5S can go home (4S is there) but the 4H and 4D are not, and either could be built on the 5S.
  const s = board({
    foundations: [[c(S, 1), c(S, 2), c(S, 3), c(S, 4)], [c(H, 1), c(H, 2), c(H, 3)], [c(D, 1), c(D, 2), c(D, 3)], []],
    tableau: [[c(S, 5)], [c(H, 4)], [c(D, 4)], [], [], [], [], []],
  });
  assert.equal(K.isLegalMove(s, mv(fromCol(0), toFound(0))), true, "legal by the rules");
  assert.equal(K.isSafeToHome(s, c(S, 5)), false);
  // 3S is home but 3C is not, so 4H and 4D must wait as well.
  assert.equal(K.isSafeToHome(s, c(H, 4)), false);
  assert.equal(K.nextAutoMove(s), null);
  assert.deepEqual(K.autoPlan(s), []);
});

test("once both cards of the other colour one rank lower are home, the card is safe", () => {
  const s = board({
    foundations: [[c(S, 1), c(S, 2), c(S, 3), c(S, 4)], [c(H, 1), c(H, 2), c(H, 3), c(H, 4)], [c(D, 1), c(D, 2), c(D, 3), c(D, 4)], []],
    tableau: [[c(S, 5)], [], [], [], [], [], [], []],
  });
  assert.equal(K.isSafeToHome(s, c(S, 5)), true);
  assert.deepEqual(K.nextAutoMove(s).to, toFound(0));
});

test("auto-move chains through cells and columns until nothing is safe", () => {
  const s = board({
    cells: [c(H, 2), null, null, null],
    tableau: [[c(Cl, 9), c(S, 2)], [c(H, 1), c(D, 1)], [c(S, 1)], [], [], [], [], []],
  });
  const plan = K.autoPlan(s);
  let t = s;
  for (const m of plan) t = K.applyMove(t, m, { auto: true });
  assert.equal(t.foundations.flat().length, 5, "AH AD AS 2S 2H");
  assert.deepEqual(t.tableau[0], [c(Cl, 9)]);
  assert.equal(K.nextAutoMove(t), null);
});

test("auto-move over whole random games never strands a card the tableau could still use", () => {
  // Replay random games; after every move, play out the safe plan and check each automatic move was safe at the
  // time: every card of the other colour one rank lower is already on a foundation, so nothing can want it as a base.
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    for (const state of randomGame(seed, 150)) {
      let t = state;
      for (const m of K.autoPlan(state)) {
        const [id] = K.sourceCards(t, m.from);
        const r = Cards.rankOf(id);
        if (r > 2) {
          const home = new Set(t.foundations.flat());
          for (let suit = 0; suit < 4; suit++) {
            if (Cards.isRed(id) !== (suit === H || suit === D)) assert.ok(home.has(c(suit, r - 1)), `seed ${seed}: ${Cards.label(id)} sent home too early`);
          }
        }
        t = K.applyMove(t, m, { auto: true });
        assert.ok(t);
      }
      assert.equal(all(t).length, 52);
    }
  }
});

test("double-click helpers: foundation move and first free cell", () => {
  const s = board({ cells: [c(S, 9), null, c(H, 2), null], foundations: [[c(H, 1)], [], [], []], tableau: [[c(Cl, 4)], [], [], [], [], [], [], []] });
  assert.equal(K.firstEmptyCell(s), 1);
  assert.equal(K.firstEmptyCell(board({ cells: [1, 2, 3, 4] })), -1);
  const m = K.autoFoundationMove(s, fromCell(2));
  assert.deepEqual(m.to, toFound(0));
  assert.equal(K.autoFoundationMove(s, fromCell(0)), null);
  assert.equal(K.autoFoundationMove(s, fromCol(0)), null);
  assert.equal(K.autoFoundationMove(s, fromCell(1)), null);
});

// ---------- win and loss ----------

test("a game is won when all four foundations hold thirteen cards", () => {
  const full = (suit) => Array.from({ length: 13 }, (_, i) => c(suit, i + 1));
  const won = board({ foundations: [full(S), full(H), full(D), full(Cl)] });
  assert.equal(K.isWon(won), true);
  assert.ok(K.isValidState(won));
  assert.equal(K.hasMoves(won), false);
  const almost = board({ foundations: [full(S), full(H), full(D), full(Cl).slice(0, 12)], tableau: [[c(Cl, 13)], [], [], [], [], [], [], []] });
  assert.equal(K.isWon(almost), false);
  assert.ok(K.isValidState(almost));
  const final = K.applyMove(almost, mv(fromCol(0), toFound(3)));
  assert.equal(K.isWon(final), true);
  assert.equal(K.isWon(K.deal(3)), false);
});

test("auto-move can finish a game that is only waiting on foundation moves", () => {
  const full = (suit, n) => Array.from({ length: n }, (_, i) => c(suit, i + 1));
  const s = board({
    foundations: [full(S, 10), full(H, 10), full(D, 10), full(Cl, 10)],
    tableau: [[c(S, 13), c(H, 12), c(Cl, 11)], [c(D, 13), c(S, 12), c(H, 11)], [c(Cl, 13), c(D, 12), c(S, 11)], [c(H, 13), c(Cl, 12), c(D, 11)], [], [], [], []],
  });
  assert.ok(K.isValidState(s));
  let t = s;
  for (const m of K.autoPlan(s)) t = K.applyMove(t, m, { auto: true });
  assert.equal(K.isWon(t), true);
});

test("a position with no legal move is reported", () => {
  // Full cells (two black kings and queens) under eight red tops: nothing stacks, nothing goes home.
  const cells = [c(Cl, 13), c(Cl, 12), c(S, 13), c(S, 12)];
  const tops = [c(D, 4), c(H, 5), c(D, 6), c(H, 7), c(D, 8), c(H, 9), c(D, 10), c(H, 11)];
  const lost = board({ cells, tableau: tops.map((x) => [x]) });
  assert.equal(K.hasMoves(lost), false);
  assert.deepEqual(K.legalMoves(lost), []);
  assert.equal(K.hasMoves(K.deal(8)), true);
});

// ---------- validation ----------

test("isValidState accepts real games and rejects damaged ones", () => {
  const s = K.deal(21);
  assert.ok(K.isValidState(s));
  assert.ok(K.isValidState(json(randomGame(21, 60).at(-1))));
  const dup = json(s); dup.tableau[0][0] = dup.tableau[1][0];
  const short = json(s); short.tableau[0].pop();
  const cell = json(s); cell.cells = [null, null, null];
  const badFound = json(s); badFound.foundations[0] = [c(S, 2)]; badFound.tableau.forEach((col) => { const i = col.indexOf(c(S, 2)); if (i >= 0) col.splice(i, 1); });
  const seed = json(s); seed.seed = 0;
  const moves = json(s); moves.moves = -1;
  const undo = json(s); undo.undo = [{ s: { v: 1 }, auto: false }];
  const undo2 = json(s); undo2.undo = "none";
  const ver = json(s); ver.v = 2;
  const col = json(s); col.tableau.pop();
  for (const [name, x] of Object.entries({ dup, short, cell, badFound, seed, moves, undo, undo2, ver, col })) assert.equal(K.isValidState(x), false, name);
  for (const x of [null, undefined, 0, "x", [], {}]) assert.equal(K.isValidState(x), false);
});
