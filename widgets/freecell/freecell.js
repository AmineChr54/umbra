// FreeCell UI. Rules live in freecell-rules.js, card helpers in cards.js; this file draws the board and handles
// input. Saved in umbra.store: "game" (state with its undo stack) and "stats" (played, won, streak, bests).
(function () {
  "use strict";
  const K = window.FreeCell, C = window.Cards;
  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const GLYPH = C.SUIT_GLYPHS.map((x) => x + "︎"); // text presentation, never the emoji look

  let g = null;                                      // { s: state, counted: bool, done: bool }
  let stats = { played: 0, won: 0, streak: 0, bestStreak: 0, bestMoves: null };
  let sel = null;                                    // { from, ids } picked by a click
  let drag = null;                                   // pointer gesture in progress
  let busy = false;                                  // auto-move is running
  let autoToken = 0;
  let armedBtn = null, armTimer = null;              // buttons that would drop a game in progress ask twice
  let L = null;                                      // layout in px
  const dragIds = new Set();
  const cardEls = [], shown = [], loc = [], pos = [];
  const slots = {};
  const LABELS = { new: "New game", restart: "Restart", play: "Play" };

  const autoOpt = () => umbra.options.autoMove !== false;
  const inProgress = () => g.counted && !g.done;

  // ---------- layout ----------

  const colX = (i) => L.padX + i * L.step;

  function measure() {
    const W = board.clientWidth || 560, H = board.clientHeight || 492;
    const padX = 8, cw = Math.floor((W - 2 * padX - 7 * 6) / 8), ch = Math.round(cw * 1.4);
    L = { W, H, cw, ch, padX, step: (W - 2 * padX - cw) / 7, topY: 6, tabY: 6 + ch + 14 };
    for (const el of cardEls) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    for (const el of Object.values(slots)) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    const put = (key, i, y) => { slots[key].style.transform = `translate(${colX(i)}px,${y}px)`; };
    for (let i = 0; i < 4; i++) { put("cell" + i, i, L.topY); put("f" + i, 4 + i, L.topY); }
    for (let i = 0; i < 8; i++) put("col" + i, i, L.tabY);
  }

  function build() {
    const mkSlot = (key, text, cls) => {
      const el = document.createElement("div");
      el.className = "slot " + cls;
      el.textContent = text;
      board.append(el);
      slots[key] = el;
    };
    for (let i = 0; i < 4; i++) mkSlot("cell" + i, "", "cell");
    for (let i = 0; i < 4; i++) mkSlot("f" + i, "A", "found");
    for (let i = 0; i < 8; i++) mkSlot("col" + i, "", "col");
    for (let id = 0; id < 52; id++) {
      const rank = C.rankOf(id), lab = C.rankLabel(rank), gl = GLYPH[C.suitOf(id)];
      const el = document.createElement("div");
      el.className = "card" + (C.isRed(id) ? " red" : "");
      el.dataset.id = String(id);
      el.setAttribute("aria-label", C.name(id));
      const mid = rank >= 11 ? `<span class="rk">${lab}</span><span class="sm">${gl}</span>` : `<span class="pip">${gl}</span>`;
      el.innerHTML = `<div class="face"><span class="corner tl">${lab}<i>${gl}</i></span>` +
        `<span class="mid">${mid}</span><span class="corner br">${lab}<i>${gl}</i></span></div>`;
      board.append(el);
      cardEls.push(el);
      shown.push({});
    }
  }

  // ---------- drawing ----------

  function place(id, x, y, z, where) {
    const el = cardEls[id], c = shown[id];
    pos[id] = { x, y };
    loc[id] = where;
    if (dragIds.has(id)) return;
    const t = `translate(${x}px,${y}px)`;
    if (c.t !== t) { el.style.transform = t; c.t = t; }
    if (c.z !== z) { el.style.zIndex = String(z); c.z = z; }
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
    s.cells.forEach((id, i) => { if (id !== null) place(id, colX(i), L.topY, 1, { pile: "cell", index: i }); });
    s.foundations.forEach((f, i) => f.forEach((id, j) => place(id, colX(4 + i), L.topY, j + 1, { pile: "foundation", index: i, pos: j })));
    const avail = L.H - L.tabY - 6;
    s.tableau.forEach((col, i) => {
      const n = col.length;
      const off = n > 1 ? Math.max(10, Math.min(26, (avail - L.ch) / (n - 1))) : 26;
      col.forEach((id, j) => place(id, colX(i), Math.round(L.tabY + j * off), j + 1, { pile: "tableau", index: i, pos: j }));
    });
    syncSel();
    renderInfo();
    renderFoot();
  }

  function renderInfo() {
    const s = g.s, stuck = !g.done && !busy && !K.isWon(s) && !K.hasMoves(s);
    $("game").textContent = `Game #${s.seed}`;
    $("moves").textContent = stuck ? "No moves left" : `${s.moves} ${s.moves === 1 ? "move" : "moves"}`;
    $("moves").classList.toggle("stuck", stuck);
  }

  function renderFoot() {
    $("undo").disabled = busy || !K.canUndo(g.s);
    $("restart").disabled = busy || g.done || g.s.moves === 0;
    $("stats").textContent = `Won ${stats.won}/${stats.played} · Streak ${stats.streak}`;
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
    g.s = next;
    sel = null;
    if (!g.counted) { g.counted = true; stats.played++; saveStats(); }
    saveSoon();
    render();
    if (K.isWon(next)) finish(); else maybeAuto();
  }

  /** Start another deal. A game that was started and not won ends the streak. */
  function startGame(seed, keepCounted) {
    autoToken++;
    busy = false;
    if (!keepCounted && inProgress()) { stats.streak = 0; saveStats(); }
    g = { s: K.deal(seed), counted: !!keepCounted, done: false };
    sel = null;
    $("win").hidden = true;
    disarm();
    renderInstant();
    flush();
  }
  const newGame = () => startGame(C.randomSeed(), false);

  function disarm() {
    if (armedBtn) { armedBtn.textContent = LABELS[armedBtn.id]; armedBtn.classList.remove("warn"); }
    armedBtn = null;
    clearTimeout(armTimer);
  }

  /** Run `fn` at once, or after a second click on the same button when a game is in progress. */
  function guarded(btn, fn) {
    if (g && inProgress() && armedBtn !== btn) {
      disarm();
      armedBtn = btn;
      btn.textContent = "Sure?";
      btn.classList.add("warn");
      armTimer = setTimeout(disarm, 2500);
    } else { disarm(); fn(); }
  }

  function finish() {
    if (g.done) return;
    g.done = true;
    const badges = [];
    stats.won++;
    stats.streak++;
    if (stats.streak > stats.bestStreak) { stats.bestStreak = stats.streak; if (stats.streak > 1) badges.push("Best streak"); }
    if (stats.bestMoves == null || g.s.moves < stats.bestMoves) { stats.bestMoves = g.s.moves; badges.push("Fewest moves"); }
    saveStats();
    flush();
    renderFoot();
    showWin(badges);
  }

  function showWin(badges) {
    $("win-line").textContent = `Game #${g.s.seed} · ${g.s.moves} moves · Streak ${stats.streak}`;
    $("win-best").textContent = badges.length ? `New record: ${badges.join(" and ")}` : "";
    const rnd = C.mulberry32(g.s.seed);
    $("bits").innerHTML = Array.from({ length: 18 }, (_, i) => {
      const suit = i % 4, red = suit === 1 || suit === 2;
      return `<span class="bit${red ? " red" : ""}" style="left:${(4 + rnd() * 88).toFixed(1)}%;top:${(6 + rnd() * 84).toFixed(1)}%;` +
        `font-size:${Math.round(18 + rnd() * 20)}px;animation-delay:calc(${(rnd() * 1.2).toFixed(2)}s * var(--motion-scale, 1))">${GLYPH[suit]}</span>`;
    }).join("");
    $("win").hidden = false;
  }

  // ---------- auto-move ----------

  function maybeAuto() {
    if (busy || g.done || g.s.moves === 0 || !autoOpt()) return;
    if (K.nextAutoMove(g.s)) runAuto();
  }

  function runAuto() {
    const plan = K.autoPlan(g.s);
    if (!plan.length || busy) return;
    const token = ++autoToken;
    busy = true;
    sel = null;
    const delay = document.documentElement.dataset.motion === "off" ? 25 : 90;
    const step = () => {
      if (token !== autoToken) return;
      const next = plan.length ? K.applyMove(g.s, plan.shift(), { auto: true }) : null;
      if (!next) { busy = false; render(); return; }
      g.s = next;
      saveSoon();
      if (K.isWon(next)) { busy = false; render(); finish(); return; }
      render();
      if (plan.length) setTimeout(step, delay); else { busy = false; render(); }
    };
    step();
  }

  // ---------- input ----------

  const pt = (e) => { const r = board.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /** What picking a card as a source means: the cards that would move, or null. */
  function sourceOf(id) {
    const s = g.s, l = loc[id];
    if (!l) return null;
    if (l.pile === "cell") return { from: { pile: "cell", index: l.index }, ids: [id] };
    if (l.pile === "tableau") {
      const n = K.runFrom(s, l.index, l.pos);
      return n ? { from: { pile: "tableau", index: l.index, count: n }, ids: s.tableau[l.index].slice(l.pos) } : null;
    }
    return null;
  }

  /** The pile under a board point (for clicks on empty space). */
  function hit(x, y) {
    const ci = Math.round((x - L.padX - L.cw / 2) / L.step);
    if (ci < 0 || ci > 7 || Math.abs(x - (colX(ci) + L.cw / 2)) > L.cw / 2 + 3) return null;
    if (y < L.tabY - 6) {
      if (y > L.topY + L.ch + 4) return null;
      return ci < 4 ? { pile: "cell", index: ci } : { pile: "foundation", index: ci - 4 };
    }
    return { pile: "tableau", index: ci };
  }

  function click(id, x, y) {
    const s = g.s;
    const t = id !== null ? loc[id] : hit(x, y);
    if (!t) { sel = null; syncSel(); return; }
    if (sel) {
      if (id !== null && sel.ids[0] === id) { sel = null; syncSel(); return; }
      const next = K.applyMove(s, { from: sel.from, to: { pile: t.pile, index: t.index } });
      if (next) { commit(next); return; }
    }
    sel = id !== null ? sourceOf(id) : null;
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
      if (!K.isLegalMove(g.s, { from: d.from, to })) return;
      const a = overlap(x, y, L.cw, L.ch, rx, ry, rw, rh);
      if (a > bestArea) { bestArea = a; best = to; }
    };
    for (let i = 0; i < 4; i++) {
      test({ pile: "cell", index: i }, colX(i), L.topY, L.cw, L.ch);
      test({ pile: "foundation", index: i }, colX(4 + i), L.topY, L.cw, L.ch);
    }
    for (let i = 0; i < 8; i++) test({ pile: "tableau", index: i }, colX(i), L.tabY, L.cw, L.H - L.tabY);
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
    commit(to ? K.applyMove(g.s, { from: d.from, to }) : null);
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

  /** Double-click: the card goes to a foundation if it can, otherwise to the first free cell. */
  board.addEventListener("dblclick", (e) => {
    if (busy || !g) return;
    const el = e.target.closest(".card");
    if (!el) return;
    const s = g.s, l = loc[Number(el.dataset.id)];
    let from = null;
    if (l.pile === "cell") from = { pile: "cell", index: l.index };
    else if (l.pile === "tableau" && l.pos === s.tableau[l.index].length - 1) from = { pile: "tableau", index: l.index, count: 1 };
    let move = from && K.autoFoundationMove(s, from);
    if (!move && from && from.pile === "tableau") {
      const cell = K.firstEmptyCell(s);
      if (cell >= 0) move = { from, to: { pile: "cell", index: cell } };
    }
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

  const pickEl = $("pick");
  /** The game number typed in the box, or NaN. */
  function pickedNumber() {
    const m = /^\s*#?\s*(\d{1,6})\s*$/.exec(pickEl.value);
    return m ? Number(m[1]) : NaN;
  }
  function playNumber() {
    const n = pickedNumber();
    if (!K.isSeed(n)) return;
    startGame(n, false);
    pickEl.value = "";
    pickEl.blur();
  }

  $("undo").onclick = undo;
  $("restart").onclick = () => guarded($("restart"), () => startGame(g.s.seed, true));
  $("new").onclick = () => guarded($("new"), newGame);
  $("play").onclick = () => {
    if (!pickEl.value.trim()) { pickEl.focus(); return; }
    if (K.isSeed(pickedNumber())) { guarded($("play"), playNumber); return; }
    pickEl.classList.add("bad");
    setTimeout(() => pickEl.classList.remove("bad"), 1200);
  };
  pickEl.addEventListener("input", () => pickEl.classList.remove("bad"));
  pickEl.addEventListener("keydown", (e) => { if (e.key === "Enter") $("play").click(); });
  $("win-new").onclick = newGame;
  $("win-close").onclick = () => { $("win").hidden = true; };
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.target !== pickEl) { e.preventDefault(); undo(); }
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  umbra.onSettings(() => {
    if (!g) return;
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
    if (saved && K.isValidState(saved.s)) g = { s: saved.s, counted: !!saved.counted, done: !!saved.done };
    else g = { s: K.deal(C.randomSeed()), counted: false, done: false };
    renderInstant();
    if (K.isWon(g.s)) { if (g.done) showWin([]); else finish(); }
    requestAnimationFrame(() => requestAnimationFrame(() => umbra.rendered()));
    maybeAuto();
  })();
})();
