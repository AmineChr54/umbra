// Spider UI. Rules live in spider-rules.js, card helpers in cards.js; this file draws the board and handles input.
// Saved in umbra.store: "game" (state with its undo stack, clock) and "stats" (played, won, bests per suit count).
(function () {
  "use strict";
  const S = window.Spider, C = window.Cards;
  const $ = (id) => document.getElementById(id);
  const board = $("board"), noteEl = $("note");
  const GLYPH = C.SUIT_GLYPHS.map((x) => x + "︎"); // text presentation, never the emoji look
  const MINI = 0.5;                                          // scale of the stock and foundation cards

  let g = null;                                              // { s: state, elapsed: ms, counted: bool, done: bool }
  let stats = { played: 0, won: 0, best: {} };               // best["1"|"2"|"4"] = { time (s), moves }
  let sel = null;                                            // { from, ids } picked by a click
  let hintMark = null;                                       // { ids, toId, toIndex } while a hint is shown
  let hintT = null, noteT = null;
  let drag = null;                                           // pointer gesture in progress
  let armed = false, armTimer = null;                        // "New game" asks twice while a game is in progress
  let lastTick = Date.now();
  let skinned = 0;                                           // suit count the card faces are drawn for
  let L = null;                                              // layout in px
  const dragIds = new Set();
  const cardEls = [], shown = [], loc = [], pos = [];
  const slots = {};

  const suitsOpt = () => S.normSuits(umbra.options.suits);

  // ---------- layout ----------

  function measure() {
    const W = board.clientWidth || 700, H = board.clientHeight || 492;
    const padX = 10, gap = 6, cw = Math.floor((W - 2 * padX - 9 * gap) / 10), ch = Math.round(cw * 1.4);
    const mw = Math.round(cw * MINI), mh = Math.round(ch * MINI);
    const stripTop = H - mh - 12, miniY = H - mh - 6;
    const stockW = mw + 4 * 7, stockX = W - padX - stockW;
    L = { W, H, cw, ch, mw, mh, padX, step: (W - 2 * padX - cw) / 9, tabY: 4, stripTop, miniY, stockX, stockW, foundStep: mw + 6 };
    for (const el of cardEls) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    for (let i = 0; i < 10; i++) {
      const el = slots["c" + i];
      el.style.width = cw + "px"; el.style.height = ch + "px";
      el.style.transform = `translate(${colX(i)}px,${L.tabY}px)`;
    }
    for (let i = 0; i < 8; i++) {
      const el = slots["f" + i];
      el.style.width = mw + "px"; el.style.height = mh + "px";
      el.style.transform = `translate(${foundX(i)}px,${L.miniY}px)`;
    }
    noteEl.style.left = padX + 8 * L.foundStep + 12 + "px";
    noteEl.style.width = stockX - 10 - (padX + 8 * L.foundStep + 12) + "px";
    noteEl.style.top = L.miniY + "px";
    noteEl.style.height = mh + "px";
  }
  const colX = (i) => L.padX + i * L.step;
  const foundX = (i) => L.padX + i * L.foundStep;

  function build() {
    for (let i = 0; i < 10; i++) mkSlot("c" + i, "");
    for (let i = 0; i < 8; i++) mkSlot("f" + i, "mini");
    for (let id = 0; id < S.CARDS; id++) {
      const el = document.createElement("div");
      el.dataset.id = String(id);
      board.append(el);
      cardEls.push(el);
      shown.push({});
    }
  }

  function mkSlot(key, cls) {
    const el = document.createElement("div");
    el.className = "slot " + cls;
    board.append(el);
    slots[key] = el;
  }

  /** Draw the faces of all 104 cards for a game with `suits` suits. */
  function reskin(suits) {
    skinned = suits;
    for (let id = 0; id < S.CARDS; id++) {
      const f = S.faceId(suits, id), rank = S.rankOf(id), lab = C.rankLabel(rank), gl = GLYPH[C.suitOf(f)];
      const el = cardEls[id];
      el.className = "card" + (C.isRed(f) ? " red" : "");
      const mid = rank >= 11 ? `<span class="rk">${lab}</span><span class="sm">${gl}</span>` : `<span class="pip">${gl}</span>`;
      el.innerHTML = `<div class="back"></div><div class="face"><span class="corner tl">${lab}<i>${gl}</i></span>` +
        `<span class="mid">${mid}</span><span class="corner br">${lab}<i>${gl}</i></span></div>`;
      shown[id] = {};
    }
  }

  // ---------- drawing ----------

  /** kind: "" in a column, "stk" in the stock, "fnd" on a foundation (the last two are drawn at MINI scale). */
  function place(id, x, y, z, up, where, kind = "") {
    const el = cardEls[id], c = shown[id];
    x = Math.round(x);
    pos[id] = { x, y };
    loc[id] = where;
    if (!dragIds.has(id)) {
      const t = `translate(${x}px,${y}px)` + (kind ? ` scale(${MINI})` : "");
      if (c.t !== t) { el.style.transform = t; c.t = t; }
      if (c.z !== z) { el.style.zIndex = String(z); c.z = z; }
    }
    if (c.kind !== kind) {
      c.kind = kind;
      el.classList.toggle("stk", kind === "stk");
      el.classList.toggle("fnd", kind === "fnd");
    }
    if (c.up !== up) {
      c.up = up;
      el.classList.toggle("up", up);
      el.setAttribute("aria-label", up ? C.name(S.faceId(g.s.suits, id)) : "face-down card");
    }
  }

  function syncMarks() {
    const selSet = new Set([...(sel ? sel.ids : []), ...(hintMark ? hintMark.ids : [])]);
    const tgtId = hintMark ? hintMark.toId : -1;
    for (let id = 0; id < S.CARDS; id++) {
      const on = selSet.has(id), tg = id === tgtId, c = shown[id];
      if (c.sel !== on) { c.sel = on; cardEls[id].classList.toggle("sel", on); }
      if (c.tgt !== tg) { c.tgt = tg; cardEls[id].classList.toggle("tgt", tg); }
    }
    for (let i = 0; i < 10; i++) slots["c" + i].classList.toggle("tgt", !!hintMark && hintMark.toId === null && hintMark.toIndex === i);
  }

  function render() {
    const s = g.s;
    if (skinned !== s.suits) reskin(s.suits);
    s.stock.forEach((id, i) => place(id, L.stockX + Math.floor(i / S.DEAL_SIZE) * 7, L.miniY, i + 1, false, { pile: "stock" }, "stk"));
    s.found.forEach((run, f) => run.forEach((id, k) => place(id, foundX(f), L.miniY, k + 1, true, { pile: "found", index: f }, "fnd")));
    const avail = L.stripTop - 6 - L.tabY, downOff = 6;
    s.tableau.forEach((col, i) => {
      const down = s.faceDown[i], up = col.length - down;
      const upOff = up > 1 ? Math.max(12, Math.min(24, (avail - L.ch - down * downOff) / (up - 1))) : 24;
      let y = L.tabY;
      col.forEach((id, j) => {
        const isUp = j >= down;
        place(id, colX(i), Math.round(y), j + 1, isUp, { pile: "tableau", index: i, pos: j });
        y += isUp ? upOff : downOff;
      });
    });
    syncMarks();
    renderInfo();
    renderFoot();
  }

  const fmtTime = (ms) => {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };

  function renderInfo() {
    const s = g.s;
    $("game").textContent = `#${s.seed} · ${s.suits} ${s.suits === 1 ? "suit" : "suits"}`;
    $("runs").textContent = `Runs ${s.found.length}/${S.SETS}`;
    $("moves").textContent = `${s.moves} ${s.moves === 1 ? "move" : "moves"}`;
    $("time").textContent = fmtTime(g.elapsed);
  }

  function renderFoot() {
    $("undo").disabled = !S.canUndo(g.s);
    $("hint").disabled = g.done;
    const b = stats.best[g.s.suits];
    $("stats").textContent = `Won ${stats.won} of ${stats.played}` + (b ? ` · Best ${fmtTime(b.time * 1000)}` : "");
    if (!noteT) setNote(g.s.stock.length ? `${g.s.stock.length / S.DEAL_SIZE} ${g.s.stock.length === S.DEAL_SIZE ? "deal" : "deals"} left` : "", false);
  }

  /** The line between the foundations and the stock. `flash` keeps it on screen for a moment. */
  function setNote(text, hot, ms = 0) {
    noteEl.textContent = text;
    noteEl.classList.toggle("hint", !!hot);
    clearTimeout(noteT);
    noteT = null;
    if (ms) noteT = setTimeout(() => { noteT = null; if (g) renderFoot(); }, ms);
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

  function clearHint() {
    hintMark = null;
    clearTimeout(hintT);
    hintT = null;
    if (noteT) { clearTimeout(noteT); noteT = null; }
  }

  function commit(next) {
    if (!next) { render(); return; }
    const first = g.s.moves === 0;
    g.s = next;
    sel = null;
    clearHint();
    if (first) {
      lastTick = Date.now();
      if (!g.counted) { g.counted = true; stats.played++; saveStats(); }
    }
    saveSoon();
    render();
    if (S.isWon(next)) finish();
  }

  function newGame() {
    g = { s: S.deal(C.randomSeed(), suitsOpt()), elapsed: 0, counted: false, done: false };
    sel = null;
    clearHint();
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
    const secs = Math.round(g.elapsed / 1000), key = String(g.s.suits), best = stats.best[key] || {};
    const badges = [];
    stats.won++;
    if (best.time == null || secs < best.time) { best.time = secs; badges.push("Best time"); }
    if (best.moves == null || g.s.moves < best.moves) { best.moves = g.s.moves; badges.push("Fewest moves"); }
    stats.best[key] = best;
    saveStats();
    flush();
    renderFoot();
    showWin(badges);
  }

  function showWin(badges) {
    $("win-line").textContent = `Game #${g.s.seed} · ${g.s.suits} ${g.s.suits === 1 ? "suit" : "suits"} · ${g.s.moves} moves · ${fmtTime(g.elapsed)}`;
    $("win-best").textContent = badges.length ? `New record: ${badges.join(" and ")}` : "";
    const rnd = C.mulberry32(g.s.seed);
    $("bits").innerHTML = Array.from({ length: 18 }, (_, i) => {
      const suit = i % g.s.suits, red = suit === 1 || suit === 2;
      return `<span class="bit${red ? " red" : ""}" style="left:${(4 + rnd() * 88).toFixed(1)}%;top:${(6 + rnd() * 84).toFixed(1)}%;` +
        `font-size:${Math.round(18 + rnd() * 20)}px;animation-delay:calc(${(rnd() * 1.2).toFixed(2)}s * var(--motion-scale, 1))">${GLYPH[suit]}</span>`;
    }).join("");
    $("win").hidden = false;
  }

  // ---------- input ----------

  const pt = (e) => { const r = board.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /** What a click on a card does as a source: the run that would move, or null. */
  function sourceOf(id) {
    const s = g.s, l = loc[id];
    if (!l || l.pile !== "tableau") return null;
    const n = S.movableCount(s, l.index, l.pos);
    return n ? { from: { index: l.index, count: n }, ids: s.tableau[l.index].slice(l.pos) } : null;
  }

  /** The pile under a board point (for clicks on empty space). */
  function hit(x, y) {
    if (y >= L.stripTop) return x >= L.stockX - 110 ? { pile: "stock" } : null;
    const ci = Math.round((x - L.padX - L.cw / 2) / L.step);
    if (ci < 0 || ci > 9 || Math.abs(x - (colX(ci) + L.cw / 2)) > L.cw / 2 + 3) return null;
    return { pile: "tableau", index: ci };
  }

  function dealRow() {
    sel = null;
    const next = S.applyMove(g.s, { type: "deal" });
    if (next) { commit(next); return; }
    syncMarks();
    if (g.s.stock.length && S.canDeal(g.s) === false) setNote("Fill every empty column first", true, 2200);
  }

  function click(id, x, y) {
    const s = g.s;
    const t = id !== null ? loc[id] : hit(x, y);
    if (!t) { sel = null; syncMarks(); return; }
    if (t.pile === "stock") { dealRow(); return; }
    if (t.pile !== "tableau") { sel = null; syncMarks(); return; }
    if (sel) {
      if (id !== null && sel.ids[0] === id) { sel = null; syncMarks(); return; }
      if (t.index !== sel.from.index) {
        const next = S.applyMove(s, { type: "move", from: sel.from, to: { index: t.index } });
        if (next) { commit(next); return; }
      }
    }
    sel = id !== null ? sourceOf(id) : null;
    syncMarks();
  }

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  }

  /** The legal column that the dragged cards cover most, or -1. */
  function findDrop(d) {
    const b = pos[d.ids[0]], x = b.x + d.dx, y = b.y + d.dy;
    let best = -1, bestArea = L.cw * L.ch * 0.12;
    for (let i = 0; i < 10; i++) {
      if (!S.isLegalMove(g.s, { type: "move", from: d.from, to: { index: i } })) continue;
      const a = overlap(x, y, L.cw, L.ch, colX(i), L.tabY, L.cw, L.stripTop - L.tabY);
      if (a > bestArea) { bestArea = a; best = i; }
    }
    return best;
  }

  function startDrag() {
    drag.moved = true;
    sel = null;
    clearHint();
    drag.ids.forEach((id, k) => {
      dragIds.add(id);
      shown[id].t = null;
      shown[id].z = null;
      cardEls[id].classList.add("drag");
      cardEls[id].style.zIndex = String(300 + k);
    });
    syncMarks();
  }

  function endDrag(d, drop) {
    for (const id of d.ids) cardEls[id].classList.remove("drag");
    dragIds.clear();
    const to = drop ? findDrop(d) : -1;
    commit(to >= 0 ? S.applyMove(g.s, { type: "move", from: d.from, to: { index: to } }) : null);
  }

  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !g) return;
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

  /** Double-click sends the run to the best legal column (same suit first). */
  board.addEventListener("dblclick", (e) => {
    if (!g) return;
    const el = e.target.closest(".card");
    if (!el) return;
    const src = sourceOf(Number(el.dataset.id));
    const to = src ? S.targets(g.s, src.from.index, src.from.count)[0] : undefined;
    sel = null;
    if (to !== undefined) commit(S.applyMove(g.s, { type: "move", from: src.from, to: { index: to } })); else syncMarks();
  });

  board.addEventListener("contextmenu", (e) => e.preventDefault());

  function undo() {
    const prev = S.undo(g.s);
    if (!prev) return;
    g.s = prev;
    sel = null;
    clearHint();
    saveSoon();
    render();
  }

  function showHint() {
    if (g.done) return;
    clearHint();
    sel = null;
    const m = S.hint(g.s);
    if (!m) {
      setNote(g.s.stock.length && !S.canDeal(g.s) ? "Fill every empty column to deal" : "No moves left, try Undo", true, 2400);
      syncMarks();
      return;
    }
    if (m.type === "deal") {
      setNote("Deal a new row", true, 2400);
      syncMarks();
      return;
    }
    const col = g.s.tableau[m.from.index], dest = g.s.tableau[m.to.index];
    hintMark = { ids: col.slice(col.length - m.from.count), toId: dest.length ? dest[dest.length - 1] : null, toIndex: m.to.index };
    syncMarks();
    hintT = setTimeout(() => { hintMark = null; hintT = null; syncMarks(); }, 2400);
  }

  $("undo").onclick = undo;
  $("hint").onclick = showHint;
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
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (g) undo(); } });

  setInterval(() => {
    const now = Date.now(), dt = Math.min(now - lastTick, 2500);
    lastTick = now;
    if (g && document.visibilityState === "visible" && g.s.moves > 0 && !g.done) { g.elapsed += dt; renderInfo(); }
  }, 1000);
  document.addEventListener("visibilitychange", () => { lastTick = Date.now(); if (document.visibilityState === "hidden") flush(); });

  umbra.onSettings(() => {
    if (!g) return;
    if (g.s.suits !== suitsOpt()) { newGame(); return; } // a different suit count means a new game
    measure();
    for (const c of shown) { c.t = null; c.z = null; }
    render();
  });

  (async () => {
    await umbra.ready;
    const [saved, st] = await Promise.all([umbra.store.get("game", null), umbra.store.get("stats", null)]);
    if (st && typeof st === "object") stats = { played: Number(st.played) || 0, won: Number(st.won) || 0, best: st.best && typeof st.best === "object" ? st.best : {} };
    build();
    measure();
    if (saved && S.isValidState(saved.s) && saved.s.suits === suitsOpt()) {
      g = { s: saved.s, elapsed: Math.max(0, Number(saved.elapsed) || 0), counted: !!saved.counted, done: !!saved.done };
    } else {
      g = { s: S.deal(C.randomSeed(), suitsOpt()), elapsed: 0, counted: false, done: false };
    }
    lastTick = Date.now();
    renderInstant();
    if (S.isWon(g.s)) { if (g.done) showWin([]); else finish(); }
    requestAnimationFrame(() => requestAnimationFrame(() => umbra.rendered()));
  })();
})();
