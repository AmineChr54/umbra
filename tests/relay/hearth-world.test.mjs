// The pet's world on the relay (tools/umbra-relay/hearth.js): Embers, shop, room, outfits, games, quests, stickers,
// gifts and the diary. Same harness as hearth.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, pairCouple, SEC, MIN, HOUR, DAY } from "./harness.mjs";
import { SHOP, QUESTS, GAMES, WORLD, STICKERS, FREE_OUTFITS, ROOM_SPOTS, questsFor, petView } from "../../tools/umbra-relay/hearth.js";

/** Give the pet `coins` Embers straight in storage (earning them by caring would take days of fake time). */
function setCoins(r, room, coins) {
  const st = r.storageOf("r:" + room);
  const h = st.m.get("h");
  h.pet.coins = coins;
}
async function world() {
  const r = createRelay();
  const c = await pairCouple(r);
  await c.a.sync(0); // the pet is born with the first Hearth call
  return { r, ...c };
}

test("a new pet has an empty world: no Embers, nothing owned, nothing worn, born now", async () => {
  const { r, a } = await world();
  const p = (await a.sync(0)).pet;
  assert.equal(p.coins, 0);
  assert.deepEqual(p.inv, {});
  assert.deepEqual(p.room, {});
  assert.equal(p.wear, null);
  assert.deepEqual(p.stickers, []);
  assert.equal(p.gift, null);
  assert.deepEqual(p.log, []);
  assert.equal(p.born, r.clock.t);
  assert.equal(p.quests, null, "quests are drawn by the first action of the day");
});

test("a pet stored before the world gets its fields once, and keeps its birthday", async () => {
  const { r, room, a } = await world();
  const st = r.storageOf("r:" + room);
  const h = st.m.get("h");
  for (const k of ["coins", "inv", "room", "wear", "best", "ach", "log", "n", "gift", "born", "earn"]) delete h.pet[k];
  r.advance(HOUR);
  const first = (await a.sync(0)).pet;
  assert.equal(first.coins, 0);
  assert.equal(first.born, r.clock.t);
  r.advance(HOUR);
  assert.equal((await a.sync(0)).pet.born, first.born, "born is saved, not recomputed per sync");
});

test("caring earns Embers when it was needed, and the bond pays a bonus", async () => {
  const { r, a, b } = await world();
  r.advance(20 * HOUR);
  const fed = await a.call("care", { action: "feed" });
  assert.equal(fed.coins, WORLD.careCoins);
  assert.equal(fed.pet.coins, WORLD.careCoins);
  const bonded = await b.call("care", { action: "water" });
  assert.equal(bonded.pet.coins, 2 * WORLD.careCoins + WORLD.bondCoins);
  assert.equal(bonded.coins, WORLD.careCoins + WORLD.bondCoins);
  // food is 80: one more feed is still needed (to 100), the next one is not and earns nothing
  r.advance(6 * MIN);
  const topped = await a.call("care", { action: "feed" });
  assert.equal(topped.coins, WORLD.careCoins);
  r.advance(6 * MIN);
  const again = await a.call("care", { action: "feed" });
  assert.equal(again.coins, 0);
  assert.equal(again.pet.coins, topped.pet.coins);
});

test("buy: costs Embers, rejects unknown items, too little, and a second copy of a non-treat", async () => {
  const { r, room, a, b } = await world();
  assert.deepEqual(await a.call("buy", { item: "nope" }), { error: "bad item" });
  assert.deepEqual(await a.call("buy", { item: "__proto__" }), { error: "bad item" });
  const poor = await a.call("buy", { item: "plant" });
  assert.equal(poor.error, "not enough embers");
  assert.equal(poor.need, SHOP.plant.price);
  setCoins(r, room, 100);
  const got = await a.call("buy", { item: "plant" });
  assert.equal(got.ok, true);
  assert.equal(got.pet.coins, 100 - SHOP.plant.price);
  assert.equal(got.pet.inv.plant, 1);
  assert.deepEqual(await b.call("buy", { item: "plant" }), { error: "already yours" }, "the inventory is shared");
  // treats stack
  await a.call("buy", { item: "smoothie" });
  const two = await b.call("buy", { item: "smoothie" });
  assert.equal(two.pet.inv.smoothie, 2);
  assert.equal(two.pet.coins, 100 - SHOP.plant.price - 2 * SHOP.smoothie.price);
});

