// Hearth 2.1 in the widget: quests with tiers and XP, the daily chest and the weekly quest, places, the clean stat's
// looks (dirt, shower), the games' pure rules, and that the widget mirrors the relay for all of it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as R from "../../tools/umbra-relay/hearth.js";

const require = createRequire(import.meta.url);
globalThis.HearthMascot = require("../../widgets/hearth/mascot.js");
const WL = require("../../widgets/hearth/pet-world-logic.js");
const PL = require("../../widgets/hearth/pet-places.js");
const W = require("../../widgets/hearth/pet-world.js");
const M = globalThis.HearthMascot;
const read = (f) => readFileSync(new URL("../../widgets/hearth/" + f, import.meta.url), "utf8");

test("quests, the weekly quest and the games mirror the relay (tiers, XP, targets)", () => {
  for (const [id, q] of Object.entries(R.QUESTS)) {
    assert.equal(WL.QUESTS[id].tier, q.tier, id); assert.equal(WL.QUESTS[id].xp, q.xp, id);
    assert.ok(WL.QUESTS[id].title && WL.questText(id, "Pooker"), id);
  }
  assert.deepEqual(Object.keys(WL.WEEKLY).sort(), Object.keys(R.WEEKLY).sort());
  for (const [id, w] of Object.entries(R.WEEKLY)) { assert.equal(WL.WEEKLY[id].n, w.n, id); assert.ok(WL.weeklyText(id, "Pooker"), id); }
  assert.deepEqual([...WL.GAME_IDS].sort(), Object.keys(R.GAMES).sort());
  for (const tier of [1, 2, 3]) assert.ok(Object.values(WL.QUESTS).filter((q) => q.tier === tier).length >= 5, "enough quests in tier " + tier);
});

test("every place the shop sells has art, and the art is safe, still and small enough", () => {
  const places = Object.keys(R.SHOP).filter((id) => R.SHOP[id].cat === "place");
  assert.deepEqual([...PL.ids].sort(), places.sort());
  for (const id of places) {
    const p = PL.get(id);
    assert.ok(p.label && Array.isArray(p.shows) && p.shows.includes("rug"), id);
    for (const s of p.shows) assert.ok(R.ROOM_SPOTS.includes(s), id + " " + s);
    for (const phase of ["night", "day", "dusk"]) {
      const svg = W.renderRoom({ room: { place: id, wallpaper: "wall_night", mantel: "lights", rug: "rug_sky", toy: "ball" }, phase, mood: "happy", level: 3 });
      assert.doesNotMatch(svg, /<script|<style|<image|href|url\(|\son\w+=|\sid=/i, id);
      assert.equal((svg.match(/<svg/g) || []).length, (svg.match(/<\/svg>/g) || []).length, id);
      assert.ok(svg.length < 40000, `${id} is ${svg.length} chars`);
      if (!p.shows.includes("mantel")) assert.ok(!svg.includes("pw-bulb"), id + " hides the mantel lights");
    }
  }
  assert.equal(PL.get("nope"), null);
  assert.equal(PL.get("__proto__"), null);
  const still = W.renderRoom({ room: { place: "beach" }, pet: false, still: true });
  assert.ok(!still.includes('class="hm ') && still.includes("pw-still"), "shop pictures: no pet, no motion");
});

test("the room shows the pet's dirt, and keyOf redraws when it changes", () => {
  const clean = W.renderRoom({ room: {}, mood: "content" }), grubby = W.renderRoom({ room: {}, mood: "content", dirt: 1 }), muddy = W.renderRoom({ room: {}, mood: "content", dirt: 2 });
  assert.ok(!clean.includes("hm-dirt"));
  assert.ok(grubby.includes("hm-dirt") && !grubby.includes("hm-flies"));
  assert.ok(muddy.includes("hm-flies"));
  assert.notEqual(W.keyOf({ dirt: 0 }), W.keyOf({ dirt: 1 }));
  assert.equal(M.normalize({ dirt: 7 }).dirt, 0);
  assert.ok(M.REACTIONS.includes("shower"));
  assert.ok(M.reactionMs("shower") > M.REACTION_MS);
  assert.ok(W.renderRoom({ room: {} }).includes("pw-x-shower"), "the shower head waits in the room for the act");
});

test("parseWorld reads quest XP and tiers, the chest and the weekly quest; claimable lists all three kinds", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const w = WL.parseWorld({
    coins: 10, quests: [{ id: "feed2", n: 2, p: 2, reward: 15, xp: 5, tier: 1, claimed: true }, { id: "care6", n: 6, p: 6, reward: 20, xp: 8, tier: 2, claimed: false }, { id: "nope", n: 1, p: 1 }],
    questBonus: { ready: false, claimed: false, xp: 15, reward: 30 }, weekly: { id: "games15", n: 15, p: 15, claimed: false, endsAt: now + 3 * 86400000 + 3600000, xp: 40, reward: 100 },
  });
  assert.equal(w.quests.length, 2, "unknown quest ids are dropped");
  assert.deepEqual([w.quests[1].xp, w.quests[1].tier], [8, 2]);
  assert.deepEqual(WL.claimable(w).map((q) => q.id), ["care6", "week"]);
  w.questBonus.ready = true;
  assert.deepEqual(WL.claimable(w).map((q) => q.id), ["care6", "bonus", "week"]);
  assert.equal(WL.timeLeft(w.weekly.endsAt, now), "3 days left");
  assert.equal(WL.timeLeft(now + 5 * 3600000, now), "5 h left");
  // a 2.0 relay: no xp, tier, chest or weekly
  const old = WL.parseWorld({ coins: 1, quests: [{ id: "feed2", n: 2, p: 0, reward: 15 }] });
  assert.deepEqual([old.quests[0].xp, old.quests[0].tier, old.questBonus, old.weekly], [2, 1, null, null]);
  assert.match(WL.worldProblem({ error: "bad game" }), /needs an update/);
});

