// Hearth 2.1 on the relay (tools/umbra-relay/hearth.js): the Clean stat and the shower, places, tiered daily quests
// with XP, the daily chest, the weekly quest and the two new games. Same harness as hearth.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, pairCouple, MIN, HOUR, DAY } from "./harness.mjs";
import { SHOP, QUESTS, WEEKLY, GAMES, WORLD, STICKERS, ROOM_SPOTS, PET, questsFor, isoWeek, weeklyFor } from "../../tools/umbra-relay/hearth.js";

const hot = (r, room) => r.storageOf("r:" + room).m.get("h");
async function world() {
  const r = createRelay();
  const c = await pairCouple(r);
  await c.a.sync(0);
  return { r, ...c };
}
/** Today's quests replaced by `ids` (the draw is random per day and room). */
async function forceQuests(r, room, a, ids) {
  await a.call("quests");
  const q = hot(r, room).pet.q;
  q.ids = ids; q.p = [0, 0, 0]; q.c = [false, false, false]; delete q.b; delete q.team;
}

test("clean: starts at 70, decays slowly, a shower adds 40 and counts like any care", async () => {
  const { r, a } = await world();
  assert.equal((await a.sync(0)).pet.clean, 70);
  r.advance(30 * HOUR);
  assert.equal((await a.sync(0)).pet.clean, Math.round(70 - PET.rate.clean * 30));
  const s = await a.call("care", { action: "shower" });
  assert.equal(s.ok, true);
  assert.equal(s.pet.clean, Math.round(70 - PET.rate.clean * 30 + 40));
  assert.equal(s.coins, WORLD.careCoins, "a needed shower earns Embers like the other care");
  assert.ok(s.pet.log.some((e) => e[1] === "a" && e[2] === "shower"), "the diary has it");
  assert.ok(s.stickers.includes("first_shower"));
  const again = await a.call("care", { action: "shower" });
  assert.equal(again.error, "too soon");
});

test("clean: a pet stored before 2.1 gets 70 now, whatever its stored time", async () => {
  const { r, room, a } = await world();
  r.advance(3 * DAY);
  delete hot(r, room).pet.clean;
  assert.equal((await a.sync(0)).pet.clean, 70);
  r.advance(10 * HOUR);
  assert.equal((await a.sync(0)).pet.clean, Math.round(70 - PET.rate.clean * 10));
});

test("clean counts in the mood", async () => {
  const { r, room, a } = await world();
  Object.assign(hot(r, room).pet, { food: 100, water: 100, love: 100, clean: 10 });
  assert.equal((await a.sync(0)).pet.mood, "happy");          // avg 77.5
  Object.assign(hot(r, room).pet, { food: 60, water: 60, love: 60, clean: 10 });
  assert.equal((await a.sync(0)).pet.mood, "content");        // avg 47.5
  Object.assign(hot(r, room).pet, { food: 40, water: 40, love: 40, clean: 10 });
  assert.equal((await a.sync(0)).pet.mood, "sad");            // avg 32.5 (without clean it would be content)
});

test("places: bought in the shop, placed in the 'place' spot, shared, and removable for the free room", async () => {
  const { r, room, a, b } = await world();
  assert.ok(ROOM_SPOTS.includes("place"));
  hot(r, room).pet.coins = 500;
  assert.equal((await a.call("place", { spot: "place", item: "beach" })).error, "not yours yet");
  const bought = await a.call("buy", { item: "beach" });
  assert.equal(bought.pet.coins, 500 - SHOP.beach.price);
  const placed = await a.call("place", { spot: "place", item: "beach" });
  assert.equal(placed.pet.room.place, "beach");
  assert.equal((await b.sync(0)).pet.room.place, "beach", "the partner sees it");
  assert.equal((await a.call("place", { spot: "place", item: "plant" })).error, "bad item");
  assert.equal((await a.call("place", { spot: "wall", item: "beach" })).error, "bad item");
  const back = await a.call("place", { spot: "place", item: "" });
  assert.equal(back.pet.room.place, undefined);
  for (const id of ["garden", "snowy"]) await a.call("buy", { item: id });
  assert.ok((await a.sync(0)).pet.stickers.includes("globetrotter"));
});

test("quests: one of each tier a day, the same for both partners, with XP on the claim", async () => {
  for (const day of ["2026-11-23", "2026-11-24", "2026-12-25", "2027-02-01"]) {
    const ids = questsFor(day, "room1");
    assert.deepEqual(ids.map((id) => QUESTS[id].tier), [1, 2, 3], day);
  }
  const { r, room, a, b } = await world();
  const drawn = (await a.call("quests")).pet.quests;
  assert.deepEqual(drawn, (await b.sync(0)).pet.quests);
  assert.ok(drawn.every((q) => q.xp >= 5 && q.tier >= 1));
  await forceQuests(r, room, a, ["feed2", "care6", "both"]);
  await a.call("care", { action: "feed" }); r.advance(6 * MIN); await a.call("care", { action: "feed" });
  const xp0 = hot(r, room).pet.xp;
  const c = await a.call("claim", { q: 0 });
  assert.equal(c.ok, true);
  assert.equal(c.xp, QUESTS.feed2.xp);
  assert.equal(hot(r, room).pet.xp, xp0 + QUESTS.feed2.xp);
  assert.equal((await a.call("claim", { q: 0 })).error, "already claimed");
  assert.equal((await a.call("claim", { q: 3 })).error, "bad quest");
  assert.equal((await a.call("claim", { q: "1.0" })).error, "bad quest");
});

