// Generic playing-card helpers: a 52-card deck, a seeded shuffle and card/suit/rank lookups. Pure functions, no DOM,
// and no game rules, so Klondike, FreeCell and Spider can share this file as-is.
// Browser: window.Cards. Node: module.exports.
//
// A card is an integer id 0..51: id = suit * 13 + (rank - 1).
//   suit: 0 spades, 1 hearts, 2 diamonds, 3 clubs      rank: 1 (ace) .. 13 (king)
(function (root) {
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"];
  const SUIT_GLYPHS = ["♠", "♥", "♦", "♣"];
  const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const RANK_NAMES = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"];
  const SUIT_COUNT = 4;
  const RANK_COUNT = 13;
  const DECK_SIZE = 52;
  const ACE = 1;
  const KING = 13;

  const isCard = (id) => Number.isInteger(id) && id >= 0 && id < DECK_SIZE;
  const need = (id) => { if (!isCard(id)) throw new RangeError("not a card id: " + id); return id; };

  /** Card id for a suit (0-3) and rank (1-13). */
  function card(suit, rank) {
    if (!Number.isInteger(suit) || suit < 0 || suit >= SUIT_COUNT) throw new RangeError("bad suit: " + suit);
    if (!Number.isInteger(rank) || rank < ACE || rank > KING) throw new RangeError("bad rank: " + rank);
    return suit * RANK_COUNT + (rank - 1);
  }

  const suitOf = (id) => Math.floor(need(id) / RANK_COUNT);
  const rankOf = (id) => (need(id) % RANK_COUNT) + 1;
  /** Hearts and diamonds are red. */
  const isRed = (id) => { const s = suitOf(id); return s === 1 || s === 2; };
  const colorOf = (id) => (isRed(id) ? "red" : "black");
  const sameColor = (a, b) => isRed(a) === isRed(b);
  const sameSuit = (a, b) => suitOf(a) === suitOf(b);

  const rankLabel = (rank) => RANK_LABELS[rank - 1];
  const suitGlyph = (suit) => SUIT_GLYPHS[suit];
  /** Short label such as "10♠" or "A♥". */
  const label = (id) => RANK_LABELS[rankOf(id) - 1] + SUIT_GLYPHS[suitOf(id)];
  /** Spoken name such as "queen of hearts". */
  const name = (id) => RANK_NAMES[rankOf(id) - 1] + " of " + SUIT_NAMES[suitOf(id)];

  /** A fresh, ordered deck: [0, 1, ... 51]. */
  function makeDeck() {
    return Array.from({ length: DECK_SIZE }, (_, i) => i);
  }

  /** Small, fast seeded PRNG (mulberry32). Returns a function giving floats in [0, 1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher-Yates shuffle of a copy of `items`; the same seed always gives the same order. */
  function shuffle(items, seed) {
    const rnd = mulberry32(seed);
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** A full deck shuffled from `seed`. */
  const shuffledDeck = (seed) => shuffle(makeDeck(), seed);

  /** A game number in 1..999999 (impure: the only function here that is not deterministic). */
  const randomSeed = (rnd = Math.random) => 1 + Math.floor(rnd() * 999999);

  const api = {
    SUITS, SUIT_NAMES, SUIT_GLYPHS, RANK_LABELS, RANK_NAMES, SUIT_COUNT, RANK_COUNT, DECK_SIZE, ACE, KING,
    isCard, card, suitOf, rankOf, isRed, colorOf, sameColor, sameSuit,
    rankLabel, suitGlyph, label, name,
    makeDeck, mulberry32, shuffle, shuffledDeck, randomSeed,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Cards = api;
})(typeof window !== "undefined" ? window : globalThis);
