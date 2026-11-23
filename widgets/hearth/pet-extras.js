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

  // Treats, each its own little picture (40x40). Drinks stand on their own; food sits on a plate.
  const O = 'stroke="#6B4F3A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"';
  const plate = `<ellipse cx="20" cy="33" rx="16" ry="3.6" fill="#fff" ${O}/>`;
  const shine = (x, y) => `<path d="M${x} ${y} q1.2 -1.4 2.6 -1" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.9"/>`;
  const TREATS = {
    bubble_soap: plate +
      `<rect x="8" y="20" width="24" height="12" rx="4" fill="#BFE6F5" ${O}/><path d="M11 23 h10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` +
      [[14, 14, 4], [23, 11, 5.5], [31, 17, 3], [19, 5, 2.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#6B4F3A" stroke-width="1.4"/>` + shine(x - r * 0.5, y - r * 0.1)).join(""),
    berry_tart: plate +
      `<path d="M5.5 24 L9 31.5 H31 L34.5 24 Z" fill="#F2C98A" ${O}/>` +
      `<path d="M11 25.5 L12.5 30 M16 25.5 L16.8 30 M20 25.5 V30 M24 25.5 L23.2 30 M29 25.5 L27.5 30" fill="none" stroke="#B98563" stroke-width="1.2" stroke-linecap="round"/>` +
      `<ellipse cx="20" cy="24" rx="14.5" ry="3.8" fill="#E5648F" ${O}/>` +
      [[13, 22.2, 3.2], [20, 21.6, 3.4], [27, 22.2, 3.2], [16.5, 18.6, 3], [23.5, 18.6, 3]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#C23A6B" ${O}/>` + shine(x - 1.6, y - 0.4)).join("") +
      `<path d="M20 15.6 Q23.5 11.4 27 13 Q24 16.4 20 15.6 Z" fill="#B7DA98" ${O}/>`,
    honey_cake: plate +
      `<rect x="8" y="16" width="24" height="16" rx="3" fill="#F6D58A" ${O}/>` +
      `<rect x="8.9" y="22.6" width="22.2" height="3" fill="#FFF3B0"/>` +
      `<path d="M8 17 Q8 13 20 13 Q32 13 32 17 V19 Q30.5 21.5 29 19 V18 Q26 23.5 23 18.5 Q21 21 19 18.5 Q16 22.5 13 18.5 Q11 21.5 9.5 19.5 Q8 20.5 8 19 Z" fill="#F2A93B" ${O}/>` +
      `<ellipse cx="17" cy="5.6" rx="3" ry="2.4" fill="#fff" stroke="#6B4F3A" stroke-width="1.2" opacity="0.95"/><ellipse cx="21.6" cy="5.2" rx="3" ry="2.4" fill="#fff" stroke="#6B4F3A" stroke-width="1.2" opacity="0.95"/>` +
      `<ellipse cx="19.4" cy="9.6" rx="5" ry="3.6" fill="#FFD447" ${O}/><path d="M18 6.4 V12.8 M21 6.4 V12.8" stroke="#4A3426" stroke-width="1.6"/><circle cx="15.6" cy="9" r="0.9" fill="#4A3426"/>` + shine(12, 16.2),
    fish_snack: plate +
      `<path d="M6 21 Q14 11 25 19 L33 13.5 Q31.5 21 33 28.5 L25 23 Q14 31 6 21 Z" fill="#F2A04B" ${O}/>` +
      `<path d="M15 16.8 Q17.5 21 15 25.2 M19.5 17.6 Q21.5 21 19.5 24.4" fill="none" stroke="#C9762B" stroke-width="1.3" stroke-linecap="round"/>` +
      `<circle cx="10.6" cy="19.6" r="1.6" fill="#4A3426"/><path d="M8.6 23.4 Q10 24.6 11.6 23.6" fill="none" stroke="#4A3426" stroke-width="1.2" stroke-linecap="round"/>`,
    smoothie:
      `<path d="M24.5 3 L21.5 17" stroke="#6B4F3A" stroke-width="4.4" stroke-linecap="round"/><path d="M24.5 3 L21.5 17" stroke="#9ED3EE" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M10 10 H30 L27 35 H13 Z" fill="#fff" ${O}/>` +
      `<path d="M11.4 15 H28.6 L26.2 33.4 H13.8 Z" fill="#F7A8C4"/>` +
      `<path d="M11.4 15 Q15 13 18 15 Q21.5 17 25 15 Q27 14 28.6 15" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` +
      `<circle cx="29" cy="11" r="4" fill="#E5648F" ${O}/><path d="M27.6 7.6 Q29.6 5.4 31.4 7" fill="none" stroke="#7DBE5B" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M15 20 V29" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`,
    cocoa:
      `<path d="M14 8 Q12 5.5 14 3.5 M19.5 8 Q17.5 5 19.5 2.6 M25 8 Q23 5.5 25 3.5" fill="none" stroke="#B98563" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>` +
      `<path d="M28 16 Q35 16 35 22 Q35 28 28 28" fill="none" stroke="#6B4F3A" stroke-width="5" stroke-linecap="round"/><path d="M28 16 Q35 16 35 22 Q35 28 28 28" fill="none" stroke="#F7A8C4" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M8 11 H29 V30 Q29 35 24 35 H13 Q8 35 8 30 Z" fill="#F7A8C4" ${O}/>` +
      `<ellipse cx="18.5" cy="11.4" rx="10" ry="2.6" fill="#8A5A3C" ${O}/>` +
      `<rect x="12.5" y="8.6" width="5" height="4" rx="1.4" fill="#fff" ${O}/><rect x="18.8" y="8" width="5" height="4" rx="1.4" fill="#fff" ${O}/>` +
      `<path d="M13 20 Q15.5 17.5 18 20 Q20.5 17.5 23 20 Q23 23 18 26 Q13 23 13 20 Z" fill="#fff" opacity="0.85"/>`,
    star_candy:
      `<path d="M20 22 V37" stroke="#6B4F3A" stroke-width="4.4" stroke-linecap="round"/><path d="M20 22 V37" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M20 3 L24.2 12.2 L34 13 L26.6 19.6 L28.8 29.2 L20 24.2 L11.2 29.2 L13.4 19.6 L6 13 L15.8 12.2 Z" fill="#FFE36E" ${O}/>` +
      `<path d="M20 8.5 L22.6 14.2 L28.6 14.8 L24 18.8 L25.4 24.6 L20 21.6 L14.6 24.6 L16 18.8 L11.4 14.8 L17.4 14.2 Z" fill="#F7A8C4" opacity="0.55"/>` +
      `<circle cx="17.4" cy="15.6" r="1" fill="#4A3426"/><circle cx="22.6" cy="15.6" r="1" fill="#4A3426"/><path d="M18.4 18.4 Q20 19.8 21.6 18.4" fill="none" stroke="#4A3426" stroke-width="1.1" stroke-linecap="round"/>` +
      `<path d="M33 4 l1 2.2 2.2 1 -2.2 1 -1 2.2 -1 -2.2 -2.2 -1 2.2 -1 Z" fill="#fff" stroke="#6B4F3A" stroke-width="1"/>`,
  };

  /** A small picture of an item for the shop and the room. */
  function itemArt(id) {
    const it = WL.CATALOG[id];
    if (!it) return "";
    if (it.cat === "outfit") return M.renderSvg({ mood: "content", outfit: [id], level: 5 });
    const room = it.spot ? { [it.spot]: id } : {};
    const view = { place: "0 0 240 210", wallpaper: "-40 -30 120 100", rug: "34 168 172 52", window: "-4 8 92 80", wall: "160 16 82 70", mantel: "66 -18 108 60", floorL: "-10 112 92 82", floorR: "162 100 88 92", toy: "28 160 58 46" }[it.spot];
    if (view) {
      const svg = window.HearthWorld.renderRoom({ room, phase: "day", season: "summer", mood: "content", level: 1, pet: false, still: true });
      return svg.replace(/viewBox="0 0 240 240"/, `viewBox="${view}" preserveAspectRatio="xMidYMid meet"`);
    }
    return TREATS[id] ? `<svg viewBox="0 0 40 40" aria-hidden="true">${TREATS[id]}</svg>` : "";
  }

  const GLYPHS = {
      drop: "M18 8 C22 14 25 18 25 22 A7 7 0 0 1 11 22 C11 18 14 14 18 8 Z",
      heart: "M18 27 C8 20 9 12 14 11 C16 10.5 17.5 12 18 13.5 C18.5 12 20 10.5 22 11 C27 12 28 20 18 27 Z",
      bubble: "M15 13 A7 7 0 1 0 15.1 13 Z M25 8 A4 4 0 1 0 25.1 8 Z M25 22.5 A2.5 2.5 0 1 0 25.1 22.5 Z",
      paw: "M18 18 C13 18 11 23 13 26 C15 28 21 28 23 26 C25 23 23 18 18 18 Z M11 14.5 A2.5 2.5 0 1 0 11.1 14.5 Z M15.5 9.5 A2.5 2.5 0 1 0 15.6 9.5 Z M20.5 9.5 A2.5 2.5 0 1 0 20.6 9.5 Z M25 14.5 A2.5 2.5 0 1 0 25.1 14.5 Z",
      team: "M13 9 A3.5 3.5 0 1 0 13.1 9 Z M23 9 A3.5 3.5 0 1 0 23.1 9 Z M7 27 Q7 19 13 19 Q19 19 19 27 M17 27 Q17 19 23 19 Q29 19 29 27",
      trophy: "M12 9 H24 V15 A6 6 0 0 1 12 15 Z M12 11 H8 Q8 17 13 17 M24 11 H28 Q28 17 23 17 M18 21 V25 M13 27 H23",
      sparkle: "M18 7 Q19.5 16.5 29 18 Q19.5 19.5 18 29 Q16.5 19.5 7 18 Q16.5 16.5 18 7 Z",
      chest: "M8 16 Q8 10 18 10 Q28 10 28 16 Z M8 16 H28 V27 H8 Z M16 16 V20 H20 V16",
      cup: "M10 26 L13 12 H23 L26 26 Z M16 12 Q18 8 20 12",
      cloud: "M10 24 A5 5 0 0 1 12 15 A6 6 0 0 1 23 13 A5 5 0 0 1 27 24 Z",
      play: "M15 11 L27 18 L15 25 Z", cake: "M10 22 H26 V28 H10 Z M12 16 H24 V22 H12 Z M18 10 V16", coin: "M18 10 A8 8 0 1 0 18.1 10 Z", gift: "M10 16 H26 V28 H10 Z M8 12 H28 V16 H8 Z M18 12 V28",
      flag: "M12 28 V9 M12 10 H25 L21 15 L25 20 H12", house: "M9 19 L18 10 L27 19 M12 17 V28 H24 V17", hat: "M10 26 H26 M13 26 V14 H23 V26", flame: "M18 28 C10 26 10 18 14 14 C14 18 17 19 18 16 C19 13 17 10 20 7 C22 12 27 15 26 21 C25 26 22 28 18 28 Z",
      star: "M18 7 L21 15 L29 15 L23 20 L25 28 L18 23 L11 28 L13 20 L7 15 L15 15 Z", crown: "M9 26 L8 12 L14 18 L18 10 L22 18 L28 12 L27 26 Z", berry: "M18 28 A8 8 0 1 0 18.1 28 Z M18 12 Q22 7 26 9",
      eye: "M7 18 Q18 8 29 18 Q18 28 7 18 Z M18 15 A3 3 0 1 0 18.1 15 Z", box: "M9 14 H27 V28 H9 Z M9 14 L13 9 H23 L27 14",
  };
  /** A round badge with a glyph (36 x 36). */
  const badge = (glyph, color, cls) => `<svg class="${cls || ""}" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="${color}" stroke="#6B4F3A" stroke-width="2"/>` +
    `<path d="${GLYPHS[glyph] || "M18 10 A8 8 0 1 0 18.1 10 Z"}" fill="#fff" stroke="#6B4F3A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const TIER_COLOR = ["", "#DDF0C8", "#BFE6F5", "#F7A8C4"];
  const GAME_BADGE = { catch: ["berry", "#F7A8C4"], memory: ["flame", "#FFF3B0"], seek: ["cup", "#DDF0C8"], bubbles: ["bubble", "#BFE6F5"], hop: ["star", "#FFF3B0"] };

  function sticker(id, have) {
    const s = WL.STICKERS[id];
    const g = GLYPHS[s.glyph] || "M18 10 A8 8 0 1 0 18.1 10 Z";
    return `<div class="px-sticker${have ? "" : " locked"}" title="${esc(s.label + ": " + s.how)}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="${have ? s.color : "#EEE"}" stroke="#6B4F3A" stroke-width="2"/>` +
      `<path d="${g}" fill="${have ? "#fff" : "none"}" stroke="#6B4F3A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg><b>${esc(s.label)}</b><span>${esc(have ? "Earned" : s.how)}</span></div>`;
  }

  /**
   * The HTML of a panel. ctx: { world, panel, sub, level, me, names, petName, err, busy, local (best scores on an old relay),
   * now, celebrate (a claim that just happened), v21 (the relay has Hearth 2.1: places and the new games) }.
   */
  function panelHtml(ctx) {
    const w = ctx.world, pet = ctx.petName || "the blob";
    const coins = w ? ember(w.coins) : "";
    const msg = ctx.err ? `<p class="pt-err" role="alert">${esc(ctx.err)}</p>` : "";
    switch (ctx.panel) {
      case "play": {
        const rows = WL.GAME_IDS.filter((id) => ctx.v21 || !WL.GAMES[id].v21).map((id) => {
          const g = WL.GAMES[id];
          const best = w ? w.best[id] || 0 : (ctx.local && ctx.local[id]) || 0;
          const [gl, gc] = GAME_BADGE[id] || ["play", "#FFF3B0"];
          return `<div class="px-row px-game">${badge(gl, gc, "px-badge")}<div class="px-txt"><b>${g.label}</b><span>${esc(g.how)}</span><span class="num">Best: ${best} ${g.unit}${w ? ` · up to ${g.cap} Embers` : ""}</span></div>` +
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
          return `<div class="px-item${own ? " own" : ""}${it.cat === "place" ? " px-wide" : ""}"><span class="px-art">${itemArt(id)}</span><b>${esc(it.label)}</b>` +
            `<span class="px-note">${esc(it.note || (it.cat === "treat" ? "" : own ? "Yours" : ""))}${it.cat === "treat" && n ? ` · have ${n}` : ""}</span>` +
            `<span class="px-buy">${own ? (it.cat === "outfit" ? `<button class="btn" data-act="wear" data-id="${id}" data-no-drag>Wear</button>` : `<button class="btn" data-act="panel" data-panel="room" data-no-drag>Place</button>`)
              : `<button class="btn${afford ? " primary" : ""}" data-act="buy" data-id="${id}" data-no-drag ${afford && !ctx.busy ? "" : "disabled"}>${ember(it.price)}</button>`}` +
            (it.cat === "treat" && n ? `<button class="btn primary" data-act="use" data-id="${id}" data-no-drag ${ctx.busy ? "disabled" : ""}>Give</button>` : "") +
            (!w || w.gift ? "" : `<button class="btn quiet px-giftbtn" data-act="gift" data-id="${id}" data-no-drag title="Wrap it as a gift for ${esc((ctx.names && ctx.names.partner) || "your partner")}" ${afford && !ctx.busy ? "" : "disabled"}>Gift</button>`) +
            `</span></div>`;
        }).join("");
        return `<div class="pt-form px">${head("Shop", coins)}${tabs(cat, WL.CATEGORIES.filter((c) => ctx.v21 || c.id !== "place").map((c) => ["shop:" + c.id, c.label]))}${msg}<div class="px-grid">${tiles}</div>` +
          `<p class="pt-muted">Embers are shared: you both earn them by caring, playing and finishing quests. Gifts wait in the room until your partner opens them.</p></div>`;
      }
      case "room": {
        const rows = WL.SPOTS.filter((s) => ctx.v21 || s.id !== "place").map((s) => {
          const items = WL.itemsForSpot(s.id).filter((id) => w.inv[id] > 0);
          const cur = w.room[s.id] || "";
          const chips = [`<button class="px-chip${cur ? "" : " on"}" data-act="place" data-spot="${s.id}" data-id="" data-no-drag>${s.id === "place" ? "Cozy room" : "None"}</button>`]
            .concat(items.map((id) => `<button class="px-chip${cur === id ? " on" : ""}" data-act="place" data-spot="${s.id}" data-id="${id}" data-no-drag>${esc(WL.label(id))}</button>`));
          return `<div class="px-spot"><b>${s.label}</b><div class="px-chips">${items.length ? chips.join("") : `<span class="pt-muted">${s.id === "place" ? "Only the cozy room for now." : "Nothing yet."} <button class="px-link" data-act="panel" data-panel="shop:${s.id === "toy" ? "toy" : s.id === "place" ? "place" : "decor"}" data-no-drag>Shop</button></span>`}</div></div>`;
        }).join("");
        return `<div class="pt-form px">${head("Room", coins)}${msg}${rows}<p class="pt-muted">The room is shared: your partner sees it too. Some places have no wall or mantel, so those things wait for the cozy room.</p></div>`;
      }
      case "quests": {
        const qs = w.quests, cel = ctx.celebrate;
        const pop = (q) => (cel && cel.q === String(q) ? " pop" : "");
        const confetti = `<i class="qx-confetti" aria-hidden="true">${"<b></b>".repeat(8)}</i>`;
        const rewards = (xp, coins, extra) => `<span class="qx-rw"><span class="qx-xp num">+${xp} XP</span>${ember("+" + coins)}${extra || ""}</span>`;
        const bar = (p, n) => `<span class="qx-prog"><span class="pt-bar"><i style="width:${Math.round((Math.min(p, n) / n) * 100)}%"></i></span><span class="num">${Math.min(p, n)}/${n}</span></span>`;
        const action = (done, claimed, q, label) => claimed ? `<span class="qx-done">&#10003; Claimed</span>`
          : `<button class="btn${done ? " primary qx-ready" : ""}" data-act="claim" data-q="${q}" data-no-drag ${done && !ctx.busy ? "" : "disabled"}>${done ? label : "Not yet"}</button>`;
        const cards = qs ? qs.map((q, i) => {
          const d = WL.QUESTS[q.id], done = q.p >= q.n;
          return `<div class="qx-card t${q.tier}${q.claimed ? " claimed" : done ? " ready" : ""}${pop(i)}">${badge(d.glyph, TIER_COLOR[q.tier], "qx-badge")}` +
            `<div class="qx-body"><span class="qx-tier">${WL.TIER_LABELS[q.tier]}</span><b>${esc(d.title)}</b><span class="qx-what">${esc(WL.questText(q.id, pet))}</span>${bar(q.p, q.n)}</div>` +
            `<div class="qx-side">${rewards(q.xp, q.reward)}${action(done, q.claimed, i, "Claim")}</div>${pop(i) ? confetti : ""}</div>`;
        }).join("") : `<p class="pt-muted">Loading today's quests...</p>`;
        const b = w.questBonus;
        const claimedN = qs ? qs.filter((q) => q.claimed).length : 0;
        const chest = b ? `<div class="qx-card qx-chest${b.claimed ? " claimed" : b.ready ? " ready" : ""}${pop("bonus")}">${badge("chest", "#FFE36E", "qx-badge")}` +
          `<div class="qx-body"><span class="qx-tier">Daily chest</span><b>${b.claimed ? "Opened!" : "Claim all three"}</b><span class="qx-dots">${[0, 1, 2].map((i) => `<i class="${i < claimedN ? "on" : ""}"></i>`).join("")}</span></div>` +
          `<div class="qx-side">${rewards(b.xp, b.reward)}${action(b.ready, b.claimed, "bonus", "Open")}</div>${pop("bonus") ? confetti : ""}</div>` : "";
        const wk = w.weekly;
        const week = wk ? (() => {
          const d = WL.WEEKLY[wk.id], done = wk.p >= wk.n;
          return `<div class="qx-card qx-week${wk.claimed ? " claimed" : done ? " ready" : ""}${pop("week")}">${badge(d.glyph, "#E9D7FF", "qx-badge")}` +
            `<div class="qx-body"><span class="qx-tier">Weekly &middot; ${esc(WL.timeLeft(wk.endsAt, ctx.now || Date.now()))}</span><b>${esc(d.title)}</b><span class="qx-what">${esc(WL.weeklyText(wk.id, pet))}</span>${bar(wk.p, wk.n)}</div>` +
            `<div class="qx-side">${rewards(wk.xp, wk.reward, `<span class="qx-gift" title="A surprise from the shop you don't own yet">+ surprise</span>`)}${action(done, wk.claimed, "week", "Claim")}</div>${pop("week") ? confetti : ""}</div>`;
        })() : "";
        const left = qs ? qs.filter((q) => !q.claimed).reduce((n, q) => n + q.xp, 0) + (b && !b.claimed ? b.xp : 0) : 0;
        return `<div class="pt-form px qx">${head("Quests", coins)}${msg}` +
          (qs ? `<p class="qx-sum">${left ? `<b class="num">${left} XP</b> left to earn today` : `<b>All done today!</b> Come back tomorrow`}</p>` : "") +
          cards + chest + week +
          `<p class="pt-muted">New quests every day at midnight UTC, a new weekly quest every Monday. Either of you can claim, once.</p></div>`;
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
          (w ? b("quests", "Quests" + (claim ? ` <i class="px-dot">${claim}</i>` : ""), "Daily, a chest and a weekly one") + b("room", "Room", "Places and decor") +
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
