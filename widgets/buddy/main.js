// Buddy: heartbeat to a tiny relay (tools/buddy-relay) and show whether the paired friend is online.
// After deploying the relay, set RELAY here and the same host in widget.json permissions.hosts.
const RELAY = "umbra-buddy-relay.umbra-server.workers.dev";

const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const api = async (path, params) => {
  const r = await umbra.fetchJson(`https://${RELAY}/${path}?${new URLSearchParams(params)}`);
  if (r.error) throw new Error(r.error);
  return r;
};

let pair = null;        // { room, me, key, code?, codeExp? } saved in umbra.store
let peer = null;        // { online, seen } from the last good beat
let error = "";
let offline = false;
let busy = false;

const unconfigured = RELAY.includes("CHANGE-ME");

async function save(p) {
  pair = p;
  if (p) await umbra.store.set("pair", p); else await umbra.store.remove("pair");
}

function render() {
  const { you, friend } = umbra.options;
  if (unconfigured) {
    app.innerHTML = `<p class="hint">Deploy the relay in <b>tools/buddy-relay</b>, then set its host in this widget's <b>main.js</b> and <b>widget.json</b>.</p>`;
  } else if (!pair) {
    app.innerHTML = `
      <p class="hint">Pair with a friend: one of you creates a code, the other types it in.</p>
      <div class="actions"><button id="new" data-no-drag>Create code</button></div>
      <div class="actions"><input id="code" maxlength="9" placeholder="Enter friend's code" spellcheck="false" autocomplete="off"><button id="join" data-no-drag>Join</button></div>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}`;
    document.getElementById("new").onclick = createPair;
    document.getElementById("join").onclick = joinPair;
    document.getElementById("code").onkeydown = (e) => { if (e.key === "Enter") joinPair(); };
  } else {
    const waiting = pair.code && peer && !peer.seen && Date.now() < pair.codeExp;
    app.innerHTML = `
      <div class="row"><span class="dot on"></span><span class="name">${esc(you)}</span><span class="state">${offline ? "no connection" : "online"}</span></div>
      <div class="row"><span class="dot ${peer?.online ? "on" : ""}"></span><span class="name">${esc(friend)}</span><span class="state">${peer ? (peer.online ? "online" : peer.seen ? "offline" : "not joined yet") : "..."}</span></div>
      ${waiting ? `<div><div class="hint">Give your friend this code (valid 10 min):</div><div class="code">${esc(pair.code.slice(0, 4))}-${esc(pair.code.slice(4))}</div></div>` : ""}
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <div class="foot"><span></span><button class="link" id="unpair" data-no-drag>Unpair</button></div>`;
    document.getElementById("unpair").onclick = unpair;
  }
  umbra.rendered();
}

async function createPair() {
  if (busy) return; busy = true; error = "";
  try {
    const r = await api("pair", { new: 1 });
    await save({ room: r.room, me: r.me, key: r.key, code: r.code, codeExp: Date.now() + r.ttl * 1000 });
    peer = { online: false, seen: 0 };
    await beat();
  } catch (e) { error = "Could not reach the relay"; }
  busy = false; render();
}

async function joinPair() {
  if (busy) return; busy = true; error = "";
  const code = document.getElementById("code").value.trim();
  try {
    const r = await api("pair", { code });
    await save({ room: r.room, me: r.me, key: r.key });
    await beat();
  } catch (e) { error = /unknown|bad/.test(e.message) ? "Unknown or expired code" : "Could not reach the relay"; }
  busy = false; render();
}

async function unpair() {
  try { await api("unpair", { room: pair.room, me: pair.me, key: pair.key }); } catch { /* the relay forgets idle rooms anyway */ }
  await save(null); peer = null; error = ""; render();
}

async function beat() {
  if (!pair || unconfigured) return;
  try {
    const r = await api("beat", { room: pair.room, me: pair.me, key: pair.key, iv: umbra.settings.refreshSeconds });
    offline = false;
    if (!r.paired) { await save(null); peer = null; error = "Your friend unpaired"; return; }
    // Online if the friend beat within 2.5 of their own intervals; the relay's clock is the reference.
    const online = r.peerSeen > 0 && r.now - r.peerSeen < (r.peerIv * 2.5 + 10) * 1000;
    peer = { online, seen: r.peerSeen };
    error = "";
  } catch (e) { offline = true; }   // keep the last known state when the relay is unreachable
}

const loaded = umbra.ready.then(async () => { pair = await umbra.store.get("pair", null); });
umbra.every(async () => { await loaded; await beat(); render(); });
umbra.onSettings(render);
umbra.store.onChange(async () => { pair = await umbra.store.get("pair", null); peer = pair ? { online: false, seen: 0 } : null; render(); });
