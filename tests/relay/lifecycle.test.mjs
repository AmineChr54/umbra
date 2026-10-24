import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, pairCouple, client, rec, SEC, MIN, HOUR, DAY } from "./harness.mjs";

const GRACE = 7 * DAY;

test("unpair: the room is kept for 7 days, the other side is told, then everything is deleted", async () => {
  const r = createRelay();
  const { room, a, b } = await pairCouple(r);
  await a.call("set", { names: "A,B", since: "2025-01-01", petName: "Pip" });
  await a.call("stroke", { s: rec(1, 1, [[1, 1], [2, 2]]) });

  const left = await b.call("unpair");
  assert.deepEqual(left, { ok: true, graceUntil: r.clock.t + GRACE });

  const peerView = await a.sync(0);
  assert.deepEqual(peerView, { paired: false, reason: "unpaired", by: "peer", graceUntil: r.clock.t + GRACE, now: r.clock.t });
  assert.equal((await b.sync(0)).by, "you");
  for (const route of ["tap", "stroke", "set", "care", "undo", "clear"]) {
    assert.equal((await a.call(route, { s: "0.0.1.1", names: "X,Y", action: "feed" })).paired, false, route);
  }
  assert.deepEqual(await b.call("unpair"), { ok: true, graceUntil: r.clock.t + GRACE }, "unpairing twice does not extend the grace period");

  r.advance(GRACE - MIN);
  await r.fireAlarms();
  assert.ok(!r.roomEmpty(room), "still kept just before the 7 days are over");
  assert.ok(r.storageOf("r:" + room).m.has("h"));

  r.advance(2 * MIN);
  await r.fireAlarms();
  assert.ok(r.roomEmpty(room), "gone after 7 days");
  assert.deepEqual(await a.sync(0), { paired: false, reason: "unknown", now: r.clock.t });
});

test("unpair: a room that is unpaired late in its life still dies 7 days after the unpair, not before", async () => {
  const r = createRelay();
  const { room, a, b } = await pairCouple(r);
  r.advance(25 * DAY);
  await a.sync(0);
  await a.call("unpair");
  r.advance(6 * DAY);
  await r.fireAlarms();
  assert.ok(!r.roomEmpty(room));
  r.advance(1 * DAY + MIN);
  await r.fireAlarms();
  assert.ok(r.roomEmpty(room));
  assert.equal((await b.sync(0)).paired, false);
});

test("reinvite: rebinds the other side with a one-time code and invalidates its old key", async () => {
  const r = createRelay();
  const { room, a, b } = await pairCouple(r);
  await a.call("set", { names: "A,B" });
  await a.call("stroke", { s: rec(1, 1, [[5, 5]]) });
  const oldKey = b.key;

  const inv = await a.call("reinvite");
  assert.deepEqual(Object.keys(inv).sort(), ["code", "rebinds", "ttl"]);
  assert.match(inv.code, /^[A-HJ-KM-NP-Z2-9]{8}$/);
  assert.equal(inv.rebinds, "b");
  assert.equal(inv.ttl, 600);

  // the old key of b is dead immediately, a's key is untouched
  assert.equal((await b.sync(0)).paired, false);
  assert.equal((await a.sync(0)).names.b, "B");

  const joined = await r.get("/pair?code=" + inv.code);
  assert.deepEqual(Object.keys(joined), ["room", "me", "key"]);
  assert.equal(joined.room, room);
  assert.equal(joined.me, "b");
  assert.notEqual(joined.key, oldKey);
  assert.notEqual(joined.key, a.key);
  assert.deepEqual(await r.get("/pair?code=" + inv.code), { error: "unknown or expired code" }, "single use");

  // the new PC picks up the whole shared state
  const b2 = client(r, joined.room, joined.me, joined.key);
  const full = await b2.sync(0);
  assert.deepEqual(full.names, { a: "A", b: "B" });
  assert.equal(full.board.strokes.length, 1);
  assert.equal((await b.sync(0)).paired, false, "the old key stays dead");
  assert.equal((await a.call("tap")).ok, true);
  assert.equal((await b2.sync(full.rev)).taps.a.n, 1);
});

test("reinvite from either side rebinds the other one", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  const inv = await b.call("reinvite");
  assert.equal(inv.rebinds, "a");
  const joined = await r.get("/pair?code=" + inv.code);
  assert.equal(joined.me, "a");
  assert.equal((await a.sync(0)).paired, false);
  assert.equal((await client(r, joined.room, "a", joined.key).sync(0)).paired, undefined);
  assert.equal((await b.sync(0)).rev > 0, true);
});

