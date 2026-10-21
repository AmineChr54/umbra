// Buddy: two stars. Heartbeat to a tiny relay (tools/buddy-relay); a star glows while that person is online.
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

// Hand-traced marker stars (viewBox 150): one self-crossing stroke each.
const STAR1 = "M78 22 L46 118 L136 52 L18 74 L106 116 Z";
const STAR2 = "M80 26 L36 120 L132 56 L22 70 L112 112 L84 30";
const star = (cls, d, tip) => `<svg class="star ${cls}" viewBox="0 0 150 150" aria-label="${esc(tip)}"><title>${esc(tip)}</title><path d="${d}"/></svg>`;

let names = null;       // { you, friend } overrides saved from the menu; options are the fallback
let pop = null;         // { type: "menu" | "join" | "names", x, y } while a popup is open
let toast = "";

const nm = () => ({ you: names?.you || umbra.options.you, friend: names?.friend || umbra.options.friend });

function render() {
  const { you, friend } = nm();
  const meOn = !!pair && !offline && !unconfigured;
  const friendOn = !!pair && !!peer?.online;
  const waiting = pair?.code && peer && !peer.seen && Date.now() < pair.codeExp;
  let html = star(meOn ? "on" : "", STAR1, you) + star(friendOn ? "on" : "", STAR2, friend);
  if (unconfigured) toast = "Relay not configured";
  const note = error || toast || (waiting ? `${pair.code.slice(0, 4)}-${pair.code.slice(4)}` : "");
  if (note && !pop) html += `<div class="toast${waiting && !error && !toast ? " code" : ""}" data-no-drag>${esc(note)}</div>`;
  if (pop) html += popup();
  app.innerHTML = html;
  bindPopup();
  umbra.rendered();
}

function popup() {
  const pos = `left:${pop.x}px;top:${pop.y}px`;
  if (pop.type === "join") return `<div class="pop" style="${pos}" data-no-drag><input id="code" maxlength="9" placeholder="Friend's code" spellcheck="false" autocomplete="off"><button id="go">Join</button></div>`;
  if (pop.type === "names") { const n = nm(); return `<div class="pop col" style="${pos}" data-no-drag><input id="n-you" maxlength="24" value="${esc(n.you)}" placeholder="Your name"><input id="n-friend" maxlength="24" value="${esc(n.friend)}" placeholder="Friend's name"><button id="go">Save</button></div>`; }
  const items = pair
    ? [["names", "Edit names"], ["unpair", "Unpair"]]
    : [["new", "Create code"], ["join", "Enter code"], ["names", "Edit names"]];
  return `<div class="pop menu" style="${pos}" data-no-drag>${items.filter(Boolean).map(([k, t]) => `<button data-act="${k}">${t}</button>`).join("")}</div>`;
}

function bindPopup() {
  if (!pop) return;
  const go = document.getElementById("go");
  const first = document.querySelector(".pop input");
  if (first) first.focus();
  if (pop.type === "join" && go) {
    go.onclick = joinPair;
    document.getElementById("code").onkeydown = (e) => { if (e.key === "Enter") joinPair(); };
  } else if (pop.type === "names" && go) {
    go.onclick = async () => {
      names = { you: document.getElementById("n-you").value.trim(), friend: document.getElementById("n-friend").value.trim() };
      await umbra.store.set("names", names); pop = null; render();
    };
  }
  document.querySelectorAll(".pop [data-act]").forEach((b) => b.onclick = () => act(b.dataset.act));
}

function act(k) {
  const at = { x: pop.x, y: pop.y };
  pop = null; error = ""; toast = "";
  if (k === "new") createPair();
  else if (k === "join") { pop = { type: "join", ...at }; render(); }
  else if (k === "names") { pop = { type: "names", ...at }; render(); }
  else if (k === "unpair") unpair();
  else render();
}

document.addEventListener("contextmenu", (e) => {
  if (e.shiftKey) return;              // Shift+right-click keeps the Umbra menu (Refresh, Lock, Remove...)
  e.preventDefault();
  pop = { type: "menu", x: Math.min(e.clientX, innerWidth - 130), y: Math.min(e.clientY, innerHeight - 150) };
  render();
});
document.addEventListener("pointerdown", (e) => { if (pop && !e.target.closest(".pop")) { pop = null; render(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) { pop = null; render(); } });

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
    pop = null;
    await beat();
  } catch (e) { error = /unknown|bad/.test(e.message) ? "Unknown or expired code" : "Could not reach the relay"; pop = null; }
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

const loaded = umbra.ready.then(async () => { pair = await umbra.store.get("pair", null); names = await umbra.store.get("names", null); });
umbra.every(async () => { await loaded; await beat(); if (!pop || pop.type === "menu") render(); });
umbra.onSettings(render);
umbra.store.onChange(async () => { names = await umbra.store.get("names", null); pair = await umbra.store.get("pair", null); peer = pair ? { online: false, seen: 0 } : null; render(); });
