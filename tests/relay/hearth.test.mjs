import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, pairCouple, client, SEC, MIN, HOUR, DAY } from "./harness.mjs";

const ROUTES = ["sync", "stroke", "undo", "clear", "unclear", "tap", "care", "set", "unpair", "reinvite"];

test("every route answers 200 JSON, never a non-2xx, for bad rooms, keys and parameters", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  const bad = [
    "", "?room=zzz&me=a&key=k", `?room=${room}&me=c&key=k`, `?room=${room}&me=a`, `?room=${room}&me=a&key=wrong`,
    `?room=${"0".repeat(32)}&me=a&key=${a.key}`, `?room=${room}&me=b&key=${a.key}`, "?room=" + "f".repeat(5000),
  ];
  for (const route of ROUTES) {
    for (const q of bad) {
      const res = await r.raw(`/hearth/${route}${q}`);
      assert.equal(res.status, 200, `${route}${q.slice(0, 40)}`);
      assert.ok(res.body.error || res.body.paired === false, `${route}${q.slice(0, 40)} -> ${res.text.slice(0, 80)}`);
    }
  }
  const unknown = await r.raw("/hearth/nope");
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { error: "not found" });
  const post = await r.raw(a.path("tap"), { method: "POST" });
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, { error: "GET only" });
});

test("bad room id or side is { error }; a wrong key or unknown room is paired:false and reveals nothing", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  assert.deepEqual(await r.get(`/hearth/sync?room=nope&me=a&key=${a.key}`), { error: "bad request" });
  assert.deepEqual(await r.get(`/hearth/sync?room=${room}&me=x&key=${a.key}`), { error: "bad request" });
  const wrongKey = await r.get(`/hearth/sync?room=${room}&me=a&key=nope`);
  const noRoom = await r.get(`/hearth/sync?room=${"1".repeat(32)}&me=a&key=nope`);
  assert.equal(wrongKey.paired, false);
  assert.deepEqual(Object.keys(wrongKey).sort(), Object.keys(noRoom).sort());
  assert.equal(wrongKey.reason, noRoom.reason);
  // a key only works for its own side
  assert.equal((await r.get(`/hearth/sync?room=${room}&me=b&key=${a.key}`)).paired, false);
});

test("a wrong key changes nothing", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  const evil = client(r, room, "a", "0".repeat(32));
  for (const route of ["tap", "set", "unpair", "clear"]) await evil.call(route, { names: "X,Y" });
  assert.equal((await a.sync()).names.a, "");
  assert.equal((await a.call("tap")).ok, true, "the real key still works, so unpair did not happen");
});

test("sync: first call is full, an idle call is a few bytes, then only what changed", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const first = await a.sync(0);
  assert.deepEqual(Object.keys(first).sort(), ["board", "names", "now", "pet", "petName", "rev", "taps", "together", "togetherSince"]);
  assert.deepEqual(first.names, { a: "", b: "" });
  assert.equal(first.board.reset, true);
  assert.deepEqual(first.board.strokes, []);

  const idle = await r.raw(a.path("sync", { since: first.rev }));
  assert.equal(idle.text, JSON.stringify({ rev: first.rev }));
  assert.ok(idle.text.length < 20, idle.text);

  assert.deepEqual(await b.call("set", { names: "Ada,Bo" }), { ok: true });
  const d1 = await a.sync(first.rev);
  assert.deepEqual(Object.keys(d1).sort(), ["names", "now", "rev"]);
  assert.deepEqual(d1.names, { a: "Ada", b: "Bo" });
  assert.equal(d1.rev, first.rev + 1);

  await b.call("tap");
  const d2 = await a.sync(d1.rev);
  assert.deepEqual(Object.keys(d2).sort(), ["now", "rev", "taps"]);
  assert.equal(d2.taps.b.n, 1);
  assert.equal(d2.taps.a.n, 0);
  assert.equal((await a.sync(d2.rev)).names, undefined);
});

test("an idle sync reads one small row and writes nothing", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  const { rev } = await a.sync(0);
  const st = r.storageOf("r:" + room);
  const before = { reads: st.reads, writes: st.writes };
  for (let i = 0; i < 20; i++) { r.advance(5 * MIN); await a.sync(rev); }
  assert.equal(st.writes, before.writes + 1, "one stamp refresh after the hour, no write per poll");
  assert.ok(st.reads - before.reads <= 20 * 3, "a few rows per poll");
});

test("sync with a since that is ahead of the room, or garbage, starts over", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  const full = await a.sync(0);
  assert.ok((await a.sync(full.rev + 50)).names);
  assert.ok((await a.sync("abc")).names);
  assert.ok((await a.sync(-3)).names);
});