test("use: a treat raises its stats, is used up and has a cooldown; only treats", async () => {
  const { r, room, a } = await world();
  setCoins(r, room, 200);
  await a.call("buy", { item: "cocoa" });
  await a.call("buy", { item: "cocoa" });
  await a.call("buy", { item: "ball" });
  r.advance(20 * HOUR); // water 70 - 37.5 = 32.5, love 51.25
  const used = await a.call("use", { item: "cocoa" });
  assert.equal(used.ok, true);
  assert.equal(used.pet.water, Math.round(32.5 + SHOP.cocoa.gain.water));
  assert.equal(used.pet.love, Math.round(51.25 + SHOP.cocoa.gain.love));
  assert.equal(used.pet.inv.cocoa, 1);
  const soon = await a.call("use", { item: "cocoa" });
  assert.equal(soon.error, "too soon");
  assert.ok(soon.retryIn > 0 && soon.retryIn <= 60);
  r.advance(WORLD.treatCooldownMs);
  assert.equal((await a.call("use", { item: "cocoa" })).ok, true);
  r.advance(WORLD.treatCooldownMs);
  assert.deepEqual(await a.call("use", { item: "cocoa" }), { error: "none left" });
  assert.deepEqual(await a.call("use", { item: "ball" }), { error: "bad item" });
});

test("place: only an owned item, only in its own spot; an empty item clears the spot", async () => {
  const { r, room, a, b } = await world();
  setCoins(r, room, 500);
  assert.deepEqual(await a.call("place", { spot: "attic", item: "plant" }), { error: "bad spot" });
  assert.deepEqual(await a.call("place", { spot: "floorL", item: "plant" }), { error: "not yours yet" });
  await a.call("buy", { item: "plant" });
  assert.deepEqual(await a.call("place", { spot: "wall", item: "plant" }), { error: "bad item" });
  const placed = await a.call("place", { spot: "floorL", item: "plant" });
  assert.deepEqual(placed.pet.room, { floorL: "plant" });
  assert.deepEqual((await b.sync(0)).pet.room, { floorL: "plant" }, "both partners see the same room");
  assert.deepEqual((await b.call("place", { spot: "floorL", item: "" })).pet.room, {});
  for (const spot of ROOM_SPOTS) assert.ok(Object.values(SHOP).some((i) => i.spot === spot), `something fits ${spot}`);
});

test("dress: free outfits by level or days together, shop outfits when owned, one per slot, shared", async () => {
  const { r, room, a, b } = await world();
  assert.deepEqual(await a.call("dress", { items: "bow" }), { error: "not unlocked" }, "bow needs level 2");
  assert.deepEqual(await a.call("dress", { items: "cape" }), { error: "not unlocked" });
  assert.deepEqual(await a.call("dress", { items: "crown-of-x" }), { error: "bad outfit" });
  assert.deepEqual(await a.call("dress", {}), { error: "bad request" });
  setCoins(r, room, 500);
  await a.call("buy", { item: "cape" });
  await a.call("buy", { item: "shades" });
  await a.call("buy", { item: "tophat" });
  const dressed = await a.call("dress", { items: "cape,shades,tophat" });
  assert.deepEqual(dressed.pet.wear, ["tophat", "shades", "cape"], "ordered head, face, neck");
  assert.deepEqual((await b.sync(0)).pet.wear, ["tophat", "shades", "cape"]);
  // two in one slot: the later wins
  await a.call("buy", { item: "beanie" });
  assert.deepEqual((await b.call("dress", { items: "tophat,beanie" })).pet.wear, ["beanie"]);
  assert.deepEqual((await b.call("dress", { items: "" })).pet.wear, []);
  // days together unlock the party hat
  await a.call("set", { since: "2026-01-01" }); // START is 2026-06-01: 151 days
  assert.deepEqual((await a.call("dress", { items: "party" })).pet.wear, ["party"]);
  assert.deepEqual(await a.call("dress", { items: "anniversary" }), { error: "not unlocked" });
  for (const id of Object.keys(FREE_OUTFITS)) assert.ok(!SHOP[id], `${id} is not also sold`);
});

