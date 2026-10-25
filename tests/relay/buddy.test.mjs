import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, MIN, DAY } from "./harness.mjs";

// The deployed Buddy widget depends on these exact shapes and behaviours. They must not change.

test("pair new -> join -> beat -> unpair keeps the Buddy contract", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  assert.deepEqual(Object.keys(a), ["code", "room", "me", "key", "ttl"]);
  assert.match(a.code, /^[A-HJ-KM-NP-Z2-9]{8}$/);
  assert.match(a.room, /^[0-9a-f]{32}$/);
  assert.equal(a.me, "a");
  assert.equal(a.ttl, 600);

  const b = await r.get("/pair?code=" + a.code.toLowerCase().replace(/(....)/, "$1-"));
  assert.deepEqual(Object.keys(b), ["room", "me", "key"]);
  assert.equal(b.room, a.room);
  assert.equal(b.me, "b");
  assert.notEqual(b.key, a.key);

  // the code is single use
  assert.deepEqual(await r.get("/pair?code=" + a.code), { error: "unknown or expired code" });

  const beatA = await r.get(`/beat?room=${a.room}&me=a&key=${a.key}&iv=45`);
  assert.deepEqual(beatA, { paired: true, peerSeen: 0, peerIv: 60, now: r.clock.t });
  r.advance(30_000);
  const beatB = await r.get(`/beat?room=${b.room}&me=b&key=${b.key}`);
  assert.deepEqual(beatB, { paired: true, peerSeen: r.clock.t - 30_000, peerIv: 45, now: r.clock.t });

  assert.deepEqual(await r.get(`/unpair?room=${a.room}&me=a&key=${a.key}`), { ok: true });
  assert.deepEqual(await r.get(`/beat?room=${b.room}&me=b&key=${b.key}`), { paired: false, now: r.clock.t });
  assert.deepEqual(await r.get(`/beat?room=${a.room}&me=a&key=${a.key}`), { paired: false, now: r.clock.t });
});

test("heartbeat interval is clamped to 30..600 s", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  const b = await r.get("/pair?code=" + a.code);
  await r.get(`/beat?room=${a.room}&me=a&key=${a.key}&iv=5`);
  assert.equal((await r.get(`/beat?room=${b.room}&me=b&key=${b.key}`)).peerIv, 30);
  await r.get(`/beat?room=${a.room}&me=a&key=${a.key}&iv=99999`);
  assert.equal((await r.get(`/beat?room=${b.room}&me=b&key=${b.key}`)).peerIv, 600);
});

test("Buddy errors stay as they were", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  assert.deepEqual(await r.get("/pair?code=SHORT"), { error: "bad code" });
  assert.deepEqual(await r.get("/pair?code=ZZZZZZZZ"), { error: "unknown or expired code" });
  assert.deepEqual(await r.get("/beat?room=nope&me=a&key=x"), { error: "bad request" });
  assert.deepEqual(await r.get(`/beat?room=${a.room}&me=c&key=x`), { error: "bad request" });
  assert.deepEqual(await r.get(`/beat?room=${a.room}&me=a&key=wrong`), { paired: false, now: r.clock.t });
  assert.deepEqual(await r.get(`/beat?room=${a.room}&me=a`), { paired: false, now: r.clock.t });
  assert.deepEqual(await r.get(`/beat?room=${"0".repeat(32)}&me=a&key=x`), { paired: false, now: r.clock.t });
  const nf = await r.raw("/something-else");
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: "not found" });
});

test("a pairing code expires after 10 minutes", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  r.advance(10 * MIN + 1);
  assert.deepEqual(await r.get("/pair?code=" + a.code), { error: "unknown or expired code" });
});

test("the code object and an unused room clean themselves up like before", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  const b = await r.get("/pair?code=" + a.code);
  await r.get(`/beat?room=${a.room}&me=a&key=${a.key}`);
  r.advance(29 * DAY);
  await r.fireAlarms();
  assert.equal((await r.get(`/beat?room=${b.room}&me=b&key=${b.key}`)).paired, true, "a room used within 30 days survives");
  r.advance(31 * DAY);
  await r.fireAlarms();
  assert.ok(r.roomEmpty(a.room), "idle for 30 days: deleted");
  assert.deepEqual(await r.get(`/beat?room=${a.room}&me=a&key=${a.key}`), { paired: false, now: r.clock.t });
});

test("a Buddy room that was never beaten is deleted after 30 days", async () => {
  const r = createRelay();
  const a = await r.get("/pair?new=1");
  r.advance(30 * DAY + MIN);
  await r.fireAlarms();
  assert.ok(r.roomEmpty(a.room));
  assert.ok(r.allEmpty());
});
