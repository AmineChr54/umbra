// Spider solitaire rules on top of cards.js. Pure functions, no DOM: the state is plain JSON and is never mutated,
// every move returns a new state. Browser: window.Spider (needs window.Cards first). Node: module.exports.
//
// Cards: two decks, 104 cards, each with an id 0..103 (id = set * 13 + (rank - 1), set 0..7). Every set of 13 has one
// suit, taken from cards.js: set k has suit k % suits, so 1 suit is eight spade sets, 2 suits is four spade and four
// heart sets, 4 suits is two of each. faceId(state.suits, id) is the matching cards.js id (for labels and colours).
//
// State:  { v, seed, suits, stock, tableau[10], faceDown[10], found, moves, undo }
//   stock      face-down cards, the LAST entries are the top; a deal takes the last 10 (stock is 50, 40 ... 0 long)
//   tableau    ten columns, bottom card first; the first faceDown[i] cards of a column are face down
//   found      completed K..A runs removed from play, each a list of 13 ids (king first); 8 of them wins
//   undo       snapshots of earlier states (without their own undo), oldest first, at most MAX_UNDO
//
// Moves:  { type: "deal" } | { type: "move", from: { index, count }, to: { index } }
(function (root) {
  "use strict";
  const C = typeof module !== "undefined" && module.exports ? require("./cards.js") : root.Cards;

  const VERSION = 1;
  const COLUMNS = 10;
  const SETS = 8;
  const RANKS = 13;
  const CARDS = SETS * RANKS;       // 104
  const DEAL_SIZE = COLUMNS;        // 10 cards per stock deal
  const MAX_UNDO = 250;             // about 0.8 KB each as JSON, so about 200 KB: well inside the 1 MB store
  const SUIT_CHOICES = [1, 2, 4];

  const top = (pile) => (pile.length ? pile[pile.length - 1] : null);
  const snapshot = (s) => { const { undo, ...rest } = s; return rest; };
  const copyBoard = (s) => ({ ...snapshot(s), stock: s.stock.slice(), tableau: s.tableau.map((c) => c.slice()), faceDown: s.faceDown.slice(), found: s.found.slice() });

  const normSuits = (n) => (Number(n) === 4 ? 4 : Number(n) === 2 ? 2 : 1);
  const rankOf = (id) => (id % RANKS) + 1;
  const setOf = (id) => Math.floor(id / RANKS);
  /** cards.js suit (0 spades, 1 hearts, 2 diamonds, 3 clubs) of a spider card in a game with `suits` suits. */
  const suitOf = (suits, id) => setOf(id) % suits;
  /** The cards.js card id (0..51) that spider card `id` looks like. */
  const faceId = (suits, id) => C.card(suitOf(suits, id), rankOf(id));
  const sameSuit = (suits, a, b) => suitOf(suits, a) === suitOf(suits, b);

  /** The ordered double deck [0 .. 103]. */
  const makeDeck = () => Array.from({ length: CARDS }, (_, i) => i);

  /** A new game: the 104 cards shuffled from `seed`, 6 cards in columns 0-3, 5 in columns 4-9 (top face up), 50 in stock. */
  function deal(seed, suits = 1) {
    const deck = C.shuffle(makeDeck(), seed);
    const tableau = [];
    let at = 0;
    for (let i = 0; i < COLUMNS; i++) {
      const n = i < 4 ? 6 : 5;
      tableau.push(deck.slice(at, at + n));
      at += n;
    }
    return {
      v: VERSION, seed, suits: normSuits(suits),
      stock: deck.slice(at), tableau, faceDown: tableau.map((c) => c.length - 1),
      found: [], moves: 0, undo: [],
    };
  }

  /** Can `id` go on a column whose top card is `onto` (null = empty column)? Any suit, one rank higher. */
  const canPlace = (id, onto) => onto === null || onto === undefined || rankOf(id) === rankOf(onto) - 1;

  /** Cards of the run starting at `pos` in column `index` (same suit, descending, face up), or 0 when it is not a run. */
  function movableCount(state, index, pos) {
    const col = state.tableau[index];
    if (!col || !Number.isInteger(pos) || pos < state.faceDown[index] || pos >= col.length) return 0;
    for (let i = pos; i < col.length - 1; i++) {
      if (!sameSuit(state.suits, col[i], col[i + 1]) || rankOf(col[i + 1]) !== rankOf(col[i]) - 1) return 0;
    }
    return col.length - pos;
  }

  const hasEmptyColumn = (state) => state.tableau.some((c) => c.length === 0);

  /** A deal needs a full row in the stock and no empty column. */
  const canDeal = (state) => state.stock.length >= DEAL_SIZE && !hasEmptyColumn(state);

  function isLegalMove(state, move) {
    if (!move) return false;
    if (move.type === "deal") return canDeal(state);
    if (move.type !== "move") return false;
    const { from, to } = move;
    if (!from || !to) return false;
    const col = state.tableau[from.index], dest = state.tableau[to.index];
    if (!col || !dest || from.index === to.index) return false;
    const count = from.count === undefined ? 1 : from.count;
    if (!Number.isInteger(count) || count < 1 || count > col.length) return false;
    if (movableCount(state, from.index, col.length - count) !== count) return false;
    return canPlace(col[col.length - count], top(dest));
  }

  /** Make the top card of a column face up and return how many cards are face down there. */
  const reveal = (faceDown, col) => (col.length === 0 ? 0 : Math.min(faceDown, col.length - 1));

  /** Remove a K..A same-suit run from the end of column `i` if there is one (mutates the working copy). */
  function takeRun(next, i) {
    const col = next.tableau[i];
    if (col.length < RANKS || col.length - RANKS < next.faceDown[i]) return false;
    const start = col.length - RANKS;
    for (let k = 0; k < RANKS; k++) {
      const id = col[start + k];
      if (rankOf(id) !== RANKS - k || !sameSuit(next.suits, id, col[start])) return false;
    }
    next.found.push(col.splice(start, RANKS));
    next.faceDown[i] = reveal(next.faceDown[i], col);
    return true;
  }

  /** The state after `move`, or null when it is illegal. The previous state is pushed on the undo stack. */
  function applyMove(state, move) {
    if (!isLegalMove(state, move)) return null;
    const next = copyBoard(state);
    next.undo = [...state.undo, snapshot(state)].slice(-MAX_UNDO);
    next.moves = state.moves + 1;
    if (move.type === "deal") {
      const row = next.stock.splice(next.stock.length - DEAL_SIZE, DEAL_SIZE);
      for (let i = 0; i < COLUMNS; i++) next.tableau[i].push(row[i]);
      for (let i = 0; i < COLUMNS; i++) takeRun(next, i);
      return next;
    }
    const { from, to } = move;
    const count = from.count === undefined ? 1 : from.count;
    const src = next.tableau[from.index];
    next.tableau[to.index].push(...src.splice(src.length - count, count));
    next.faceDown[from.index] = reveal(next.faceDown[from.index], src);
    takeRun(next, to.index);
    return next;
  }

  const canUndo = (state) => state.undo.length > 0;
  /** The state before the last move (with the rest of the undo stack), or null. */
  function undo(state) {
    if (!state.undo.length) return null;
    const prev = state.undo[state.undo.length - 1];
    return { ...prev, undo: state.undo.slice(0, -1) };
  }

  const isWon = (state) => state.found.length === SETS;

  /** Columns that `count` cards at the end of column `index` could move to, best first (same suit, then occupied, then empty). */
  function targets(state, index, count) {
    const col = state.tableau[index];
    if (!col || movableCount(state, index, col.length - count) !== count) return [];
    const id = col[col.length - count];
    const out = [];
    state.tableau.forEach((dest, j) => {
      if (j === index || !canPlace(id, top(dest))) return;
      const onto = top(dest);
      const rank = onto === null ? 0 : sameSuit(state.suits, id, onto) ? 2 : 1;
      out.push({ to: j, rank });
    });
    return out.sort((a, b) => b.rank - a.rank || a.to - b.to).map((x) => x.to);
  }

  /** Every legal column move as { from: { index, count }, to: { index } }, longest runs first per column. */
  function legalMoves(state) {
    const out = [];
    state.tableau.forEach((col, index) => {
      for (let count = 1; count <= col.length; count++) {
        if (movableCount(state, index, col.length - count) !== count) break;
        for (const to of targets(state, index, count)) out.push({ type: "move", from: { index, count }, to: { index: to } });
      }
    });
    return out;
  }

  /**
   * A reasonable next move for the hint button: the best-scoring column move (completing a run, joining the same suit,
   * uncovering a face-down card), else a deal, else null. Never suggests shuffling a run between equal places.
   */
  function hint(state) {
    let best = null, bestScore = 0;
    for (const m of legalMoves(state)) {
      const { index, count } = m.from, col = state.tableau[index], dest = state.tableau[m.to.index];
      const id = col[col.length - count], onto = top(dest), below = col.length > count ? col[col.length - count - 1] : null;
      const wholeColumn = count === col.length - state.faceDown[index] && state.faceDown[index] === 0;
      let score = 1;
      if (onto === null) { if (wholeColumn) continue; score -= 6; }
      else if (sameSuit(state.suits, id, onto)) score += 40;
      if (col.length - count === state.faceDown[index] && state.faceDown[index] > 0) score += 30; // uncovers a card
      if (below !== null && col.length - count > state.faceDown[index] && sameSuit(state.suits, below, id) && rankOf(below) === rankOf(id) + 1) score -= 45; // splits a chain
      const after = applyMove(state, m);
      if (after.found.length > state.found.length) score += 100;
      score += count; // slight preference for longer runs
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best && bestScore >= 5) return best;
    if (canDeal(state)) return { type: "deal" };
    return best;
  }

  /** Is `s` a well-formed state? Guards a saved game against hand-edited or corrupt data. */
  function isValidState(s, nested = false) {
    const isInt = Number.isInteger;
    try {
      if (!s || typeof s !== "object" || s.v !== VERSION) return false;
      if (!isInt(s.seed) || !SUIT_CHOICES.includes(s.suits) || !isInt(s.moves) || s.moves < 0) return false;
      if (!Array.isArray(s.stock) || s.stock.length % DEAL_SIZE !== 0 || s.stock.length > 50) return false;
      if (!Array.isArray(s.tableau) || s.tableau.length !== COLUMNS || !s.tableau.every(Array.isArray)) return false;
      if (!Array.isArray(s.faceDown) || s.faceDown.length !== COLUMNS) return false;
      if (!Array.isArray(s.found) || s.found.length > SETS || !s.found.every((r) => Array.isArray(r) && r.length === RANKS)) return false;
      for (let i = 0; i < COLUMNS; i++) {
        const fd = s.faceDown[i], n = s.tableau[i].length;
        if (!isInt(fd) || fd < 0 || (n === 0 ? fd !== 0 : fd > n - 1)) return false;
      }
      const seen = new Set();
      for (const id of [...s.stock, ...s.tableau.flat(), ...s.found.flat()]) {
        if (!isInt(id) || id < 0 || id >= CARDS || seen.has(id)) return false;
        seen.add(id);
      }
      if (seen.size !== CARDS) return false;
      if (nested) return true;
      if (!Array.isArray(s.undo) || s.undo.length > MAX_UNDO) return false;
      return s.undo.every((u) => u && typeof u === "object" && !("undo" in u) && isValidState({ ...u, undo: [] }, true));
    } catch {
      return false;
    }
  }

  const api = {
    VERSION, COLUMNS, SETS, RANKS, CARDS, DEAL_SIZE, MAX_UNDO,
    makeDeck, rankOf, setOf, suitOf, faceId, sameSuit, normSuits,
    deal, canPlace, movableCount, canDeal, isLegalMove, applyMove, canUndo, undo, isWon,
    targets, legalMoves, hint, isValidState,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Spider = api;
})(typeof window !== "undefined" ? window : globalThis);
