// Hearth pet extras: the HTML of the world's panels (Play, Shop, Room, Quests, Stickers, Diary, Tricks) and the pet's
// idle life in the room (walking, looking at the pointer, idle acts, pokes and rubs). pet.js owns the state and the calls;
// this file only draws and animates. Everything a click does goes back through data-act attributes to pet.js.
(() => {
  "use strict";
  const WL = window.HearthWorldLogic;
  const M = window.HearthMascot;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ember = (n) => `<span class="pt-ember num"><svg viewBox="0 0 12 14" aria-hidden="true"><path d="M6 13 C1.5 12 1 7.5 3.5 5 C3.5 7 5 7.5 5.5 6 C6 4.5 5.3 2.5 7 1 C7.6 3.5 11 5.5 10.6 9 C10.3 11.6 8.6 13 6 13 Z" fill="#F2A04B" stroke="#6B4F3A" stroke-width="1.2" stroke-linejoin="round"/></svg>${esc(n)}</span>`;
  const head = (title, extra) => `<div class="pt-head"><h3>${title}</h3>${extra || ""}<button class="btn primary" data-act="sheet-close" data-no-drag>Done</button></div>`;
  const tabs = (cur, list) => `<div class="px-tabs">${list.map(([id, label]) => `<button class="px-tab${id === cur ? " on" : ""}" data-act="panel" data-panel="${id}" data-no-drag>${label}</button>`).join("")}</div>`;

  /** A small picture of an item for the shop and the room. */
  function itemArt(id) {
    const it = WL.CATALOG[id];
    if (!it) return "";
    if (it.cat === "outfit") return M.renderSvg({ mood: "content", outfit: [id], level: 5 });
    const room = it.spot ? { [it.spot]: id } : {};
    const view = { wallpaper: "-40 -30 120 120", rug: "40 160 160 60", window: "0 10 80 90", wall: "166 20 70 70", mantel: "70 -16 100 54", floorL: "4 110 64 90", floorR: "178 96 56 100", toy: "34 152 48 50" }[it.spot];
    if (view) {
      const svg = window.HearthWorld.renderRoom({ room, phase: "day", season: "summer", mood: "content", level: 1 });
      return svg.replace(/viewBox="0 0 240 240"/, `viewBox="${view}" preserveAspectRatio="xMidYMid slice"`);
    }
    const color = { berry_tart: "#E5648F", honey_cake: "#F2C14E", fish_snack: "#9ED3EE", smoothie: "#F7A8C4", cocoa: "#B98563", star_candy: "#FFF3B0" }[id] || "#F7A8C4";
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="31" rx="15" ry="5" fill="#fff" stroke="#6B4F3A" stroke-width="2"/>` +
      (id === "star_candy" ? `<path d="M20 6 L24 16 L34 16 L26 22 L29 32 L20 26 L11 32 L14 22 L6 16 L16 16 Z" fill="${color}" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/>`
        : id === "smoothie" || id === "cocoa" ? `<path d="M12 10 H28 L26 30 H14 Z" fill="${color}" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/><path d="M22 10 L26 3" stroke="#6B4F3A" stroke-width="2"/>`
          : id === "fish_snack" ? `<path d="M8 22 Q18 10 28 22 Q18 34 8 22 Z M28 22 L35 16 V28 Z" fill="${color}" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="20" r="1.6" fill="#4A3426"/>`
            : `<path d="M8 28 Q8 14 20 12 Q32 14 32 28 Z" fill="${color}" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="10" r="3.4" fill="#E5648F" stroke="#6B4F3A" stroke-width="1.6"/>`) + `</svg>`;
  }

  function sticker(id, have) {
    const s = WL.STICKERS[id];
    const g = {
      play: "M15 11 L27 18 L15 25 Z", cake: "M10 22 H26 V28 H10 Z M12 16 H24 V22 H12 Z M18 10 V16", coin: "M18 10 A8 8 0 1 0 18.1 10 Z", gift: "M10 16 H26 V28 H10 Z M8 12 H28 V16 H8 Z M18 12 V28",
      flag: "M12 28 V9 M12 10 H25 L21 15 L25 20 H12", house: "M9 19 L18 10 L27 19 M12 17 V28 H24 V17", hat: "M10 26 H26 M13 26 V14 H23 V26", flame: "M18 28 C10 26 10 18 14 14 C14 18 17 19 18 16 C19 13 17 10 20 7 C22 12 27 15 26 21 C25 26 22 28 18 28 Z",
      star: "M18 7 L21 15 L29 15 L23 20 L25 28 L18 23 L11 28 L13 20 L7 15 L15 15 Z", crown: "M9 26 L8 12 L14 18 L18 10 L22 18 L28 12 L27 26 Z", berry: "M18 28 A8 8 0 1 0 18.1 28 Z M18 12 Q22 7 26 9",
      eye: "M7 18 Q18 8 29 18 Q18 28 7 18 Z M18 15 A3 3 0 1 0 18.1 15 Z", box: "M9 14 H27 V28 H9 Z M9 14 L13 9 H23 L27 14",
    }[s.glyph] || "M18 10 A8 8 0 1 0 18.1 10 Z";
    return `<div class="px-sticker${have ? "" : " locked"}" title="${esc(s.label + ": " + s.how)}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="${have ? s.color : "#EEE"}" stroke="#6B4F3A" stroke-width="2"/>` +
      `<path d="${g}" fill="${have ? "#fff" : "none"}" stroke="#6B4F3A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg><b>${esc(s.label)}</b><span>${esc(have ? "Earned" : s.how)}</span></div>`;
  }

  /**
   * The HTML of a panel. ctx: { world, panel, sub, level, me, names, petName, err, busy, local (best scores on an old relay) }.
   */
  function panelHtml(ctx) {
    const w = ctx.world, pet = ctx.petName || "the blob";
    const coins = w ? ember(w.coins) : "";
    const msg = ctx.err ? `<p class="pt-err" role="alert">${esc(ctx.err)}</p>` : "";
    switch (ctx.panel) {
      case "play": {
        const rows = WL.GAME_IDS.map((id) => {
          const g = WL.GAMES[id];
          const best = w ? w.best[id] || 0 : (ctx.local && ctx.local[id]) || 0;
          return `<div class="px-row"><div class="px-txt"><b>${g.label}</b><span>${esc(g.how)}</span><span class="num">Best: ${best} ${g.unit}${w ? ` · up to ${g.cap} Embers` : ""}</span></div>` +
            `<button class="btn primary" data-act="game" data-game="${id}" data-no-drag>Play</button></div>`;
        }).join("");
        return `<div class="pt-form px">${head("Play", coins)}${msg}${rows}${w ? "" : `<p class="pt-muted">Scores stay on this PC until the relay knows the pet's world.</p>`}</div>`;
      }
      case "result": {
        const r = ctx.result || {};
        const g = WL.GAMES[r.game] || {};
        return `<div class="pt-form px px-result">${head(g.label || "Game")}<p class="px-big num">${r.score} ${esc(g.unit || "")}</p>` +
          (r.record ? `<p><b>New best!</b></p>` : "") + (r.coins ? `<p>${ember("+" + r.coins)} earned for ${esc(pet)} and you two.</p>` : r.capped ? `<p class="pt-muted">That's all the Embers games pay today. Play for fun!</p>` : "") +
          (r.err ? `<p class="pt-err">${esc(r.err)}</p>` : "") +
          `<div class="pt-row"><button class="btn primary" data-act="game" data-game="${r.game}" data-no-drag>Again</button><button class="btn" data-act="panel" data-panel="play" data-no-drag>Other games</button></div></div>`;
      }
      case "shop": {
        const cat = ctx.sub || "treat";
        const tiles = WL.itemsFor(cat).map((id) => {
          const it = WL.CATALOG[id], n = (w && w.inv[id]) || 0;
          const own = it.cat !== "treat" && n > 0;
          const afford = w && w.coins >= it.price;
          return `<div class="px-item${own ? " own" : ""}"><span class="px-art">${itemArt(id)}</span><b>${esc(it.label)}</b>` +
            `<span class="px-note">${esc(it.note || (it.cat === "treat" ? "" : own ? "Yours" : ""))}${it.cat === "treat" && n ? ` · have ${n}` : ""}</span>` +
            `<span class="px-buy">${own ? (it.cat === "outfit" ? `<button class="btn" data-act="wear" data-id="${id}" data-no-drag>Wear</button>` : `<button class="btn" data-act="panel" data-panel="room" data-no-drag>Place</button>`)
              : `<button class="btn${afford ? " primary" : ""}" data-act="buy" data-id="${id}" data-no-drag ${afford && !ctx.busy ? "" : "disabled"}>${ember(it.price)}</button>`}` +
            (it.cat === "treat" && n ? `<button class="btn primary" data-act="use" data-id="${id}" data-no-drag ${ctx.busy ? "disabled" : ""}>Give</button>` : "") +
            (!w || w.gift ? "" : `<button class="btn quiet px-giftbtn" data-act="gift" data-id="${id}" data-no-drag title="Wrap it as a gift for ${esc((ctx.names && ctx.names.partner) || "your partner")}" ${afford && !ctx.busy ? "" : "disabled"}>Gift</button>`) +
            `</span></div>`;
        }).join("");
        return `<div class="pt-form px">${head("Shop", coins)}${tabs(cat, WL.CATEGORIES.map((c) => ["shop:" + c.id, c.label]))}${msg}<div class="px-grid">${tiles}</div>` +
          `<p class="pt-muted">Embers are shared: you both earn them by caring, playing and finishing quests. Gifts wait in the room until your partner opens them.</p></div>`;
      }
      case "room": {
        const rows = WL.SPOTS.map((s) => {
          const items = WL.itemsForSpot(s.id).filter((id) => w.inv[id] > 0);
          const cur = w.room[s.id] || "";
          const chips = [`<button class="px-chip${cur ? "" : " on"}" data-act="place" data-spot="${s.id}" data-id="" data-no-drag>None</button>`]
            .concat(items.map((id) => `<button class="px-chip${cur === id ? " on" : ""}" data-act="place" data-spot="${s.id}" data-id="${id}" data-no-drag>${esc(WL.label(id))}</button>`));
          return `<div class="px-spot"><b>${s.label}</b><div class="px-chips">${items.length ? chips.join("") : `<span class="pt-muted">Nothing yet. <button class="px-link" data-act="panel" data-panel="shop:${s.id === "toy" ? "toy" : "decor"}" data-no-drag>Shop</button></span>`}</div></div>`;
        }).join("");
        return `<div class="pt-form px">${head("Room", coins)}${msg}${rows}<p class="pt-muted">The room is shared: your partner sees it too.</p></div>`;
      }
      case "quests": {
        const qs = w.quests;
        const rows = qs ? qs.map((q, i) => `<div class="px-row"><div class="px-txt"><b>${esc(WL.questText(q.id, pet))}</b>` +
          `<span class="pt-bar"><i style="width:${Math.round((Math.min(q.p, q.n) / q.n) * 100)}%"></i></span><span class="num">${Math.min(q.p, q.n)}/${q.n}</span></div>` +
          (q.claimed ? `<span class="px-done">Done</span>` : `<button class="btn${q.p >= q.n ? " primary" : ""}" data-act="claim" data-q="${i}" data-no-drag ${q.p >= q.n && !ctx.busy ? "" : "disabled"}>${ember("+" + q.reward)}</button>`) + `</div>`).join("")
          : `<p class="pt-muted">Loading today's quests...</p>`;
        return `<div class="pt-form px">${head("Today's quests", coins)}${msg}${rows}<p class="pt-muted">New quests every day (UTC). Either of you can claim one, once.</p></div>`;
      }
      case "stickers": {
        const have = new Set(w.stickers);
        return `<div class="pt-form px">${head(`Stickers <span class="num pt-muted">${have.size}/${WL.STICKER_IDS.length}</span>`)}<div class="px-stickers">${WL.STICKER_IDS.map((id) => sticker(id, have.has(id))).join("")}</div></div>`;
      }
      case "diary": {
        const now = Date.now();
        const rows = w.log.slice().reverse().map((e) => `<li><span>${esc(WL.diaryLine(e, ctx.me, ctx.names, pet))}</span><time class="num">${esc(WL.ago(e[0], now))}</time></li>`).join("");
        return `<div class="pt-form px">${head(`${esc(pet)}'s diary`)}${rows ? `<ul class="px-diary">${rows}</ul>` : `<p class="pt-muted">Nothing yet. Everything you two do with ${esc(pet)} shows up here.</p>`}` +
          (w.born ? `<p class="pt-muted">Hatched ${esc(new Date(w.born).toLocaleDateString(window.umbra && umbra.locale || undefined, { day: "numeric", month: "long", year: "numeric" }))}.</p>` : "") + `</div>`;
      }
      case "tricks": {
        const list = WL.tricksFor(ctx.level).map((t) => `<button class="px-chip${t.unlocked ? "" : " locked"}" data-act="trick" data-trick="${t.id}" data-no-drag ${t.unlocked ? "" : "disabled"} title="${t.unlocked ? "" : "Level " + t.level}">${esc(t.label)}${t.unlocked ? "" : ` <small>Lv ${t.level}</small>`}</button>`).join("");
        return `<div class="pt-form px">${head("Tricks")}<div class="px-chips">${list}</div><p class="pt-muted">${esc(pet)} learns a new trick as it grows. Click it in the room to poke it, or hold and rub to make it purr.</p></div>`;
      }
      case "more": {
        const b = (panel, label, sub) => `<button class="px-menu" data-act="panel" data-panel="${panel}" data-no-drag><b>${label}</b><span>${sub}</span></button>`;
        const claim = w ? WL.claimable(w).length : 0;
        return `<div class="pt-form px">${head("More", coins)}<div class="px-menus">` +
          (w ? b("quests", "Quests" + (claim ? ` <i class="px-dot">${claim}</i>` : ""), "Three a day, for Embers") + b("room", "Room", "Place what you bought") +
            b("stickers", "Stickers", `${w.stickers.length} of ${WL.STICKER_IDS.length}`) + b("diary", "Diary", "What you two did") : "") +
          b("tricks", "Tricks", "Show what it learned") + b("outfits", "Outfit", "Dress it up") + `</div></div>`;
      }
    }
    return "";
  }

  // ---------- idle life in the room ----------

  /**
   * Starts the pet's life in a stage element. api: { mount() -> world mount, state() -> { asleep, level, toy, motion },
   * poke(kind), }. Returns stop(). Idle acts only while the widget is visible; nothing runs with motion off.
   */
  function life(stage, api) {
    let timer = 0, stopped = false, pokes = [], down = null, rubbed = 0;
    const off = () => document.documentElement.getAttribute("data-motion") === "off";
    function idle() {
      if (stopped) return;
      timer = setTimeout(idle, 9000 + Math.random() * 14000);
      const m = api.mount();
      if (!m || document.hidden || off()) return;
      const s = api.state();
      if (s.asleep) { if (Math.random() < 0.3) m.act("yawn", 1600); return; }
      const acts = ["walk", "walk", "walk", "look", "hop", "stretch", "sing", "butterfly"];
      if (s.toy) acts.push("play", "play");
      if (s.books) acts.push("read");
      const a = acts[Math.floor(Math.random() * acts.length)];
      if (a === "walk") m.walk((Math.random() * 2 - 1) * 42);
      else if (a === "look") { m.look(-1, 0); setTimeout(() => m.look(1, 0), 900); setTimeout(() => m.look(0, 0), 1800); }
      else m.act(a, a === "butterfly" ? 4300 : a === "read" ? 5000 : 2400);
    }
    // Eyes follow the pointer while it is over the room.
    function onMove(e) {
      const m = api.mount();
      if (!m || api.state().asleep) return;
      const svg = m.svg();
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.72;
      m.look((e.clientX - cx) / (r.width / 2), (e.clientY - cy) / (r.height / 2));
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { rubbed += Math.hypot(e.clientX - down.x, e.clientY - down.y); down.x = e.clientX; down.y = e.clientY; }
      if (down && rubbed > 160 && !down.purred) { down.purred = true; api.poke("purr"); }
    }
    const onLeave = () => { const m = api.mount(); if (m) m.look(0, 0); };
    function onDown(e) {
      if (e.button !== 0 || !e.target.closest("svg.hm")) return;
      down = { x: e.clientX, y: e.clientY, t: Date.now(), purred: false }; rubbed = 0;
    }
    function onUp(e) {
      if (!down) return;
      const d = down; down = null;
      if (d.purred || Date.now() - d.t > 600 || !e.target.closest("svg.hm")) return;
      const now = Date.now();
      pokes = pokes.filter((t) => now - t < 1500).concat(now);
      api.poke(pokes.length >= 4 ? "dizzy" : "poke");
      if (pokes.length >= 4) pokes = [];
    }
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    timer = setTimeout(idle, 4000);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("pointerup", onUp); };
  }

  window.HearthPetExtras = { panelHtml, life, ember, itemArt };
})();