test("the daily chest opens once all three quests are claimed", async () => {
  const { r, room, a, b } = await world();
  await forceQuests(r, room, a, ["shower1", "shower2", "both"]);
  await a.call("care", { action: "shower" });
  assert.equal((await a.call("claim", { q: "bonus" })).error, "not done yet");
  r.advance(6 * MIN);
  await a.call("care", { action: "shower" });
  await b.call("care", { action: "feed" });
  for (const i of [0, 1, 2]) assert.equal((await a.call("claim", { q: i })).ok, true, "quest " + i);
  const view = (await a.sync(0)).pet.questBonus;
  assert.deepEqual([view.ready, view.claimed], [true, false]);
  const coins0 = hot(r, room).pet.coins, xp0 = hot(r, room).pet.xp;
  const chest = await b.call("claim", { q: "bonus" });
  assert.equal(chest.ok, true);
  assert.equal(hot(r, room).pet.coins, coins0 + WORLD.bonusCoins);
  assert.equal(hot(r, room).pet.xp, xp0 + WORLD.bonusXp);
  assert.equal(chest.pet.questBonus.claimed, true);
  assert.equal((await a.call("claim", { q: "bonus" })).error, "already claimed");
});

test("full: every stat topped up at once", async () => {
  const { r, room, a } = await world();
  await forceQuests(r, room, a, ["feed2", "care6", "full"]);
  Object.assign(hot(r, room).pet, { food: 90, water: 90, love: 90, clean: 50, t: r.clock.t });
  r.advance(6 * MIN);
  const s = await a.call("care", { action: "shower" });
  assert.equal(s.pet.quests[2].p, 1);
});

test("weekly quest: one per ISO week, progress from what it asks, claim pays XP, Embers and a surprise item", async () => {
  assert.equal(isoWeek(Date.UTC(2026, 10, 23)), "2026-W48");  // a Monday
  assert.equal(isoWeek(Date.UTC(2026, 10, 29, 23)), "2026-W48"); // the Sunday after
  assert.equal(isoWeek(Date.UTC(2027, 0, 1)), "2026-W53");
  assert.equal(isoWeek(Date.UTC(2027, 0, 4)), "2027-W01");
  assert.ok(Object.keys(WEEKLY).includes(weeklyFor("2026-W48", "x")));

  const { r, room, a } = await world();
  const w0 = (await a.call("quests")).pet.weekly;
  assert.equal(w0.p, 0);
  assert.ok(w0.endsAt > r.clock.t && w0.endsAt - r.clock.t <= 7 * DAY);
  const wq = hot(r, room).pet.wq;
  wq.id = "shower4";
  r.advance(30 * HOUR);
  for (let i = 0; i < 4; i++) { await a.call("care", { action: "shower" }); r.advance(6 * MIN); }
  const w = (await a.sync(0)).pet.weekly;
  if (w.p < 4) return assert.fail("the week rolled over during the test: " + JSON.stringify(w));
  const coins0 = hot(r, room).pet.coins, xp0 = hot(r, room).pet.xp;
  const got = await a.call("claim", { q: "week" });
  assert.equal(got.ok, true);
  assert.ok(got.item && SHOP[got.item] && SHOP[got.item].cat !== "treat", "a surprise item");
  assert.equal(got.pet.inv[got.item], 1);
  assert.equal(hot(r, room).pet.coins, coins0 + WORLD.weekCoins);
  assert.equal(hot(r, room).pet.xp, xp0 + WORLD.weekXp);
  assert.ok(got.stickers.includes("weekly1"));
  assert.equal((await a.call("claim", { q: "week" })).error, "already claimed");
});

test("new games pay like the others; team play and a new record count for quests", async () => {
  assert.ok(GAMES.bubbles && GAMES.hop);
  const { r, room, a, b } = await world();
  await forceQuests(r, room, a, ["play1", "bubbles30", "team"]);
  const one = await a.call("play", { game: "bubbles", score: 40 });
  assert.equal(one.ok, true);
  assert.equal(one.coins, Math.min(GAMES.bubbles.cap, Math.floor(40 * GAMES.bubbles.per)));
  assert.equal(one.pet.quests[1].p, 1);
  assert.equal(one.pet.quests[2].p, 0, "only one partner has played");
  const two = await b.call("play", { game: "hop", score: 12 });
  assert.equal(two.pet.quests[2].p, 1, "team play: both played today");
  await forceQuests(r, room, a, ["play1", "hop10", "record"]);
  r.advance(MIN);
  const first = await b.call("play", { game: "hop", score: 5 });
  assert.equal(first.pet.quests[2].p, 0, "a lower score is no record");
  r.advance(MIN);
  const best = await b.call("play", { game: "hop", score: 20 });
  assert.equal(best.record, true);
  assert.equal(best.pet.quests[2].p, 1);
  assert.equal(best.pet.quests[1].p, 1);
});

test("every sticker id is listed once, and every shop item has a known category", () => {
  assert.equal(new Set(STICKERS).size, STICKERS.length);
  for (const [id, it] of Object.entries(SHOP)) assert.ok(["treat", "toy", "decor", "outfit", "place"].includes(it.cat), id);
});
