// Solitaire (Klondike) UI. Rules live in klondike.js, card helpers in cards.js; this file draws the board and
// handles input. Saved in umbra.store: "game" (state with its undo stack, clock) and "stats" (played, won, best).
(function () {
  "use strict";
  const K = window.Klondike, C = window.Cards;
  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const GLYPH = C.SUIT_GLYPHS.map((x) => x + "︎"); // text presentation, never the emoji look

  let g = null;                                      // { s: state, elapsed: ms, counted: bool, done: bool }
  let stats = { played: 0, won: 0, bestTime: null, bestMoves: null };
  let sel = null;                                    // { from, ids } picked by a click
  let drag = null;                                   // pointer gesture in progress
  let busy = false;                                  // auto-complete is running
  let autoToken = 0;
  let armed = false, armTimer = null;                // "New game" asks twice while a game is in progress
  let lastTick = Date.now();
  let L = null;                                      // layout in px
  const dragIds = new Set();
  const cardEls = [], shown = [], loc = [], pos = [];
  const slots = {};

  const drawOpt = () => (String(umbra.options.draw) === "3" ? 3 : 1);
  const autoOpt = () => umbra.options.autoComplete !== false;

  // ---------- layout ----------

  function measure() {
    const W = board.clientWidth || 480, H = board.clientHeight || 472;
    const padX = 10, cw = Math.floor((W - 2 * padX - 6 * 5) / 7), ch = Math.round(cw * 1.4);
    L = { W, H, cw, ch, padX, step: (W - 2 * padX - cw) / 6, topY: 6, tabY: 6 + ch + 12, fan: 26 };
    for (const el of cardEls) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    for (const el of Object.values(slots)) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    const put = (key, i, y) => { slots[key].style.transform = `translate(${colX(i)}px,${y}px)`; };
    put("stock", 0, L.topY);
    put("waste", 1, L.topY);
    for (let i = 0; i < 4; i++) put("f" + i, 3 + i, L.topY);
    for (let i = 0; i < 7; i++) put("c" + i, i, L.tabY);
  }
  const colX = (i) => L.padX + i * L.step;

  function build() {
    const mkSlot = (key, text, cls = "") => {
      const el = document.createElement("div");
      el.className = "slot " + cls;
      el.textContent = text;
      board.append(el);
      slots[key] = el;
    };
    mkSlot("stock", "");
    mkSlot("waste", "");
    for (let i = 0; i < 4; i++) mkSlot("f" + i, "A");
    for (let i = 0; i < 7; i++) mkSlot("c" + i, "K");
    for (let id = 0; id < 52; id++) {
      const rank = C.rankOf(id), lab = C.rankLabel(rank), gl = GLYPH[C.suitOf(id)];
      const el = document.createElement("div");
      el.className = "card" + (C.isRed(id) ? " red" : "");
      el.dataset.id = String(id);
      const mid = rank >= 11 ? `<span class="rk">${lab}</span><span class="sm">${gl}</span>` : `<span class="pip">${gl}</span>`;
      el.innerHTML = `<div class="back"></div><div class="face"><span class="corner tl">${lab}<i>${gl}</i></span>` +
        `<span class="mid">${mid}</span><span class="corner br">${lab}<i>${gl}</i></span></div>`;
      board.append(el);
      cardEls.push(el);
      shown.push({});
    }
  }

  // ---------- drawing ----------

  function place(id, x, y, z, up, where) {
    const el = cardEls[id], c = shown[id];
    pos[id] = { x, y };
    loc[id] = where;
    if (!dragIds.has(id)) {
      const t = `translate(${x}px,${y}px)`;
      if (c.t !== t) { el.style.transform = t; c.t = t; }
      if (c.z !== z) { el.style.zIndex = String(z); c.z = z; }
    }
    if (c.up !== up) {
      c.up = up;
      el.classList.toggle("up", up);
      el.setAttribute("aria-label", up ? C.name(id) : "face-down card");
    }
  }

  function syncSel() {
    const set = new Set(sel ? sel.ids : []);
    for (let id = 0; id < 52; id++) {
      const on = set.has(id);
      if (shown[id].sel !== on) { shown[id].sel = on; cardEls[id].classList.toggle("sel", on); }
    }
  }

  function render() {
    const s = g.s;
    s.stock.forEach((id, i) => place(id, colX(0), L.topY, i + 1, false, { pile: "stock" }));
    const n = s.waste.length, f0 = n - s.fan;
    s.waste.forEach((id, i) => place(id, colX(1) + (i >= f0 ? i - f0 : 0) * L.fan, L.topY, i + 1, true, { pile: "waste", pos: i }));
    s.foundations.forEach((f, i) => f.forEach((id, j) => place(id, colX(3 + i), L.topY, j + 1, true, { pile: "foundation", index: i, pos: j })));
    const avail = L.H - L.tabY - 6, downOff = 7;
    s.tableau.forEach((col, i) => {
      const down = s.faceDown[i], up = col.length - down;
      const upOff = up > 1 ? Math.max(12, Math.min(22, (avail - L.ch - down * downOff) / (up - 1))) : 22;
      let y = L.tabY;
      col.forEach((id, j) => {
        const isUp = j >= down;
        place(id, colX(i), Math.round(y), j + 1, isUp, { pile: "tableau", index: i, pos: j });
        y += isUp ? upOff : downOff;
      });
    });
    const recycle = s.stock.length === 0 && s.waste.length > 0;
    slots.stock.textContent = recycle ? "↻" : "";
    slots.stock.classList.toggle("recycle", recycle);
    syncSel();
    renderInfo();
    renderFoot();
  }

  const fmtTime = (ms) => {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };

  function renderInfo() {
    const s = g.s;
    $("game").textContent = `#${s.seed} · Draw ${s.draw}`;
    $("moves").textContent = `${s.moves} ${s.moves === 1 ? "move" : "moves"}`;
    $("time").textContent = fmtTime(g.elapsed);
  }

  function renderFoot() {
    $("undo").disabled = busy || !K.canUndo(g.s);
    $("finish").hidden = busy || g.done || !K.canAutoComplete(g.s);
    const best = stats.bestTime == null ? "" : ` · Best ${fmtTime(stats.bestTime * 1000)}`;
    $("stats").textContent = `Won ${stats.won} of ${stats.played}${best}`;
  }

  /** Render without gliding the cards (first frame, new game). */
  function renderInstant() {
    board.classList.add("instant");
    render();
    void board.offsetWidth;
    requestAnimationFrame(() => board.classList.remove("instant"));
  }

  // ---------- state changes ----------

  let saveT = null;
  function flush() {
    clearTimeout(saveT);
    saveT = null;
    if (g) umbra.store.set("game", g).catch(() => {});
  }
  const saveSoon = () => { if (!saveT) saveT = setTimeout(flush, 300); };
  const saveStats = () => { umbra.store.set("stats", stats).catch(() => {}); };

  function commit(next) {
    if (!next) { render(); return; }
    const first = g.s.moves === 0;
    g.s = next;
    sel = null;
    if (first) {
      lastTick = Date.now();
      if (!g.counted) { g.counted = true; stats.played++; saveStats(); }
    }
    saveSoon();
    render();
    if (K.isWon(next)) finish(); else maybeAuto();
  }

  function newGame() {
    autoToken++;
    busy = false;
    g = { s: K.deal(C.randomSeed(), drawOpt()), elapsed: 0, counted: false, done: false };
    sel = null;
    $("win").hidden = true;
    disarm();
    renderInstant();
    flush();
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    $("new").textContent = "New game";
    $("new").classList.remove("warn");
  }

  function finish() {
    if (g.done) return;
    g.done = true;
    const secs = Math.round(g.elapsed / 1000);
    const badges = [];
    stats.won++;
    if (stats.bestTime == null || secs < stats.bestTime) { stats.bestTime = secs; badges.push("Best time"); }
    if (stats.bestMoves == null || g.s.moves < stats.bestMoves) { stats.bestMoves = g.s.moves; badges.push("Fewest moves"); }
    saveStats();
    flush();
    renderFoot();
    showWin(badges);
  }

  function showWin(badges) {
    $("win-line").textContent = `Game #${g.s.seed} · ${g.s.moves} moves · ${fmtTime(g.elapsed)}`;
    $("win-best").textContent = badges.length ? `New record: ${badges.join(" and ")}` : "";
    const rnd = C.mulberry32(g.s.seed);
    $("bits").innerHTML = Array.from({ length: 18 }, (_, i) => {
      const suit = i % 4, red = suit === 1 || suit === 2;
      return `<span class="bit${red ? " red" : ""}" style="left:${(4 + rnd() * 88).toFixed(1)}%;top:${(6 + rnd() * 84).toFixed(1)}%;` +
        `font-size:${Math.round(18 + rnd() * 20)}px;animation-delay:calc(${(rnd() * 1.2).toFixed(2)}s * var(--motion-scale, 1))">${GLYPH[suit]}</span>`;
    }).join("");
    $("win").hidden = false;
  }

  // ---------- auto-complete ----------

  function maybeAuto() {
    if (busy || g.done || !autoOpt()) return;
    if (K.canAutoComplete(g.s)) runAuto();
  }

  function runAuto() {
    const plan = K.autoPlan(g.s);
    if (!plan || busy) return;
    const token = ++autoToken;
    busy = true;
    sel = null;
    const delay = document.documentElement.dataset.motion === "off" ? 25 : 60;
    const step = () => {
      if (token !== autoToken) return;
      const next = plan.length ? K.applyMove(g.s, plan.shift()) : null;
      if (!next) { busy = false; render(); return; }
      g.s = next;
      saveSoon();
      if (K.isWon(next)) { busy = false; render(); finish(); return; }
      render();
      setTimeout(step, delay);
    };
    step();
  }

  // ---------- input ----------

  const pt = (e) => { const r = board.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /** What a click on a card does as a source: the cards that would move, or null. */
  function sourceOf(id) {
    const s = g.s, l = loc[id];
    if (!l) return null;
    if (l.pile === "waste") return l.pos === s.waste.length - 1 ? { from: { pile: "waste" }, ids: [id] } : null;
    if (l.pile === "foundation") return l.pos === s.foundations[l.index].length - 1 ? { from: { pile: "foundation", index: l.index }, ids: [id] } : null;
    if (l.pile === "tableau") {
      const n = K.movableCount(s, l.index, l.pos);
      return n ? { from: { pile: "tableau", index: l.index, count: n }, ids: s.tableau[l.index].slice(l.pos) } : null;
    }
    return null;
  }

  /** The pile under a board point (for clicks on empty space). */
  function hit(x, y) {
    const ci = Math.round((x - L.padX - L.cw / 2) / L.step);
    if (ci < 0 || ci > 6 || Math.abs(x - (colX(ci) + L.cw / 2)) > L.cw / 2 + 3) return null;
    if (y < L.tabY - 6) {
      if (y > L.topY + L.ch + 4) return null;
      if (ci === 0) return { pile: "stock" };
      if (ci === 1) return { pile: "waste" };
      return ci >= 3 ? { pile: "foundation", index: ci - 3 } : null;
    }
    return { pile: "tableau", index: ci };
  }

  function click(id, x, y) {
    const s = g.s;
    const t = id !== null ? loc[id] : hit(x, y);
    if (!t) { sel = null; syncSel(); return; }
    if (t.pile === "stock") { sel = null; commit(K.applyMove(s, K.stockMove(s))); return; }
    if (sel) {
      if (id !== null && sel.ids[0] === id) { sel = null; syncSel(); return; }
      if (t.pile === "tableau" || t.pile === "foundation") {
        const next = K.applyMove(s, { type: "move", from: sel.from, to: { pile: t.pile, index: t.index } });
        if (next) { commit(next); return; }
      }
    }
    const src = id !== null ? sourceOf(id) : null;
    sel = src;
    syncSel();
  }

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  }

  /** The legal pile that the dragged cards cover most, or null. */
  function findDrop(d) {
    const b = pos[d.ids[0]], x = b.x + d.dx, y = b.y + d.dy;
    let best = null, bestArea = L.cw * L.ch * 0.12;
    const test = (to, rx, ry, rw, rh) => {
      if (!K.isLegalMove(g.s, { type: "move", from: d.from, to })) return;
      const a = overlap(x, y, L.cw, L.ch, rx, ry, rw, rh);
      if (a > bestArea) { bestArea = a; best = to; }
    };
    for (let i = 0; i < 4; i++) test({ pile: "foundation", index: i }, colX(3 + i), L.topY, L.cw, L.ch);
    for (let i = 0; i < 7; i++) test({ pile: "tableau", index: i }, colX(i), L.tabY, L.cw, L.H - L.tabY);
    return best;
  }

  function startDrag() {
    drag.moved = true;
    sel = null;
    drag.ids.forEach((id, k) => {
      dragIds.add(id);
      shown[id].t = null;
      shown[id].z = null;
      cardEls[id].classList.add("drag");
      cardEls[id].style.zIndex = String(300 + k);
    });
    syncSel();
  }

  function endDrag(d, drop) {
    for (const id of d.ids) cardEls[id].classList.remove("drag");
    dragIds.clear();
    const to = drop ? findDrop(d) : null;
    commit(to ? K.applyMove(g.s, { type: "move", from: d.from, to }) : null);
  }

  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || busy || !g) return;
    const el = e.target.closest(".card");
    const id = el ? Number(el.dataset.id) : null;
    const p = pt(e);
    drag = { pid: e.pointerId, id, x0: p.x, y0: p.y, moved: false, from: null, ids: null, dx: 0, dy: 0 };
    const src = id !== null ? sourceOf(id) : null;
    if (src) { drag.from = src.from; drag.ids = src.ids; }
    try { (el || board).setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  });

  board.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const p = pt(e), dx = p.x - drag.x0, dy = p.y - drag.y0;
    if (!drag.moved) {
      if (!drag.ids || Math.hypot(dx, dy) < 5) return;
      startDrag();
    }
    drag.dx = dx;
    drag.dy = dy;
    for (const id of drag.ids) cardEls[id].style.transform = `translate(${pos[id].x + dx}px,${pos[id].y + dy}px)`;
  });

  board.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    if (d.moved) endDrag(d, true); else click(d.id, d.x0, d.y0);
  });

  board.addEventListener("pointercancel", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    if (d.moved) endDrag(d, false);
  });

  board.addEventListener("dblclick", (e) => {
    if (busy || !g) return;
    const el = e.target.closest(".card");
    if (!el) return;
    const s = g.s, l = loc[Number(el.dataset.id)];
    let from = null;
    if (l.pile === "waste" && l.pos === s.waste.length - 1) from = { pile: "waste" };
    else if (l.pile === "tableau" && l.pos === s.tableau[l.index].length - 1 && l.pos >= s.faceDown[l.index]) from = { pile: "tableau", index: l.index };
    const move = from && K.autoFoundationMove(s, from);
    sel = null;
    if (move) commit(K.applyMove(s, move)); else syncSel();
  });

  board.addEventListener("contextmenu", (e) => e.preventDefault());

  function undo() {
    if (busy) return;
    const prev = K.undo(g.s);
    if (!prev) return;
    g.s = prev;
    sel = null;
    saveSoon();
    render();
  }

  $("undo").onclick = undo;
  $("finish").onclick = () => runAuto();
  $("new").onclick = () => {
    if (g.s.moves > 0 && !g.done && !armed) {
      armed = true;
      $("new").textContent = "Sure?";
      $("new").classList.add("warn");
      armTimer = setTimeout(disarm, 2500);
    } else newGame();
  };
  $("win-new").onclick = newGame;
  $("win-close").onclick = () => { $("win").hidden = true; };
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); } });

  setInterval(() => {
    const now = Date.now(), dt = Math.min(now - lastTick, 2500);
    lastTick = now;
    if (g && document.visibilityState === "visible" && g.s.moves > 0 && !g.done) { g.elapsed += dt; renderInfo(); }
  }, 1000);
  document.addEventListener("visibilitychange", () => { lastTick = Date.now(); if (document.visibilityState === "hidden") flush(); });

  umbra.onSettings(() => {
    if (!g) return;
    if (g.s.moves === 0 && g.s.draw !== drawOpt()) { g.s = K.deal(g.s.seed, drawOpt()); saveSoon(); }
    measure();
    for (const c of shown) { c.t = null; c.z = null; }
    render();
    maybeAuto();
  });

  (async () => {
    await umbra.ready;
    const [saved, st] = await Promise.all([umbra.store.get("game", null), umbra.store.get("stats", null)]);
    if (st && typeof st === "object") stats = { ...stats, ...st };
    build();
    measure();
    if (saved && K.isValidState(saved.s)) {
      g = { s: saved.s, elapsed: Math.max(0, Number(saved.elapsed) || 0), counted: !!saved.counted, done: !!saved.done };
    } else {
      g = { s: K.deal(C.randomSeed(), drawOpt()), elapsed: 0, counted: false, done: false };
    }
    lastTick = Date.now();
    renderInstant();
    if (K.isWon(g.s)) { if (g.done) showWin([]); else finish(); }
    requestAnimationFrame(() => requestAnimationFrame(() => umbra.rendered()));
    maybeAuto();
  })();
})();
