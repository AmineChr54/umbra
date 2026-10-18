// Klondike rules on top of cards.js. Pure functions, no DOM: the state is plain JSON and is never mutated, every
// move returns a new state. Browser: window.Klondike (needs window.Cards first). Node: module.exports.
//
// State:  { v, seed, draw, stock, waste, fan, foundations[4], tableau[7], faceDown[7], moves, recycles, undo }
//   stock       face-down cards, the LAST entry is the top (the next card drawn)
//   waste       face-up cards, the LAST entry is the top (the only playable one)
//   fan         how many top waste cards the UI shows fanned out (draw-3); 0 when the waste is empty
//   foundations four piles built up by suit from the ace; any empty pile accepts any ace
//   tableau     seven columns, bottom card first; the first faceDown[i] cards of a column are face down
//   undo        snapshots of earlier states (without their own undo), oldest first, at most MAX_UNDO
//
// Moves:  { type: "draw" } | { type: "recycle" } | { type: "move", from, to }
//   from  { pile: "waste" } | { pile: "foundation", index } | { pile: "tableau", index, count }  (count defaults to 1)
//   to    { pile: "tableau" | "foundation", index }
(function (root) {
  "use strict";
  const C = typeof module !== "undefined" && module.exports ? require("./cards.js") : root.Cards;

  const VERSION = 1;
  const COLUMNS = 7;
  const FOUNDATIONS = 4;
  const MAX_UNDO = 200; // about 350 bytes each as JSON, so well inside the 1 MB store

  const sum = (piles) => piles.reduce((n, p) => n + p.length, 0);
  const top = (pile) => (pile.length ? pile[pile.length - 1] : null);
  const snapshot = (s) => { const { undo, ...rest } = s; return rest; };

  /** A new game: the deck shuffled from `seed`, 1..7 cards per column (top one face up), 24 in the stock. */
  function deal(seed, draw = 1) {
    const deck = C.shuffledDeck(seed);
    const tableau = [];
    let at = 0;
    for (let i = 0; i < COLUMNS; i++) { tableau.push(deck.slice(at, at + i + 1)); at += i + 1; }
    return {
      v: VERSION, seed, draw: draw === 3 ? 3 : 1,
      stock: deck.slice(at), waste: [], fan: 0,
      foundations: [[], [], [], []],
      tableau, faceDown: Array.from({ length: COLUMNS }, (_, i) => i),
      moves: 0, recycles: 0, undo: [],
    };
  }

  /** Can `id` go on a tableau column whose top card is `onto` (null = empty column)? */
  function canPlaceOnTableau(id, onto) {
    if (onto === null || onto === undefined) return C.rankOf(id) === C.KING;
    return !C.sameColor(id, onto) && C.rankOf(id) === C.rankOf(onto) - 1;
  }

  /** Can `id` go on a foundation whose top card is `onto` (null = empty pile)? */
  function canPlaceOnFoundation(id, onto) {
    if (onto === null || onto === undefined) return C.rankOf(id) === C.ACE;
    return C.sameSuit(id, onto) && C.rankOf(id) === C.rankOf(onto) + 1;
  }

  /** Cards of the run starting at position `pos` of column `index`, or 0 when it is face down or not a valid run. */
  function movableCount(state, index, pos) {
    const col = state.tableau[index];
    if (!col || !Number.isInteger(pos) || pos < state.faceDown[index] || pos >= col.length) return 0;
    for (let i = pos; i < col.length - 1; i++) if (!canPlaceOnTableau(col[i + 1], col[i])) return 0;
    return col.length - pos;
  }

  /** The cards a `from` refers to (bottom first), or null when it is not a valid source. */
  function sourceCards(state, from) {
    if (!from) return null;
    if (from.pile === "waste") return state.waste.length ? [top(state.waste)] : null;
    if (from.pile === "foundation") {
      const f = state.foundations[from.index];
      return f && f.length ? [top(f)] : null;
    }
    if (from.pile === "tableau") {
      const col = state.tableau[from.index];
      const count = from.count === undefined ? 1 : from.count;
      if (!col || !Number.isInteger(count) || count < 1 || count > col.length) return null;
      if (movableCount(state, from.index, col.length - count) !== count) return null;
      return col.slice(col.length - count);
    }
    return null;
  }

  function isLegalMove(state, move) {
    if (!move) return false;
    if (move.type === "draw") return state.stock.length > 0;
    if (move.type === "recycle") return state.stock.length === 0 && state.waste.length > 0;
    if (move.type !== "move") return false;
    const cards = sourceCards(state, move.from);
    const to = move.to;
    if (!cards || !to) return false;
    if (to.pile === "tableau") {
      const col = state.tableau[to.index];
      if (!col) return false;
      if (move.from.pile === "tableau" && move.from.index === to.index) return false;
      // An empty column or a column with only face-down cards cannot happen mid-game (the top card is always face up).
      return canPlaceOnTableau(cards[0], top(col));
    }
    if (to.pile === "foundation") {
      const f = state.foundations[to.index];
      if (!f || cards.length !== 1) return false;
      if (move.from.pile === "foundation" && move.from.index === to.index) return false;
      return canPlaceOnFoundation(cards[0], top(f));
    }
    return false;
  }

  /** The state after `move`, or null when it is illegal. The previous state is pushed on the undo stack. */
  function applyMove(state, move) {
    if (!isLegalMove(state, move)) return null;
    const next = { ...snapshot(state), undo: [...state.undo, snapshot(state)].slice(-MAX_UNDO), moves: state.moves + 1 };

    if (move.type === "draw") {
      const n = Math.min(state.draw, state.stock.length);
      next.stock = state.stock.slice(0, state.stock.length - n);
      next.waste = state.waste.concat(state.stock.slice(state.stock.length - n).reverse());
      next.fan = n;
      return next;
    }
    if (move.type === "recycle") {
      next.stock = state.waste.slice().reverse();
      next.waste = [];
      next.fan = 0;
      next.recycles = state.recycles + 1;
      return next;
    }

    const { from, to } = move;
    const cards = sourceCards(state, from);
    if (from.pile === "waste") {
      next.waste = state.waste.slice(0, -1);
      next.fan = next.waste.length ? Math.max(1, state.fan - 1) : 0;
    } else if (from.pile === "foundation") {
      next.foundations = state.foundations.slice();
      next.foundations[from.index] = state.foundations[from.index].slice(0, -1);
    } else {
      next.tableau = state.tableau.slice();
      next.faceDown = state.faceDown.slice();
      const col = state.tableau[from.index];
      next.tableau[from.index] = col.slice(0, col.length - cards.length);
      if (next.tableau[from.index].length && next.faceDown[from.index] === next.tableau[from.index].length) next.faceDown[from.index]--;
    }
    if (to.pile === "tableau") {
      if (next.tableau === state.tableau) next.tableau = state.tableau.slice();
      next.tableau[to.index] = state.tableau[to.index].concat(cards);
    } else {
      if (next.foundations === state.foundations) next.foundations = state.foundations.slice();
      next.foundations[to.index] = state.foundations[to.index].concat(cards);
    }
    return next;
  }

  /** The stock click: a draw, a recycle of the waste, or null when both piles are empty. */
  function stockMove(state) {
    if (state.stock.length) return { type: "draw" };
    if (state.waste.length) return { type: "recycle" };
    return null;
  }

  /** Move that sends the top card of the waste (`{pile:"waste"}`) or of a column to a foundation, or null. */
  function autoFoundationMove(state, from) {
    const cards = sourceCards(state, from);
    if (!cards || cards.length !== 1 || from.pile === "foundation") return null;
    const id = cards[0];
    const match = state.foundations.findIndex((f) => f.length && canPlaceOnFoundation(id, top(f)));
    const index = match >= 0 ? match : state.foundations.findIndex((f) => !f.length && canPlaceOnFoundation(id, null));
    if (index < 0) return null;
    return { type: "move", from: from.pile === "waste" ? { pile: "waste" } : { pile: "tableau", index: from.index, count: 1 }, to: { pile: "foundation", index } };
  }

  /** The previous state, or null when there is nothing to undo. */
  function undo(state) {
    if (!state.undo.length) return null;
    return { ...state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
  }

  const canUndo = (state) => state.undo.length > 0;
  const foundationCount = (state) => sum(state.foundations);
  const isWon = (state) => foundationCount(state) === C.DECK_SIZE;
  const topCard = (pile) => top(pile);

  function foundationStep(state) {
    for (let i = 0; i < COLUMNS; i++) {
      if (state.tableau[i].length === 0) continue;
      const m = autoFoundationMove(state, { pile: "tableau", index: i });
      if (m) return m;
    }
    return autoFoundationMove(state, { pile: "waste" });
  }

  /**
   * The moves that finish the game using only foundation moves and stock draws/recycles, or null when that is not
   * possible (a face-down tableau card remains, or the stock and waste order gets stuck).
   */
  function autoPlan(state) {
    if (isWon(state)) return null;
    for (let i = 0; i < COLUMNS; i++) if (state.faceDown[i] > 0) return null;
    const plan = [];
    let s = state, idle = 0;
    while (!isWon(s)) {
      let m = foundationStep(s);
      if (m) idle = 0;
      else if (++idle > 60) return null; // a full pass over the stock (at most 25 steps) gave nothing
      else m = stockMove(s);
      if (!m) return null;
      plan.push(m);
      s = applyMove(s, m);
      if (plan.length > 400) return null;
    }
    return plan;
  }

  const canAutoComplete = (state) => !isWon(state) && autoPlan(state) !== null;

  /** Structural check for a state loaded from storage: shapes, 52 unique cards, valid face-down counts, undo entries. */
  function isValidState(s, nested = false) {
    const arr = Array.isArray;
    if (!s || typeof s !== "object" || s.v !== VERSION) return false;
    if (!Number.isInteger(s.seed) || (s.draw !== 1 && s.draw !== 3)) return false;
    if (!Number.isInteger(s.moves) || s.moves < 0 || !Number.isInteger(s.recycles) || s.recycles < 0) return false;
    if (!arr(s.stock) || !arr(s.waste) || !arr(s.foundations) || s.foundations.length !== FOUNDATIONS) return false;
    if (!arr(s.tableau) || s.tableau.length !== COLUMNS || !arr(s.faceDown) || s.faceDown.length !== COLUMNS) return false;
    if (![...s.foundations, ...s.tableau].every(arr)) return false;
    if (!Number.isInteger(s.fan) || s.fan < 0 || s.fan > Math.min(3, s.waste.length)) return false;
    const seen = new Set();
    for (const p of [s.stock, s.waste, ...s.foundations, ...s.tableau]) for (const id of p) { if (!C.isCard(id) || seen.has(id)) return false; seen.add(id); }
    if (seen.size !== C.DECK_SIZE) return false;
    for (let i = 0; i < COLUMNS; i++) {
      const f = s.faceDown[i], n = s.tableau[i].length;
      if (!Number.isInteger(f) || f < 0 || f > n || (n > 0 && f === n)) return false;
    }
    if (nested) return true;
    return arr(s.undo) && s.undo.length <= MAX_UNDO && s.undo.every((u) => isValidState(u, true));
  }

  const api = {
    VERSION, COLUMNS, FOUNDATIONS, MAX_UNDO,
    deal, canPlaceOnTableau, canPlaceOnFoundation, movableCount, isLegalMove, applyMove, stockMove,
    autoFoundationMove, undo, canUndo, foundationCount, isWon, topCard, autoPlan, canAutoComplete, isValidState,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Klondike = api;
})(typeof window !== "undefined" ? window : globalThis);