test("set: names, since and petName with charset and length limits", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  assert.deepEqual(await a.call("set", { names: "Zoë,Renée-Ann", since: "2024-02-29", petName: "Mr. O'Blob 2" }), { ok: true });
  let s = await b.sync(0);
  assert.deepEqual(s.names, { a: "Zoë", b: "Renée-Ann" });
  assert.equal(s.togetherSince, "2024-02-29");
  assert.equal(s.petName, "Mr. O'Blob 2");

  // an empty half leaves that side alone; spaces are collapsed and trimmed
  await b.call("set", { names: "  Zed   Q  ," });
  assert.deepEqual((await b.sync(0)).names, { a: "Zed Q", b: "Renée-Ann" });

  const err = async (params) => (await a.call("set", params)).error;
  assert.equal(await err({ names: "x".repeat(21) + ",B" }), "bad name");
  assert.equal(await err({ names: "A,<b>" }), "bad name");
  assert.equal(await err({ names: "A;B,C" }), "bad name");
  assert.equal(await err({ names: "A" }), "names needs two parts: a,b");
  assert.equal(await err({ names: "A,B,C" }), "names needs two parts: a,b");
  assert.equal(await err({ petName: "" }), "bad name");
  assert.equal(await err({ petName: "a\nb<script>" }), "bad name");
  assert.equal(await err({ petName: "y".repeat(21) }), "bad name");
  assert.equal(await err({ since: "2024-02-30" }), "bad date");
  assert.equal(await err({ since: "yesterday" }), "bad date");
  assert.equal(await err({ since: "1969-12-31" }), "bad date");
  assert.equal(await err({ since: "2026-06-03" }), "bad date", "more than a day in the future");
  assert.equal(await err({}), "nothing to set");
  assert.deepEqual(await a.call("set", { names: "y".repeat(20) + ",", since: "2026-06-02" }), { ok: true });

  // rejected input changed nothing, not even the valid parts of the same call
  const before = await a.sync(0);
  assert.equal((await a.call("set", { names: "Fine,Fine", since: "nope" })).error, "bad date");
  assert.deepEqual((await a.sync(0)).names, before.names);
});

test("set: unchanged values do not bump the rev", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  await a.call("set", { names: "A,B", petName: "Pip" });
  const { rev } = await a.sync(0);
  await a.call("set", { names: "A,B", petName: "Pip" });
  assert.equal((await a.sync(0)).rev, rev);
});

test("tap: a together moment only when both sides tap within the window", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  assert.deepEqual(await a.call("tap"), { ok: true, together: false });
  r.advance(119 * SEC);
  assert.deepEqual(await b.call("tap"), { ok: true, together: true });
  let s = await a.sync(0);
  assert.equal(s.together.n, 1);
  assert.equal(s.together.at, r.clock.t);
  assert.equal(s.taps.a.n, 1);
  assert.equal(s.taps.b.n, 1);

  // the two taps are used up: a third tap does not pair with an old one
  r.advance(10 * SEC);
  assert.equal((await a.call("tap")).together, false);
  // ... but it can pair with a fresh peer tap
  r.advance(10 * SEC);
  assert.equal((await b.call("tap")).together, true);
  assert.equal((await a.sync(0)).together.n, 2);
});

test("tap: outside the window, or the same side twice, is no together moment", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  await a.call("tap");
  r.advance(121 * SEC);
  assert.equal((await b.call("tap")).together, false);
  assert.equal((await a.sync(0)).together.n, 0);

  r.advance(1 * SEC);
  assert.equal((await b.call("tap")).together, false, "the same side tapping again");
  assert.equal((await b.call("tap")).together, false);
  assert.equal((await a.sync(0)).together.n, 0);
  // the window is measured to the peer's latest tap
  r.advance(30 * SEC);
  assert.equal((await a.call("tap")).together, true);
});

test("tap: the window is configurable", async () => {
  const r = createRelay({ TOGETHER_WINDOW_S: "10" });
  const { a, b } = await pairCouple(r);
  await a.call("tap");
  r.advance(11 * SEC);
  assert.equal((await b.call("tap")).together, false);
  r.advance(9 * SEC);
  assert.equal((await a.call("tap")).together, true);
});

// ---------- pet ----------