test("play: Embers by score up to a per-game and per-day cap, a cooldown, best scores, a bit of love", async () => {
  const { r, a, b } = await world();
  assert.deepEqual(await a.call("play", { game: "pong", score: 3 }), { error: "bad game" });
  assert.deepEqual(await a.call("play", { game: "catch", score: -1 }), { error: "bad score" });
  assert.deepEqual(await a.call("play", { game: "catch", score: "1.5" }), { error: "bad score" });
  const p0 = (await a.sync(0)).pet;
  const g = await a.call("play", { game: "catch", score: 30 });
  assert.equal(g.ok, true);
  assert.equal(g.coins, Math.floor(30 * GAMES.catch.per));
  assert.equal(g.record, true);
  assert.equal(g.pet.best.catch, 30);
  assert.equal(g.pet.love, Math.min(100, p0.love + 5));
  assert.equal(g.pet.xp, p0.xp + 1);
  const soon = await a.call("play", { game: "catch", score: 10 });
  assert.equal(soon.error, "too soon");
  assert.equal((await b.call("play", { game: "catch", score: 10 })).record, false, "the cooldown is per side; 10 is no record");
  // an absurd score counts as the game's maximum and pays at most its cap
  r.advance(WORLD.gameCooldownMs);
  const huge = await a.call("play", { game: "memory", score: 99999 });
  assert.equal(huge.pet.best.memory, GAMES.memory.max);
  assert.equal(huge.coins, GAMES.memory.cap);
  // the day's cap per side
  let paid = g.coins + huge.coins;
  for (let i = 0; i < 10; i++) {
    r.advance(WORLD.gameCooldownMs);
    paid += (await a.call("play", { game: "seek", score: 15 })).coins;
  }
  assert.equal(paid, WORLD.gameCoinsPerDay);
  const capped = await (async () => { r.advance(WORLD.gameCooldownMs); return a.call("play", { game: "catch", score: 60 }); })();
  assert.equal(capped.coins, 0);
  assert.equal(capped.capped, true);
  // a new UTC day pays again
  r.advance(DAY);
  assert.ok((await a.call("play", { game: "catch", score: 60 })).coins > 0);
});