test("game rules: catch points and combos, bubble chains", () => {
  assert.equal(WL.catchPoints(false, 0), 1);
  assert.equal(WL.catchPoints(true, 0), 3);
  assert.equal(WL.catchPoints(false, 5), 2);
  assert.equal(WL.catchPoints(true, 10), 9);
  const b = [{ x: 0, y: 0, r: 10 }, { x: 19, y: 0, r: 10 }, { x: 38, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }];
  assert.deepEqual(WL.bubbleChain(b, 0).sort(), [0, 1, 2]);
  assert.deepEqual(WL.bubbleChain(b, 3), [3]);
});

test("the diary tells showers, chests and weekly quests", () => {
  const names = { partner: "Selin" };
  assert.equal(WL.diaryLine([0, "b", "shower"], "a", names, "Pooker"), "Selin gave Pooker a shower");
  assert.equal(WL.diaryLine([0, "a", "chest"], "a", names, "Pooker"), "You opened the daily chest");
  assert.equal(WL.diaryLine([0, "a", "week", "beach"], "a", names, "Pooker"), "You finished the weekly quest: Beach for Pooker!");
});

test("the games file: one canvas, no DOM per frame, no storage, buttons none, text never under 11 px", () => {
  const js = read("pet-games.js");
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|eval\(|new Function|innerHTML\s*=\s*[^`]*\$\{(?!meta)/);
  assert.match(js, /devicePixelRatio/);
  assert.match(js, /ResizeObserver/);
  assert.match(js, /Math\.max\(11,/, "FONT never goes under 11 px");
  for (const id of WL.GAME_IDS) assert.match(js, new RegExp(`${id}: `), id);
});

test("no scrollbars anywhere in Hearth, and scrolled areas fade instead", () => {
  const css = read("hearth.css");
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /::-webkit-scrollbar\s*\{\s*display:\s*none/);
  assert.match(css, /\.hm-fade\.can-down/);
});