test("reinvite code expires after 10 minutes; asking again replaces the key again", async () => {
  const r = createRelay();
  const { a } = await pairCouple(r);
  const first = await a.call("reinvite");
  r.advance(10 * MIN + 1);
  assert.deepEqual(await r.get("/pair?code=" + first.code), { error: "unknown or expired code" });
  const second = await a.call("reinvite");
  const joined = await r.get("/pair?code=" + second.code);
  assert.equal(joined.me, "b");
});

test("reinvite after the partner unpaired: the room is active again and the grace period no longer applies", async () => {
  const r = createRelay();
  const { room, a, b } = await pairCouple(r);
  await a.call("set", { names: "A,B" });
  await b.call("unpair");
  assert.equal((await a.sync(0)).paired, false);

  r.advance(2 * DAY);
  const inv = await a.call("reinvite");
  assert.equal(inv.rebinds, "b");
  assert.equal((await a.sync(0)).names.a, "A", "the room is paired again for the side that stayed");
  const joined = await r.get("/pair?code=" + inv.code);
  const b2 = client(r, room, "b", joined.key);
  assert.equal((await b2.sync(0)).names.b, "B");
  assert.equal((await b.sync(0)).paired, false, "the key of the side that left stays invalid");

  // the original 7-day alarm fires and finds a living room
  r.advance(6 * DAY);
  await a.sync(0);
  await r.fireAlarms();
  assert.ok(!r.roomEmpty(room));
  assert.equal((await b2.call("tap")).ok, true);
});

test("reinvite: the side that left cannot invite itself back, and a wrong key gets no code", async () => {
  const r = createRelay();
  const { a, b } = await pairCouple(r);
  await b.call("unpair");
  const before = r.objects.size;
  assert.equal((await b.call("reinvite")).paired, false);
  const wrong = await client(r, a.room, "a", "f".repeat(32)).call("reinvite");
  assert.equal(wrong.paired, false);
  assert.equal(wrong.code, undefined);
  assert.equal(r.objects.size, before, "no pairing-code object was created");
  assert.equal((await a.call("reinvite")).rebinds, "b", "the side that stayed can");
});

test("reinvite does not disturb Buddy codes", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  const b = await r.get("/pair?code=" + a.code);
  assert.equal(b.me, "b");
  assert.equal((await r.get(`/beat?room=${a.room}&me=a&key=${a.key}`)).paired, true);
});

test("an unused room, or one nobody touches for 30 days, deletes itself; use keeps it alive", async () => {
  const r = createRelay();
  const used = await pairCouple(r);
  const idle = await pairCouple(r);
  for (let day = 0; day < 100; day += 10) {
    await used.a.sync(0);
    r.advance(10 * DAY);
    await r.fireAlarms();
  }
  assert.ok(r.roomEmpty(idle.room), "never used after pairing: gone after 30 days");
  assert.ok(!r.roomEmpty(used.room), "used every 10 days: still there after 100");
  assert.equal((await used.b.sync(0)).paired, undefined);
  r.advance(31 * DAY);
  await r.fireAlarms();
  assert.ok(r.roomEmpty(used.room), "30 days of silence");
});

test("a Hearth call counts as use even when it is only an idle poll", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  const { rev } = await a.sync(0);
  for (let i = 0; i < 40; i++) { r.advance(DAY); await a.sync(rev); await r.fireAlarms(); }
  assert.ok(!r.roomEmpty(room));
});

test("the whole room, strokes included, is deleted", async () => {
  const r = createRelay();
  const { room, a } = await pairCouple(r);
  for (let i = 0; i < 5; i++) await a.call("stroke", { s: rec(1, 1, [[i, i]]) });
  r.advance(31 * DAY);
  await r.fireAlarms();
  assert.equal(r.storageOf("r:" + room).m.size, 0);
  assert.ok(r.allEmpty());
});

test("the pairing code object is deleted when it expires", async () => {
  const r = createRelay();
  const { code } = await pairCouple(r); // already claimed: empty
  const open = await r.get("/pair?new=1");
  r.advance(11 * MIN);
  await r.fireAlarms();
  assert.equal(r.storageOf("c:" + open.code).m.size, 0);
  assert.equal(r.storageOf("c:" + code).m.size, 0);
});