test("pet: stats decay from server time, are the same for both clients, and clients cannot influence the clock", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const p0 = (await a.sync(0)).pet;
  assert.deepEqual([p0.food, p0.water, p0.love], [70, 70, 70]);
  r.advance(10 * HOUR);
  // idle sync: nothing is sent, but a full sync computes the decay from the server clock
  const p1 = (await b.sync(0)).pet;
  assert.equal(p1.food, Math.round(70 - 1.25 * 10));
  assert.equal(p1.water, Math.round(70 - 1.875 * 10));
  assert.equal(p1.love, Math.round(70 - 0.9375 * 10));
  assert.deepEqual((await a.sync(0)).pet, p1);
  assert.deepEqual(p1.decayPerHour, { food: 1.25, water: 1.875, love: 0.9375 });
  // client-supplied time parameters are ignored
  assert.deepEqual((await b.call("sync", { since: 0, now: 1, t: 1, at: 1 })).pet, p1);
});

test("pet: care raises the stat from its decayed value and is capped at 100", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  await a.sync(0); // the pet is born with the first Hearth call
  r.advance(20 * HOUR); // food 70-25 = 45, water 70-37.5 = 32.5, love 70-18.75 = 51.25
  const fed = await a.call("care", { action: "feed" });
  assert.equal(fed.ok, true);
  assert.equal(fed.pet.food, 80);
  assert.equal(fed.pet.water, Math.round(32.5));
  const watered = await a.call("care", { action: "water" });
  assert.equal(watered.pet.water, Math.round(32.5 + 35));
  const pet = await a.call("care", { action: "pet" });
  assert.equal(pet.pet.love, Math.round(51.25 + 25));
  // never above 100
  for (let i = 0; i < 4; i++) { r.advance(6 * MIN); await a.call("care", { action: "feed" }); }
  assert.equal((await a.sync(0)).pet.food, 100);
});

test("pet: it gets sad when neglected but never dies", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  assert.equal((await a.sync(0)).pet.mood, "happy");
  r.advance(12 * HOUR);
  assert.equal((await a.sync(0)).pet.mood, "content");
  r.advance(365 * DAY);
  const pet = (await a.sync(0)).pet;
  assert.deepEqual([pet.food, pet.water, pet.love], [10, 10, 10]);
  assert.equal(pet.mood, "sad");
  assert.ok(!JSON.stringify(pet).includes("dead"));
  // and it recovers
  const fed = await a.call("care", { action: "feed" });
  assert.equal(fed.pet.food, 45);
  r.advance(10 * HOUR);
  assert.ok((await a.sync(0)).pet.food >= 10);
});

test("pet: server clock going backwards never gives a stat above what it was", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  r.advance(-5 * HOUR);
  assert.deepEqual([(await a.sync(0)).pet.food], [70]);
});

test("pet: care has a cooldown per side and action, and rejects unknown actions", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  assert.equal((await a.call("care", { action: "feed" })).ok, true);
  const again = await a.call("care", { action: "feed" });
  assert.equal(again.error, "too soon");
  assert.equal(again.retryIn, 300);
  assert.equal((await b.call("care", { action: "feed" })).ok, true, "the other side has its own cooldown");
  assert.equal((await a.call("care", { action: "water" })).ok, true, "another action too");
  r.advance(5 * MIN);
  assert.equal((await a.call("care", { action: "feed" })).ok, true);
  assert.equal((await a.call("care", { action: "kill" })).error, "bad action");
  assert.equal((await a.call("care", {})).error, "bad action");
});

test("pet: the daily bond fills only when both partners cared, and keeps a streak", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const day1 = await a.call("care", { action: "pet" });
  assert.deepEqual([day1.pet.bond.a, day1.pet.bond.b, day1.pet.bond.done, day1.pet.bond.streak], [true, false, false, 0]);
  const xpBefore = day1.pet.xp;
  const both = await b.call("care", { action: "feed" });
  assert.equal(both.pet.bond.done, true);
  assert.equal(both.pet.bond.streak, 1);
  assert.equal(both.pet.xp, xpBefore + 1 + 5, "xp for the care itself and for the bond");

  r.advance(DAY);
  let s = (await a.sync(0)).pet;
  assert.deepEqual([s.bond.a, s.bond.b, s.bond.done], [false, false, false], "a new UTC day starts empty");
  assert.equal(s.bond.streak, 1, "yesterday still counts");
  await a.call("care", { action: "feed" });
  assert.equal((await b.call("care", { action: "feed" })).pet.bond.streak, 2);

  r.advance(3 * DAY);
  assert.equal((await a.sync(0)).pet.bond.streak, 0, "a missed day resets the streak");
  await a.call("care", { action: "feed" });
  assert.equal((await b.call("care", { action: "feed" })).pet.bond.streak, 1);
});

test("pet: level follows xp", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  const p = (await a.sync(0)).pet;
  assert.equal(p.level, 1);
  assert.equal(p.nextXp, 4);
});
