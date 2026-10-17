// Umbra Buddy relay: a tiny Cloudflare Worker + Durable Object that pairs two people with a
// one-time code and tells each whether the other has sent a heartbeat recently.
// It stores random ids, secrets and timestamps only: no names, no accounts.
//
//   GET /pair?new=1                     -> { code, room, me:"a", key, ttl }      (start a pairing)
//   GET /pair?code=ABCD2345             -> { room, me:"b", key }                 (join; the code dies)
//   GET /beat?room=R&me=a|b&key=K&iv=60 -> { paired, peerSeen, peerIv, now }     (heartbeat + read peer)
//   GET /unpair?room=R&me=a|b&key=K     -> { ok }                                (peer sees paired:false)
//
// GET only, because widgets can only fetch with GET. Every response is JSON with status 200, errors as { error }
// (the host's fetch throws away the body of a non-2xx answer).

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
const CODE_TTL_MS = 10 * 60 * 1000;
const ROOM_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // a room nobody has beaten for 30 days is deleted

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const newCode = () => [...rand(8)].map((x) => ALPHABET[x % ALPHABET.length]).join("");
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const q = u.searchParams;
    const room = (name) => env.ROOMS.get(env.ROOMS.idFromName(name));
    const call = (stub, path, params) => stub.fetch("https://room/" + path + "?" + new URLSearchParams(params)).then((r) => r.json());

    if (u.pathname === "/pair" && q.get("new")) {
      const id = hex(rand(16)), ka = hex(rand(16)), kb = hex(rand(16)), code = newCode();
      await call(room("r:" + id), "init", { ka, kb });
      await call(room("c:" + code), "hold", { room: id, kb });
      return json({ code, room: id, me: "a", key: ka, ttl: CODE_TTL_MS / 1000 });
    }
    if (u.pathname === "/pair" && q.get("code")) {
      const code = q.get("code").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== 8) return json({ error: "bad code" });
      const r = await call(room("c:" + code), "claim", {});
      return r.room ? json({ room: r.room, me: "b", key: r.kb }) : json({ error: "unknown or expired code" });
    }
    if (u.pathname === "/beat" || u.pathname === "/unpair") {
      const id = q.get("room") || "", me = q.get("me");
      if (!/^[0-9a-f]{32}$/.test(id) || (me !== "a" && me !== "b")) return json({ error: "bad request" });
      return json(await call(room("r:" + id), u.pathname.slice(1), { me, key: q.get("key") || "", iv: q.get("iv") || "60" }));
    }
    return json({ error: "not found" }, 404);
  },
};

/** One Durable Object per pairing code and per room. Both kinds share this class. */
export class Room {
  constructor(state) {
    this.state = state;
    this.s = state.storage;
  }

  async fetch(req) {
    const u = new URL(req.url);
    const q = u.searchParams;
    const now = Date.now();
    switch (u.pathname) {
      case "/init":
        await this.s.put({ ka: q.get("ka"), kb: q.get("kb"), seenA: 0, seenB: 0, ivA: 60, ivB: 60, gone: false });
        await this.s.setAlarm(now + ROOM_IDLE_MS);
        return Response.json({ ok: true });

      case "/hold": // a pairing code: valid once, for 10 minutes
        await this.s.put({ room: q.get("room"), kb: q.get("kb"), exp: now + CODE_TTL_MS });
        await this.s.setAlarm(now + CODE_TTL_MS);
        return Response.json({ ok: true });

      case "/claim": {
        const c = await this.s.get(["room", "kb", "exp"]);
        await this.s.deleteAll();
        if (!c.get("room") || c.get("exp") < now) return Response.json({});
        return Response.json({ room: c.get("room"), kb: c.get("kb") });
      }

      case "/beat":
      case "/unpair": {
        const me = q.get("me"), peer = me === "a" ? "b" : "a";
        const v = await this.s.get(["ka", "kb", "gone", "seenA", "seenB", "ivA", "ivB"]);
        if (!v.get("ka")) return Response.json({ paired: false, now });
        if (q.get("key") !== v.get("k" + me) || !q.get("key")) return Response.json({ paired: false, now });
        if (u.pathname === "/unpair") {
          await this.s.put("gone", true);
          return Response.json({ ok: true });
        }
        if (v.get("gone")) return Response.json({ paired: false, now });
        const iv = Math.min(600, Math.max(30, Number(q.get("iv")) || 60));
        await this.s.put({ ["seen" + me.toUpperCase()]: now, ["iv" + me.toUpperCase()]: iv });
        const P = peer.toUpperCase();
        return Response.json({ paired: true, peerSeen: v.get("seen" + P), peerIv: v.get("iv" + P), now });
      }
    }
    return Response.json({}, { status: 404 });
  }

  /** Expired codes and abandoned rooms clean themselves up. */
  async alarm() {
    const v = await this.s.get(["seenA", "seenB", "ka"]);
    if (v.get("ka")) {
      const last = Math.max(v.get("seenA") || 0, v.get("seenB") || 0);
      if (Date.now() - last < ROOM_IDLE_MS && last) return void (await this.s.setAlarm(last + ROOM_IDLE_MS));
    }
    await this.s.deleteAll();
  }
}