test("quests: three a day, the same for both partners, counted by actions, claimed once by either side", async () => {
  const { r, room, a, b } = await world();
  const day = "2026-06-01";
  const ids = questsFor(day, room);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(questsFor(day, room), ids, "deterministic");
  for (const id of ids) assert.ok(QUESTS[id]);
  // different days give different sets (over a month, at least a few distinct)
  const sets = new Set(Array.from({ length: 30 }, (_, i) => questsFor(`2026-07-${String(i + 1).padStart(2, "0")}`, room).join(",")));
  assert.ok(sets.size > 10);
  const drawn = await a.call("quests");
  assert.deepEqual(drawn.pet.quests.map((x) => x.id), ids);
  assert.deepEqual((await b.sync(0)).pet.quests.map((x) => x.id), ids);
  assert.deepEqual(await a.call("claim", { q: 0 }), { error: "not done yet" });
  assert.deepEqual(await a.call("claim", { q: 5 }), { error: "bad quest" });
  // Make quest 0 done in storage, then claim it.
  const h = r.storageOf("r:" + room).m.get("h");
  h.pet.q.p[0] = QUESTS[ids[0]].n;
  const claimed = await b.call("claim", { q: 0 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.coins, QUESTS[ids[0]].reward);
  assert.equal(claimed.pet.quests[0].claimed, true);
  assert.deepEqual(await a.call("claim", { q: 0 }), { error: "already claimed" });
  // the next UTC day draws new ones
  r.advance(DAY);
  assert.equal((await a.call("quests")).pet.quests.every((x) => !x.claimed && x.p === 0), true);
});

test("quests count the actions they name", async () => {
  // Find a room whose quests include care6 by pairing until one does (deterministic hash, few tries).
  let w;
  for (let i = 0; i < 40; i++) { w = await world(); if (questsFor("2026-06-01", w.room).includes("care6")) break; }
  const { r, a, b } = w;
  const at = questsFor("2026-06-01", w.room).indexOf("care6");
  assert.ok(at >= 0, "some room has care6");
  for (const c of [a, b]) for (const action of ["feed", "water", "pet"]) await c.call("care", { action });
  const p = (await a.sync(0)).pet;
  assert.equal(p.quests[at].p, 6);
  r.advance(MIN);
  assert.equal((await a.call("claim", { q: at })).ok, true);
});

test("gift: one partner buys it, only the other opens it, it lands in the shared inventory", async () => {
  const { r, room, a, b } = await world();
  setCoins(r, room, 100);
  const sent = await a.call("gift", { item: "honey_cake" });
  assert.equal(sent.ok, true);
  assert.equal(sent.pet.gift.from, "a");
  assert.equal(sent.pet.gift.item, "honey_cake");
  assert.equal(sent.pet.coins, 100 - SHOP.honey_cake.price);
  assert.deepEqual(await a.call("gift", { item: "smoothie" }), { error: "a gift is already waiting" });
  assert.deepEqual(await a.call("open"), { error: "it is for your partner" });
  const love0 = (await b.sync(0)).pet.love;
  const opened = await b.call("open");
  assert.equal(opened.ok, true);
  assert.equal(opened.item, "honey_cake");
  assert.equal(opened.pet.inv.honey_cake, 1);
  assert.equal(opened.pet.gift, null);
  assert.equal(opened.pet.love, Math.min(100, love0 + WORLD.giftLove));
  assert.ok(opened.stickers.includes("first_gift"));
  assert.deepEqual(await b.call("open"), { error: "no gift" });
});

test("stickers come once, and the diary keeps the last events in order", async () => {
  const { r, room, a, b } = await world();
  setCoins(r, room, 200);
  const bought = await a.call("buy", { item: "ball" });
  assert.deepEqual(bought.stickers, ["first_buy"]);
  assert.deepEqual((await a.call("buy", { item: "yarn" })).stickers, []);
  const p = (await b.sync(0)).pet;
  assert.ok(p.stickers.includes("first_buy"));
  for (const id of p.stickers) assert.ok(STICKERS.includes(id));
  const kinds = p.log.map((e) => e[2]);
  assert.deepEqual(kinds, ["buy", "sticker", "buy"]);
  assert.equal(p.log[0][1], "a");
  for (let i = 0; i < 40; i++) { r.advance(6 * MIN); await b.call("care", { action: "pet" }); }
  const log = (await a.sync(0)).pet.log;
  assert.equal(log.length, WORLD.logSize);
  assert.ok(log.every((e, i) => i === 0 || e[0] >= log[i - 1][0]));
});

test("the whole room row stays small with a full world", async () => {
  const { r, room, a } = await world();
  setCoins(r, room, 99999);
  for (const id of Object.keys(SHOP)) await a.call("buy", { item: id });
  for (const [id, it] of Object.entries(SHOP)) if (it.spot) await a.call("place", { spot: it.spot, item: id });
  for (let i = 0; i < 30; i++) { r.advance(6 * MIN); await a.call("care", { action: "feed" }); }
  const h = r.storageOf("r:" + room).m.get("h");
  assert.ok(JSON.stringify(h).length < 8000, `h is ${JSON.stringify(h).length} bytes`);
  assert.ok(JSON.stringify(petView(h.pet, r.clock.t)).length < 5000);
  assert.ok((await a.sync(0)).pet.stickers.includes("collector"));
});

test("world routes answer 200 JSON for bad rooms and keys like every other route", async () => {
  const { r, room, a } = await world();
  for (const route of ["buy", "gift", "open", "use", "place", "dress", "play", "claim", "quests"]) {
    const res = await r.raw(`/hearth/${route}?room=${room}&me=a&key=wrong`);
    assert.equal(res.status, 200);
    assert.equal(res.body.paired, false);
    const ok = await r.raw(a.path(route, {}));
    assert.equal(ok.status, 200, route);
    assert.ok(ok.body.ok === true || typeof ok.body.error === "string", `${route}: ${ok.text}`);
  }
  r.advance(SEC);
});
