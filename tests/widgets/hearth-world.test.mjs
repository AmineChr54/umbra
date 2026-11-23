import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as R from "../../tools/umbra-relay/hearth.js";

const require = createRequire(import.meta.url);
globalThis.HearthMascot = require("../../widgets/hearth/mascot.js");
const WL = require("../../widgets/hearth/pet-world-logic.js");
const W = require("../../widgets/hearth/pet-world.js");
const M = globalThis.HearthMascot;
const css = readFileSync(new URL("../../widgets/hearth/pet-world.css", import.meta.url), "utf8");

test("the widget's catalog is the relay's: same items, prices, spots, slots and treat gains", () => {
  assert.deepEqual(Object.keys(WL.CATALOG).sort(), Object.keys(R.SHOP).sort());
  for (const [id, it] of Object.entries(R.SHOP)) {
    const c = WL.CATALOG[id];
    assert.equal(c.cat, it.cat, id); assert.equal(c.price, it.price, id);
    assert.equal(c.spot, it.spot, id); assert.equal(c.slot, it.slot, id);
    assert.deepEqual(c.gain, it.gain, id);
    assert.ok(c.label, id);
  }
  for (const [id, g] of Object.entries(R.GAMES)) { assert.equal(WL.GAMES[id].max, g.max); assert.equal(WL.GAMES[id].per, g.per); assert.equal(WL.GAMES[id].cap, g.cap); }
  for (const [id, q] of Object.entries(R.QUESTS)) { assert.equal(WL.QUESTS[id].n, q.n, id); assert.equal(WL.QUESTS[id].reward, q.reward, id); }
  assert.deepEqual(Object.keys(WL.QUESTS).sort(), Object.keys(R.QUESTS).sort());
  assert.deepEqual(WL.STICKER_IDS, [...R.STICKERS]);
  assert.deepEqual(WL.SPOTS.map((s) => s.id), [...R.ROOM_SPOTS]);
});

test("every shop outfit is a mascot outfit in the relay's slot, and every free one too", () => {
  for (const [id, it] of Object.entries(R.SHOP)) if (it.cat === "outfit") assert.equal(M.OUTFIT_SLOT[id], it.slot, id);
  for (const [id, it] of Object.entries(R.FREE_OUTFITS)) assert.equal(M.OUTFIT_SLOT[id], it.slot, id);
});

test("time of day, seasons, sleep and holidays", () => {
  assert.equal(WL.skyPhase(23), "night"); assert.equal(WL.skyPhase(6), "dawn"); assert.equal(WL.skyPhase(12), "day"); assert.equal(WL.skyPhase(19), "dusk");
  assert.equal(WL.asleepAt(23), true); assert.equal(WL.asleepAt(3), true); assert.equal(WL.asleepAt(7), false);
  assert.equal(WL.season(0), "winter"); assert.equal(WL.season(3), "spring"); assert.equal(WL.season(7), "summer"); assert.equal(WL.season(10), "autumn");
  const born = new Date(2025, 4, 10).getTime();
  assert.equal(WL.holiday(new Date(2026, 4, 10), born, ""), "birthday");
  assert.equal(WL.holiday(new Date(2025, 4, 10), born, ""), "", "not on the day it hatched");
  assert.equal(WL.holiday(new Date(2026, 1, 3), 0, "2024-02-03"), "anniversary");
  assert.equal(WL.holiday(new Date(2026, 11, 31), 0, ""), "newyear");
  assert.equal(WL.holiday(new Date(2026, 11, 24), 0, ""), "winterfest");
  assert.equal(WL.holiday(new Date(2026, 1, 14), 0, ""), "valentine");
  assert.equal(WL.holiday(new Date(2026, 9, 31), 0, ""), "halloween");
  assert.equal(WL.holiday(new Date(2026, 5, 3), 0, ""), "");
});

test("parseWorld: null on an old relay, cleans what a relay sends", () => {
  assert.equal(WL.parseWorld({ food: 1 }), null);
  const w = WL.parseWorld({ coins: 12.7, inv: { ball: 1, nope: 3, plant: 0 }, room: { toy: "ball", wall: "ball", rug: "x" }, wear: null, quests: [{ id: "feed2", n: 2, p: 1, reward: 15 }, { id: "bad" }],
    stickers: ["first_buy", "nope"], gift: { from: "a", item: "cocoa", t: 5 }, log: [[1, "a", "feed", ""], "junk"], born: 9 });
  assert.equal(w.coins, 12);
  assert.deepEqual(w.inv, { ball: 1 });
  assert.deepEqual(w.room, { toy: "ball" });
  assert.equal(w.wear, null);
  assert.equal(w.quests.length, 1);
  assert.deepEqual(w.stickers, ["first_buy"]);
  assert.equal(w.gift.item, "cocoa");
  assert.equal(w.log.length, 1);
  assert.equal(WL.claimable({ quests: [{ id: "feed2", n: 2, p: 2, claimed: false }] }).length, 1);
});

