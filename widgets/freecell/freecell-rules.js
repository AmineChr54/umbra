// FreeCell rules on top of cards.js. Pure functions, no DOM: the state is plain JSON and is never mutated, every
// move returns a new state. Browser: window.FreeCell (needs window.Cards first). Node: module.exports.
//
// State:  { v, seed, cells[4], foundations[4], tableau[8], moves, undo }
//   cells       four single-card parking spots: a card id or null
//   foundations four piles built up by suit from the ace; any empty pile accepts any ace
//   tableau     eight columns, bottom card first, the LAST entry is the one you can play. All cards are face up
//   moves       moves the player made (automatic safe moves do not count)
//   undo        entries { s, auto } holding the board BEFORE a move (without its own undo), oldest first, at most
//               MAX_UNDO. `auto` marks a move made by auto-move, which undo takes back together with the move
//               that triggered it
//
// Move:   { from, to }
//   from  { pile: "cell", index } | { pile: "tableau", index, count }   (count defaults to 1; cards in a
//         foundation never come back)
//   to    { pile: "cell" | "foundation" | "tableau", index }
(function (root) {
  "use strict";
  const C = typeof module !== "undefined" && module.exports ? require("./cards.js") : root.Cards;

  const VERSION = 1;
  const COLUMNS = 8;
  const CELLS = 4;
  const FOUNDATIONS = 4;
  const MAX_UNDO = 200; // about 400 bytes each as JSON, so well inside the 1 MB store
  const MIN_SEED = 1;
  const MAX_SEED = 999999;

  const top = (pile) => (pile.length ? pile[pile.length - 1] : null);
  const inRange = (i, n) => Number.isInteger(i) && i >= 0 && i < n;
  const isSeed = (n) => Number.isInteger(n) && n >= MIN_SEED && n <= MAX_SEED;
  /** The board without its undo stack (a fresh copy, so snapshots never alias a live state). */
  const copyBoard = (s) => ({
    v: s.v, seed: s.seed, cells: s.cells.slice(), foundations: s.foundations.map((p) => p.slice()),
    tableau: s.tableau.map((p) => p.slice()), moves: s.moves,
  });

  /** A new game: the deck shuffled from `seed` and dealt round robin, so columns 1-4 get 7 cards and 5-8 get 6. */
  function deal(seed) {
    if (!isSeed(seed)) throw new RangeError("game number must be " + MIN_SEED + ".." + MAX_SEED + ": " + seed);
    const tableau = Array.from({ length: COLUMNS }, () => []);
    C.shuffledDeck(seed).forEach((id, k) => tableau[k % COLUMNS].push(id));
    return {
      v: VERSION, seed, cells: [null, null, null, null], foundations: [[], [], [], []],
      tableau, moves: 0, undo: [],
    };
  }

  /** Can `id` go on a tableau column whose top card is `onto`? Alternating colour, one rank lower. */
  function canStack(id, onto) {
    return !C.sameColor(id, onto) && C.rankOf(id) === C.rankOf(onto) - 1;
  }

  /** Can `id` go on a foundation whose top card is `onto` (null = empty pile)? */
  function canPlaceOnFoundation(id, onto) {
    if (onto === null || onto === undefined) return C.rankOf(id) === C.ACE;
    return C.sameSuit(id, onto) && C.rankOf(id) === C.rankOf(onto) + 1;
  }

  /** Cards in the run from position `pos` of column `index` to its end, or 0 when that is not a valid run. */
  function runFrom(state, index, pos) {
    const col = state.tableau[index];
    if (!col || !Number.isInteger(pos) || pos < 0 || pos >= col.length) return 0;
    for (let i = pos; i < col.length - 1; i++) if (!canStack(col[i + 1], col[i])) return 0;
    return col.length - pos;
  }

  /** Length of the longest valid run at the end of column `index`. */
  function maxRun(state, index) {
    const col = state.tableau[index];
    if (!col || !col.length) return 0;
    let n = 1;
    while (n < col.length && canStack(col[col.length - n], col[col.length - n - 1])) n++;
    return n;
  }

  const freeCellCount = (state) => state.cells.filter((c) => c === null).length;

  /** Empty columns, not counting column `exclude` (the move's target). */
  const emptyColumns = (state, exclude = -1) => state.tableau.reduce((n, col, i) => n + (i !== exclude && col.length === 0 ? 1 : 0), 0);

  /**
   * Most cards that can move at once onto column `target`: (free cells + 1) * 2^(empty columns excluding the
   * target). Pass no target (or a non-column) to count every empty column.
   */
  function capacity(state, target = -1) {
    return (freeCellCount(state) + 1) * Math.pow(2, emptyColumns(state, target));
  }

  /** The cards a `from` refers to (bottom first), or null when it is not a valid source. */
  function sourceCards(state, from) {
    if (!from) return null;
    if (from.pile === "cell") {
      if (!inRange(from.index, CELLS) || state.cells[from.index] === null) return null;
      return [state.cells[from.index]];
    }
    if (from.pile === "tableau") {
      if (!inRange(from.index, COLUMNS)) return null;
      const col = state.tableau[from.index];
      const count = from.count === undefined ? 1 : from.count;
      if (!Number.isInteger(count) || count < 1 || count > col.length) return null;
      if (runFrom(state, from.index, col.length - count) !== count) return null;
      return col.slice(col.length - count);
    }
    return null;
  }

  /** Is `move` legal in `state`? Never throws, whatever the input. */
  function isLegalMove(state, move) {
    if (!move || !move.from || !move.to) return false;
    const cards = sourceCards(state, move.from);
    if (!cards) return false;
    const from = move.from, to = move.to, first = cards[0];
    if (to.pile === "cell") {
      return cards.length === 1 && from.pile !== "cell" && inRange(to.index, CELLS) && state.cells[to.index] === null;
    }
    if (to.pile === "foundation") {
      return cards.length === 1 && inRange(to.index, FOUNDATIONS) && canPlaceOnFoundation(first, top(state.foundations[to.index]));
    }
    if (to.pile === "tableau") {
      if (!inRange(to.index, COLUMNS)) return false;
      if (from.pile === "tableau" && from.index === to.index) return false;
      if (cards.length > capacity(state, to.index)) return false;
      const col = state.tableau[to.index];
      // Shifting a whole column into an empty one changes nothing.
      if (col.length === 0) return !(from.pile === "tableau" && cards.length === state.tableau[from.index].length);
      return canStack(first, top(col));
    }
    return false;
  }

  /**
   * The state after `move`, or null when it is illegal. `opts.auto` marks a move made by auto-move: it does not
   * count as a player move, and undo takes it back together with the move before it.
   */
  function applyMove(state, move, opts) {
    if (!isLegalMove(state, move)) return null;
    const auto = !!(opts && opts.auto);
    const next = copyBoard(state);
    const { from, to } = move;
    let cards;
    if (from.pile === "cell") { cards = [next.cells[from.index]]; next.cells[from.index] = null; }
    else { const col = next.tableau[from.index], n = from.count === undefined ? 1 : from.count; cards = col.splice(col.length - n, n); }
    if (to.pile === "cell") next.cells[to.index] = cards[0];
    else if (to.pile === "foundation") next.foundations[to.index].push(cards[0]);
    else next.tableau[to.index].push(...cards);
    if (!auto) next.moves++;
    next.undo = state.undo.concat([{ s: copyBoard(state), auto }]).slice(-MAX_UNDO);
    return next;
  }

  const canUndo = (state) => state.undo.length > 0;

  /**
   * The state before the last move (and before the automatic moves that followed it), or null when there is
   * nothing to undo. The restored state equals the one before the move, undo stack included.
   */
  function undo(state) {
    if (!state.undo.length) return null;
    let rest = state.undo, board = null;
    while (rest.length) {
      const entry = rest[rest.length - 1];
      rest = rest.slice(0, -1);
      board = entry.s;
      if (!entry.auto) break;
    }
    return Object.assign(copyBoard(board), { undo: rest });
  }

  const isWon = (state) => state.foundations.every((f) => f.length === C.RANK_COUNT);

  // ---------- foundations and auto-move ----------

  /** Index of the foundation that accepts `id` right now, or -1. An ace takes the first empty pile. */
  function foundationFor(state, id) {
    for (let i = 0; i < FOUNDATIONS; i++) if (canPlaceOnFoundation(id, top(state.foundations[i]))) return i;
    return -1;
  }

  /** A move of the card at `from` (a cell, or the end of a column) to its foundation, or null. */
  function autoFoundationMove(state, from) {
    if (!from) return null;
    const cards = sourceCards(state, { pile: from.pile, index: from.index, count: 1 });
    if (!cards) return null;
    const to = foundationFor(state, cards[0]);
    return to < 0 ? null : { from: { pile: from.pile, index: from.index, count: 1 }, to: { pile: "foundation", index: to } };
  }

  /** Index of the first empty cell, or -1. */
  const firstEmptyCell = (state) => state.cells.indexOf(null);

  /** How many cards of each suit are on the foundations. */
  function homeCounts(state) {
    const n = [0, 0, 0, 0];
    for (const f of state.foundations) if (f.length) n[C.suitOf(f[0])] = f.length;
    return n;
  }

  /**
   * Is it safe to send `id` to a foundation for good? A card is only ever needed on the tableau as a host for a
   * lower card of the other colour. Aces and twos host nobody that matters; any other card is safe once both
   * cards of the other colour one rank below are already home.
   */
  function isSafeToHome(state, id) {
    const r = C.rankOf(id);
    if (r <= 2) return true;
    const n = homeCounts(state);
    const others = C.isRed(id) ? [0, 3] : [1, 2];
    return others.every((suit) => n[suit] >= r - 1);
  }

  /** The next safe move to a foundation (cells first, then columns left to right), or null. */
  function nextAutoMove(state) {
    const sources = [];
    state.cells.forEach((c, index) => { if (c !== null) sources.push({ pile: "cell", index, count: 1 }); });
    state.tableau.forEach((col, index) => { if (col.length) sources.push({ pile: "tableau", index, count: 1 }); });
    for (const from of sources) {
      const cards = sourceCards(state, from);
      const to = foundationFor(state, cards[0]);
      if (to >= 0 && isSafeToHome(state, cards[0])) return { from, to: { pile: "foundation", index: to } };
    }
    return null;
  }

  /** Every safe move that follows from `state`, in order, as a list of moves (empty when none). */
  function autoPlan(state) {
    const plan = [];
    let s = state;
    for (let guard = 0; guard < C.DECK_SIZE; guard++) {
      const move = nextAutoMove(s);
      if (!move) break;
      s = applyMove(s, move, { auto: true });
      plan.push(move);
    }
    return plan;
  }

  // ---------- move listing ----------

  /** Every legal move (for hints and for noticing a lost game). */
  function legalMoves(state, firstOnly = false) {
    const out = [];
    const froms = [];
    state.cells.forEach((c, index) => { if (c !== null) froms.push({ pile: "cell", index }); });
    state.tableau.forEach((col, index) => {
      for (let count = 1; count <= maxRun(state, index); count++) froms.push({ pile: "tableau", index, count });
    });
    for (const from of froms) {
      const tos = [];
      for (let i = 0; i < COLUMNS; i++) tos.push({ pile: "tableau", index: i });
      for (let i = 0; i < FOUNDATIONS; i++) tos.push({ pile: "foundation", index: i });
      for (let i = 0; i < CELLS; i++) tos.push({ pile: "cell", index: i });
      for (const to of tos) {
        const move = { from, to };
        if (isLegalMove(state, move)) { out.push(move); if (firstOnly) return out; }
      }
    }
    return out;
  }

  /** False when no move is possible at all (the game is lost unless it is already won). */
  const hasMoves = (state) => legalMoves(state, true).length > 0;

  // ---------- validation ----------

  function validBoard(b) {
    if (!b || typeof b !== "object" || b.v !== VERSION || !isSeed(b.seed)) return false;
    if (!Number.isInteger(b.moves) || b.moves < 0) return false;
    if (!Array.isArray(b.cells) || b.cells.length !== CELLS) return false;
    if (!Array.isArray(b.foundations) || b.foundations.length !== FOUNDATIONS) return false;
    if (!Array.isArray(b.tableau) || b.tableau.length !== COLUMNS) return false;
    if (!b.foundations.every(Array.isArray) || !b.tableau.every(Array.isArray)) return false;
    const seen = new Set();
    const all = [...b.cells.filter((c) => c !== null), ...b.foundations.flat(), ...b.tableau.flat()];
    for (const id of all) {
      if (!C.isCard(id) || seen.has(id)) return false;
      seen.add(id);
    }
    if (seen.size !== C.DECK_SIZE) return false;
    // A foundation is one suit, ace upward with no gaps.
    return b.foundations.every((f) => f.every((id, i) => C.rankOf(id) === i + 1 && C.suitOf(id) === C.suitOf(f[0])));
  }

  /** Is `state` (say, loaded from the store) a complete, consistent game? */
  function isValidState(state) {
    if (!validBoard(state)) return false;
    if (!Array.isArray(state.undo) || state.undo.length > MAX_UNDO) return false;
    return state.undo.every((e) => e && typeof e === "object" && typeof e.auto === "boolean" && validBoard(e.s));
  }

  const api = {
    VERSION, COLUMNS, CELLS, FOUNDATIONS, MAX_UNDO, MIN_SEED, MAX_SEED,
    isSeed, deal, canStack, canPlaceOnFoundation, runFrom, maxRun, freeCellCount, emptyColumns, capacity,
    sourceCards, isLegalMove, applyMove, canUndo, undo, isWon,
    foundationFor, autoFoundationMove, firstEmptyCell, isSafeToHome, nextAutoMove, autoPlan,
    legalMoves, hasMoves, isValidState,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FreeCell = api;
})(typeof window !== "undefined" ? window : globalThis);
