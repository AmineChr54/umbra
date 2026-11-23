// Hearth pet mini-games: Berry Catch, Flame Memory, Hide and Seek. Plain DOM inside the pet's sheet; each game calls
// done(score) once and returns stop() for when the sheet closes. The score goes to the relay's `play` (pet.js), which
// clamps it and pays Embers; nothing here decides a reward.
(() => {
  "use strict";
  const WL = window.HearthWorldLogic;
  const M = window.HearthMascot;

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  // ---------- Berry Catch: 30 s, move the bowl, berries +1, acorns cost one of 3 hearts ----------
  function berryCatch(box, done) {
    const area = el("div", "gm-area gm-catch");
    const hud = el("div", "gm-hud num");
    const bowl = el("div", "gm-bowl");
    area.append(bowl);
    box.append(hud, area);
    let x = 0.5, score = 0, hearts = 3, t0 = performance.now(), last = t0, spawnAt = t0 + 300, raf = 0, over = false;
    const things = [];
    const rand = WL.rng(Date.now() & 0xffffffff);
    const W = () => area.clientWidth, H = () => area.clientHeight;
    const setX = (px) => { x = Math.max(0.08, Math.min(0.92, px / Math.max(1, W()))); };
    area.addEventListener("pointermove", (e) => { const r = area.getBoundingClientRect(); setX(e.clientX - r.left); });
    area.addEventListener("pointerdown", (e) => { const r = area.getBoundingClientRect(); setX(e.clientX - r.left); });
    const key = (e) => { if (e.key === "ArrowLeft") { x = Math.max(0.08, x - 0.08); e.preventDefault(); } if (e.key === "ArrowRight") { x = Math.min(0.92, x + 0.08); e.preventDefault(); } };
    document.addEventListener("keydown", key);
    function frame(now) {
      if (over) return;
      const dt = Math.min(50, now - last); last = now;
      const elapsed = now - t0;
      if (now >= spawnAt) {
        const acorn = rand() < WL.acornChance(elapsed);
        const n = el("div", acorn ? "gm-acorn" : "gm-berry");
        area.append(n);
        things.push({ n, x: 0.06 + rand() * 0.88, y: -0.05, v: 0.00028 + rand() * 0.00018 + elapsed / 30000 * 0.00025, acorn });
        spawnAt = now + Math.max(320, 760 - elapsed / 30000 * 420);
      }
      const bw = 0.16;
      for (let i = things.length - 1; i >= 0; i--) {
        const t = things[i];
        t.y += t.v * dt;
        if (t.y > 0.84 && t.y < 0.95 && Math.abs(t.x - x) < bw / 2 + 0.03) {
          if (t.acorn) { hearts--; area.classList.remove("gm-hit"); void area.offsetWidth; area.classList.add("gm-hit"); }
          else { score++; bowl.classList.remove("gm-yum"); void bowl.offsetWidth; bowl.classList.add("gm-yum"); }
          t.n.remove(); things.splice(i, 1); continue;
        }
        if (t.y > 1.05) { t.n.remove(); things.splice(i, 1); continue; }
        t.n.style.transform = `translate(${t.x * W() - 9}px, ${t.y * H()}px)`;
      }
      bowl.style.transform = `translateX(${x * W() - bowl.offsetWidth / 2}px)`;
      const left = Math.max(0, 30 - elapsed / 1000);
      hud.innerHTML = `<span>${score} berries</span><span>${"♥".repeat(Math.max(0, hearts))}${"♡".repeat(3 - Math.max(0, hearts))}</span><span>${Math.ceil(left)} s</span>`;
      if (left <= 0 || hearts <= 0) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    function finish() { if (over) return; over = true; cancelAnimationFrame(raf); document.removeEventListener("keydown", key); done(score); }
    raf = requestAnimationFrame(frame);
    return () => { over = true; cancelAnimationFrame(raf); document.removeEventListener("keydown", key); };
  }

  // ---------- Flame Memory: repeat the growing sequence of four coloured flames ----------
  function flameMemory(box, done) {
    const hud = el("div", "gm-hud num");
    const pads = el("div", "gm-pads");
    const cols = ["#F7A8C4", "#FFF3B0", "#BFE6F5", "#DDF0C8"];
    const btns = cols.map((c, i) => { const b = el("button", "gm-pad", `<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 46 C6 42 6 26 14 18 C14 26 18 28 20 22 C22 16 19 8 25 2 C28 12 38 20 36 32 C35 42 30 46 20 46 Z" fill="${c}" stroke="#6B4F3A" stroke-width="3" stroke-linejoin="round"/></svg>`); b.type = "button"; b.dataset.i = i; b.setAttribute("aria-label", "Flame " + (i + 1)); pads.append(b); return b; });
    box.append(hud, pads);
    const rand = WL.rng(Date.now() & 0xffffffff);
    const seq = [];
    let at = 0, round = 0, input = false, stopped = false, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };
    const flash = (i, ms) => { btns[i].classList.add("on"); later(() => btns[i].classList.remove("on"), ms); };
    function next() {
      if (stopped) return;
      seq.push(WL.memorySequence(rand, 1)[0]);
      round = seq.length; at = 0; input = false;
      hud.innerHTML = `<span>Round ${round}</span><span>Watch...</span>`;
      const step = Math.max(260, 620 - round * 25);
      seq.forEach((v, k) => later(() => flash(v, step * 0.7), 500 + k * step));
      later(() => { input = true; hud.innerHTML = `<span>Round ${round}</span><span>Your turn</span>`; }, 500 + seq.length * step);
    }
    pads.addEventListener("click", (e) => {
      const b = e.target.closest(".gm-pad");
      if (!b || !input || stopped) return;
      const i = Number(b.dataset.i);
      flash(i, 220);
      if (i !== seq[at]) { input = false; stopped = true; pads.classList.add("gm-wrong"); later(() => done(round - 1), 700); return; }
      at++;
      if (at === seq.length) { input = false; if (round >= WL.GAMES.memory.max) { stopped = true; later(() => done(round), 400); } else later(next, 650); }
    });
    later(next, 300);
    return () => { stopped = true; timers.forEach(clearTimeout); };
  }

  // ---------- Hide and Seek: the blob hides under a pot, the pots shuffle, pick the right one ----------
  function hideAndSeek(box, done) {
    const hud = el("div", "gm-hud num");
    const stage = el("div", "gm-seek");
    const blob = el("div", "gm-hider", M.renderSvg({ mood: "happy", level: 3 }));
    const pots = [0, 1, 2].map((i) => { const p = el("button", "gm-pot", `<svg viewBox="0 0 60 56" aria-hidden="true"><path d="M8 12 H52 L46 52 H14 Z" fill="#E59866" stroke="#6B4F3A" stroke-width="3" stroke-linejoin="round"/><rect x="4" y="6" width="52" height="10" rx="4" fill="#F2B07D" stroke="#6B4F3A" stroke-width="3"/></svg>`); p.type = "button"; p.setAttribute("aria-label", "Pot " + (i + 1)); stage.append(p); return p; });
    stage.append(blob);
    box.append(hud, stage);
    const rand = WL.rng(Date.now() & 0xffffffff);
    let slots = [0, 1, 2];          // slots[pot] = position 0..2
    let hidden = 0, found = 0, picking = false, stopped = false, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };
    const place = (ms) => pots.forEach((p, i) => { p.style.transition = `left ${ms}ms ease-in-out`; p.style.left = `${8 + slots[i] * 32}%`; });
    function round() {
      if (stopped) return;
      const r = WL.seekRound(found + 1);
      picking = false;
      hidden = Math.floor(rand() * 3);
      hud.innerHTML = `<span>Found ${found}</span><span>Watch the blob...</span>`;
      place(0);
      blob.style.left = `${8 + slots[hidden] * 32}%`;
      blob.className = "gm-hider show";
      later(() => { blob.className = "gm-hider in"; }, 700);
      let k = 0;
      const swap = () => {
        if (stopped) return;
        if (k++ >= r.swaps) { picking = true; hud.innerHTML = `<span>Found ${found}</span><span>Where is it?</span>`; return; }
        const a = Math.floor(rand() * 3), b = (a + 1 + Math.floor(rand() * 2)) % 3;
        const ia = slots.indexOf(a), ib = slots.indexOf(b);
        slots[ia] = b; slots[ib] = a;
        place(r.ms);
        later(swap, r.ms + 60);
      };
      later(swap, 1200);
    }
    stage.addEventListener("click", (e) => {
      const p = e.target.closest(".gm-pot");
      if (!p || !picking || stopped) return;
      picking = false;
      const i = pots.indexOf(p);
      blob.style.left = `${8 + slots[hidden] * 32}%`;
      blob.className = "gm-hider show";
      if (i === hidden) { found++; p.classList.add("gm-right"); later(() => { p.classList.remove("gm-right"); if (found >= WL.GAMES.seek.max) { stopped = true; done(found); } else round(); }, 900); }
      else { p.classList.add("gm-miss"); stopped = true; later(() => done(found), 1100); }
    });
    later(round, 300);
    return () => { stopped = true; timers.forEach(clearTimeout); };
  }

  const GAMES = { catch: berryCatch, memory: flameMemory, seek: hideAndSeek };
  /** Start a game in `box` (emptied first). done(score) is called once. Returns stop(). */
  function start(box, id, done) {
    box.innerHTML = "";
    let called = false;
    const once = (s) => { if (!called) { called = true; done(Math.max(0, Math.floor(s))); } };
    return GAMES[id] ? GAMES[id](box, once) : () => {};
  }
  window.HearthGames = { start };
})();