test("diary lines name you or your partner", () => {
  const names = { you: "Ada", partner: "Sam" };
  assert.equal(WL.diaryLine([0, "a", "feed", ""], "a", names, "Ember"), "You fed Ember");
  assert.equal(WL.diaryLine([0, "b", "buy", "lamp"], "a", names, "Ember"), "Sam bought Lamp");
  assert.equal(WL.diaryLine([0, "b", "play", "catch:12"], "a", names, "Ember"), "Sam played Berry Catch: 12");
  assert.equal(WL.diaryLine([0, "a", "sticker", "first_buy"], "a", names, "Ember"), "New sticker: First buy");
});

test("games: seeded sequences repeat, rounds get harder, rewards follow the relay's numbers", () => {
  assert.deepEqual(WL.memorySequence(WL.rng(7), 8), WL.memorySequence(WL.rng(7), 8));
  assert.ok(WL.memorySequence(WL.rng(7), 50).every((v) => v >= 0 && v < 4));
  assert.ok(WL.seekRound(8).swaps > WL.seekRound(1).swaps && WL.seekRound(8).ms < WL.seekRound(1).ms);
  assert.equal(WL.gameCoins("catch", 30), Math.floor(30 * R.GAMES.catch.per));
  assert.equal(WL.gameCoins("memory", 999), R.GAMES.memory.cap);
  assert.ok(WL.acornChance(0) < WL.acornChance(29000));
});

test("tricks unlock by level", () => {
  assert.deepEqual(WL.tricksFor(1).filter((t) => t.unlocked), []);
  assert.deepEqual(WL.tricksFor(9).filter((t) => t.unlocked).map((t) => t.id), ["sit", "wave", "spin", "jump"]);
});

const rooms = () => {
  const full = {};
  for (const s of WL.SPOTS) full[s.id] = WL.itemsForSpot(s.id)[0];
  const out = [];
  for (const phase of ["night", "dawn", "day", "dusk"]) for (const season of ["winter", "spring", "summer", "autumn"])
    out.push({ phase, season, room: full, gift: "theirs" }, { phase, season, room: {} });
  for (const holiday of ["birthday", "anniversary", "newyear", "winterfest", "valentine", "halloween"]) out.push({ holiday, room: {} });
  for (const id of Object.keys(WL.CATALOG)) { const it = WL.CATALOG[id]; if (it.spot) out.push({ room: { [it.spot]: id }, phase: "night" }); }
  return out;
};

test("every room renders safe, well-formed SVG: no scripts, styles, ids, links or handlers", () => {
  for (const o of rooms()) {
    const svg = W.renderRoom(Object.assign({ mood: "happy", level: 6, title: `Em"<b>` }, o));
    assert.doesNotMatch(svg, /<script|<style|<image|href|url\(|\son\w+=|\sid=/i);
    assert.equal((svg.match(/<svg/g) || []).length, (svg.match(/<\/svg>/g) || []).length);
    assert.ok(svg.includes('class="hm '), "the blob is inside");
    assert.ok(svg.length < 40000, `room is ${svg.length} chars`);
    assert.ok(!svg.includes('"<b>'), "title escaped");
  }
  const a = W.renderRoom({ room: {}, phase: "day" }), b = W.renderRoom({ room: { wallpaper: "wall_night" }, phase: "day" });
  assert.notEqual(a, b);
});

test("the world stylesheet: every animation scales with --motion-scale, keyframes all used, motion off stops it", () => {
  const anims = [...css.matchAll(/animation(?:-duration)?:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => !/^\s*none\b/.test(v));
  for (const a of anims) assert.match(a, /var\(--motion-scale, 1\)/, a);
  const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/(?:animation:\s*|,\s*)(pw-[\w-]+)\s+calc/g)].map((m) => m[1]));
  for (const u of used) assert.ok(defined.has(u), "undefined " + u);
  for (const d of defined) assert.ok(used.has(d), "unused " + d);
  assert.match(css, /html\[data-motion="off"\] \.pw-scene \*/);
  assert.doesNotMatch(css, /url\(|@import/);
});
