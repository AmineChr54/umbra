// Hearth pet mini-games (2.1): Berry Catch, Flame Memory, Hide and Seek, Bubble Bath and Star Hop, drawn on one canvas
// that is sized to its box times devicePixelRatio, so they stay sharp at any widget size and zoom. One small engine
// (resize, loop, pointer and keys, particles, the start and end cards) runs every game. Each game calls end(score)
// once; the score goes to the relay's `play` (pet.js), which clamps it and pays Embers: nothing here decides a reward.
(() => {
  "use strict";
  const WL = window.HearthWorldLogic;

  const C = {
    ink: "#4A3426", brown: "#6B4F3A", soft: "#8A7462", pink: "#F7A8C4", pinkDeep: "#E5648F", butter: "#FFF3B0", gold: "#FFD447",
    green: "#DDF0C8", greenDeep: "#B7DA98", grass: "#9CCB78", water: "#BFE6F5", blue: "#7CC6EA", card: "#FFFBEA", white: "#FFFFFF",
  };
  const FONT = (px, w) => `${w || 800} ${Math.max(11, Math.round(px))}px Nunito, "Segoe UI", system-ui, sans-serif`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const motionOff = () => document.documentElement.getAttribute("data-motion") === "off";

  // Shapes as SVG path data (Path2D), drawn at a scale.
  const FLAME = new Path2D("M17 38 C5 35 4 22 10 15 C10 21 14 23 16 19 C18 15 15 9 20 2 C24 10 32 16 30 27 C29 34 24 38 17 38 Z");
  const FLAME_IN = new Path2D("M17 38 C12 36 12 29 17 25 C19 28 23 30 23 33 C23 36 20 38 17 38 Z");
  const STAR = new Path2D("M0 -10 L2.9 -3.6 L9.5 -3.1 L4.5 1.4 L5.9 8.1 L0 4.6 L-5.9 8.1 L-4.5 1.4 L-9.5 -3.1 L-2.9 -3.6 Z");
  const LEAF = new Path2D("M0 0 Q5 -7 10 -4 Q5 1 0 0 Z");

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function text(c, s, x, y, px, opts) {
    const o = opts || {};
    c.font = FONT(px, o.weight);
    c.textAlign = o.align || "left"; c.textBaseline = o.base || "middle";
    if (o.stroke) { c.lineWidth = Math.max(2, px / 5); c.strokeStyle = o.stroke; c.lineJoin = "round"; c.strokeText(s, x, y); }
    c.fillStyle = o.color || C.ink; c.fillText(s, x, y);
  }
  function wrap(c, s, maxW, px) {
    c.font = FONT(px, 700);
    const out = [];
    let line = "";
    for (const w of String(s).split(" ")) {
      const t = line ? line + " " + w : w;
      if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  function outline(c, w) { c.lineWidth = w; c.strokeStyle = C.brown; c.lineJoin = "round"; c.lineCap = "round"; c.stroke(); }
  function circle(c, x, y, r, fill, lw) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); if (lw) outline(c, lw); }
  function hearts(c, x, y, n, of, s) {
    for (let i = 0; i < of; i++) {
      c.save(); c.translate(x - i * s * 1.25, y); c.scale(s / 16, s / 16);
      c.beginPath(); c.moveTo(0, 6); c.bezierCurveTo(-12, -2, -8, -11, 0, -5); c.bezierCurveTo(8, -11, 12, -2, 0, 6); c.closePath();
      c.fillStyle = i < n ? C.pinkDeep : "#EADFD0"; c.fill(); outline(c, 2.2); c.restore();
    }
  }
  function timeBar(c, x, y, w, h, frac) {
    roundRect(c, x, y, w, h, h / 2); c.fillStyle = C.white; c.fill(); outline(c, 1.6);
    if (frac > 0) { roundRect(c, x + 1.5, y + 1.5, Math.max(h - 3, (w - 3) * frac), h - 3, (h - 3) / 2); c.fillStyle = frac < 0.2 ? C.pinkDeep : C.grass; c.fill(); }
  }
  /** The pet as an image (the mascot's own SVG), for the games that show it. */
  function petImage(svg) {
    if (!svg) return null;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg width="200" height="200" '));
    return img;
  }
  function drawPet(c, img, x, y, size, sx, sy) {
    c.save(); c.translate(x, y); c.scale(sx || 1, sy || 1);
    if (img && img.complete && img.naturalWidth) c.drawImage(img, -size / 2, -size, size, size);
    else { circle(c, 0, -size * 0.42, size * 0.34, C.green, 2.4); circle(c, -size * 0.1, -size * 0.46, size * 0.03, C.ink); circle(c, size * 0.1, -size * 0.46, size * 0.03, C.ink); }
    c.restore();
  }

  // ---------- Berry Catch: 30 s, 3 hearts; golden berries count 3, catches in a row make a combo ----------
  function berryCatch(g) {
    let items = [], spawnIn = 0.5, lives = 3, score = 0, combo = 0, bowlX = 0, timeLeft = 30, squash = 0;
    const bowlW = () => Math.max(46, g.W * 0.2), bowlH = () => Math.max(16, g.u * 15);
    return {
      begin() { bowlX = g.W / 2; },
      update(dt) {
        timeLeft -= dt;
        if (timeLeft <= 0) return g.end(score, "Time's up!");
        const el = 30 - timeLeft, bw = bowlW();
        const keyDir = (g.keys.ArrowRight || g.keys.d ? 1 : 0) - (g.keys.ArrowLeft || g.keys.a ? 1 : 0);
        if (keyDir) g.pointer.active = false;
        const target = g.pointer.active ? g.pointer.x : bowlX + keyDir * g.W * 1.4 * dt;
        bowlX += (clamp(target, bw / 2, g.W - bw / 2) - bowlX) * Math.min(1, dt * 20);
        squash = Math.max(0, squash - dt * 5);
        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawnIn = lerp(0.8, 0.36, el / 30) * (0.75 + g.rand() * 0.5);
          const r = g.rand();
          const kind = r < WL.acornChance(el * 1000) ? "acorn" : g.rand() < 0.08 ? "gold" : "berry";
          const size = g.u * 9;
          items.push({ x: size + g.rand() * (g.W - size * 2), y: -size, vy: g.H * lerp(0.42, 0.95, el / 30) * (0.85 + g.rand() * 0.3), kind, r: size, spin: g.rand() * 6 });
        }
        const top = g.H - g.u * 8 - bowlH();
        for (const it of items) {
          const prev = it.y;
          it.y += it.vy * dt; it.spin += dt * 3;
          if (!it.gone && prev + it.r <= top + 4 && it.y + it.r >= top && Math.abs(it.x - bowlX) <= bw / 2 + it.r * 0.25) {
            it.gone = true;
            if (it.kind === "acorn") {
              lives -= 1; combo = 0; g.shake(7); g.burst(it.x, top, "#A06A3D", 8); g.popup(it.x, top - 14, "Ouch!", C.brown);
              if (lives <= 0) return g.end(score, "Out of hearts!");
            } else {
              const pts = WL.catchPoints(it.kind === "gold", combo);
              combo += 1; score += pts; squash = 1;
              g.burst(it.x, top, it.kind === "gold" ? C.gold : C.pinkDeep, it.kind === "gold" ? 14 : 7);
              g.popup(it.x, top - 14, "+" + pts, it.kind === "gold" ? "#C98A00" : C.pinkDeep);
              if (combo === 5 || combo === 10) g.popup(g.W / 2, g.H * 0.4, combo === 5 ? "Combo x2!" : "Combo x3!", C.pinkDeep, 1.5);
            }
          } else if (!it.gone && it.y - it.r > g.H) { it.gone = true; if (it.kind !== "acorn" && combo) { combo = 0; g.popup(it.x, g.H - 30, "miss", C.soft); } }
        }
        items = items.filter((it) => !it.gone);
      },
      draw(c) {
        const gr = c.createLinearGradient(0, 0, 0, g.H); gr.addColorStop(0, "#CDEBFA"); gr.addColorStop(1, "#FFF8DC");
        c.fillStyle = gr; c.fillRect(0, 0, g.W, g.H);
        c.fillStyle = "#CFE9B4"; c.fillRect(0, g.H - g.u * 8, g.W, g.u * 8);
        c.fillStyle = C.grass; c.fillRect(0, g.H - g.u * 8, g.W, 2);
        for (const it of items) {
          c.save(); c.translate(it.x, it.y);
          if (it.kind === "acorn") {
            c.rotate(Math.sin(it.spin) * 0.3);
            c.beginPath(); c.ellipse(0, it.r * 0.15, it.r * 0.8, it.r * 0.95, 0, 0, Math.PI * 2); c.fillStyle = "#C98A56"; c.fill(); outline(c, 2);
            c.beginPath(); c.ellipse(0, -it.r * 0.45, it.r * 0.95, it.r * 0.5, 0, Math.PI, 0); c.lineTo(it.r * 0.95, -it.r * 0.35); c.lineTo(-it.r * 0.95, -it.r * 0.35); c.closePath(); c.fillStyle = "#7A5634"; c.fill(); outline(c, 2);
            c.beginPath(); c.moveTo(0, -it.r * 0.9); c.lineTo(it.r * 0.25, -it.r * 1.25); outline(c, 2.4);
          } else {
            const gold = it.kind === "gold";
            if (gold && !motionOff()) { c.save(); c.rotate(it.spin); c.globalAlpha = 0.5; c.scale(it.r / 7, it.r / 7); c.fillStyle = C.gold; c.fill(STAR); c.restore(); }
            circle(c, 0, 0, it.r * 0.82, gold ? C.gold : C.pinkDeep, 2.2);
            circle(c, -it.r * 0.28, -it.r * 0.28, it.r * 0.18, "rgba(255,255,255,0.8)");
            c.save(); c.translate(0, -it.r * 0.75); c.rotate(-0.5); c.scale(it.r / 9, it.r / 9); c.fillStyle = "#7DBE5B"; c.fill(LEAF); c.lineWidth = 1.4; c.strokeStyle = C.brown; c.stroke(LEAF); c.restore();
          }
          c.restore();
        }
        // the bowl
        const bw = bowlW(), bh = bowlH(), top = g.H - g.u * 8 - bh;
        c.save(); c.translate(bowlX, top + bh); c.scale(1 + squash * 0.12, 1 - squash * 0.15);
        c.beginPath(); c.moveTo(-bw / 2, -bh); c.quadraticCurveTo(-bw / 2, 0, 0, 0); c.quadraticCurveTo(bw / 2, 0, bw / 2, -bh); c.closePath(); c.fillStyle = C.pink; c.fill(); outline(c, 2.4);
        roundRect(c, -bw / 2 - 3, -bh - 3, bw + 6, 6, 3); c.fillStyle = C.pinkDeep; c.fill(); outline(c, 2);
        c.restore();
        // HUD
        text(c, String(score), 10, 16, 18 * g.k, { stroke: C.white });
        timeBar(c, g.W * 0.3, 9, g.W * 0.4, 12, timeLeft / 30);
        hearts(c, g.W - 16, 16, lives, 3, 14 * g.k);
        if (combo >= 5) text(c, combo >= 10 ? "x3" : "x2", 12, 38, 14 * g.k, { color: C.pinkDeep, stroke: C.white });
      },
      score: () => score,
    };
  }

  // ---------- Flame Memory: watch the flames, repeat them; one more each round ----------
  function flameMemory(g) {
    const COLS = [["#F7A8C4", "#E5648F"], ["#FFE36E", "#F2A93B"], ["#9ED3EE", "#4FA8D8"], ["#B7DA98", "#6FAE52"]];
    const seq = WL.memorySequence(g.rand, 40);
    let round = 1, mode = "wait", t = 0, input = 0, lit = -1, litT = 0, msg = "Watch!", bad = -1;
    const cells = () => {
      const top = 34, size = Math.min((g.W - 30) / 2, (g.H - top - 14) / 2), x0 = (g.W - size * 2 - 10) / 2;
      return [0, 1, 2, 3].map((i) => ({ x: x0 + (i % 2) * (size + 10), y: top + Math.floor(i / 2) * (size + 8), s: size }));
    };
    const hit = (x, y) => cells().findIndex((r) => x >= r.x && x <= r.x + r.s && y >= r.y && y <= r.y + r.s);
    const startRound = () => { mode = "watch"; t = -0.6; msg = round === 1 ? "Watch!" : "Round " + round; };
    const press = (k) => {
      if (mode !== "input" || k < 0) return;
      lit = k; litT = 0.28;
      const r = cells()[k];
      if (k === seq[input]) {
        input += 1; g.burst(r.x + r.s / 2, r.y + r.s / 2, COLS[k][1], 6);
        if (input >= round) {
          if (round >= 40) return g.end(round, "You remembered everything!");
          mode = "next"; t = 0; msg = ["Nice!", "Great!", "Yes!", "Perfect!"][round % 4]; g.popup(g.W / 2, g.H / 2, "+1", C.pinkDeep, 1.4);
        }
      } else { bad = k; g.shake(6); g.end(round - 1, "Oops, that was the " + ["pink", "yellow", "blue", "green"][seq[input]] + " one"); }
    };
    return {
      begin() { startRound(); },
      update(dt) {
        if (litT > 0) { litT -= dt; if (litT <= 0) lit = -1; }
        if (mode === "watch") {
          t += dt;
          const on = Math.max(0.24, 0.58 - round * 0.025), gap = Math.max(0.1, 0.2 - round * 0.006);
          if (t >= 0) {
            const idx = Math.floor(t / (on + gap));
            if (idx >= round) { mode = "input"; input = 0; lit = -1; msg = "Your turn!"; }
            else lit = t - idx * (on + gap) < on ? seq[idx] : -1;
          }
        } else if (mode === "next") { t += dt; if (t > 0.75) { round += 1; startRound(); } }
      },
      tap(x, y) { press(hit(x, y)); },
      key(k) { const i = ["1", "2", "3", "4"].indexOf(k); if (i >= 0) press(i); },
      draw(c) {
        c.fillStyle = "#FFF4E2"; c.fillRect(0, 0, g.W, g.H);
        cells().forEach((r, i) => {
          const on = lit === i, wrong = bad === i;
          c.save();
          roundRect(c, r.x, r.y, r.s, r.s, Math.min(18, r.s * 0.2));
          c.fillStyle = wrong ? "#FFD2CC" : on ? COLS[i][0] : C.card; c.fill(); outline(c, 2.4);
          c.translate(r.x + r.s / 2, r.y + r.s / 2);
          const sc = (r.s * (on ? 0.66 : 0.56)) / 40;
          if (on && !motionOff()) { c.shadowColor = COLS[i][1]; c.shadowBlur = 22; }
          c.scale(sc, sc); c.translate(-17, -20);
          c.globalAlpha = on ? 1 : 0.55;
          c.fillStyle = COLS[i][1]; c.fill(FLAME); c.shadowBlur = 0; c.lineWidth = 2.6 / sc * 0.9; c.strokeStyle = C.brown; c.stroke(FLAME);
          c.fillStyle = on ? C.white : C.butter; c.fill(FLAME_IN);
          c.restore();
        });
        text(c, "Round " + round, 10, 16, 15 * g.k);
        text(c, msg, g.W - 10, 16, 15 * g.k, { align: "right", color: mode === "input" ? C.pinkDeep : C.ink });
      },
      score: () => round - 1,
    };
  }

  // ---------- Hide and Seek: the blob hides under a cup, the cups shuffle, pick the right one ----------
  function hideAndSeek(g) {
    let cups = [0, 1, 2].map((i) => ({ slot: i, lift: 1, dx: 0, dy: 0 })), under = 1, round = 1, found = 0;
    let mode = "show", t = 0, swaps = [], swap = null, picked = -1, msg = "Watch the blob!";
    const slotX = (s) => g.W * (0.2 + s * 0.3);
    const cupW = () => Math.min(g.W * 0.24, g.H * 0.36), cupH = () => cupW() * 0.95;
    const ground = () => g.H - g.u * 10;
    const planRound = () => {
      const r = WL.seekRound(round);
      swaps = [];
      for (let i = 0; i < r.swaps; i++) { const a = Math.floor(g.rand() * 3); let b = Math.floor(g.rand() * 2); if (b >= a) b += 1; swaps.push([a, b]); }
      return r.ms / 1000;
    };
    let swapSec = 0.5;
    const cupAt = (x, y) => cups.findIndex((cp) => Math.abs(x - (slotX(cp.slot) + cp.dx)) <= cupW() / 2 && y >= ground() - cupH() - 10 && y <= ground() + 4);
    return {
      begin() { under = Math.floor(g.rand() * 3); mode = "show"; t = 0; },
      update(dt) {
        t += dt;
        if (mode === "show") { cups.forEach((c) => { c.lift = Math.min(1, c.lift + dt * 4); }); if (t > 1.0) { mode = "hide"; t = 0; msg = "Watch the cups!"; } }
        else if (mode === "hide") { cups.forEach((c) => { c.lift = Math.min(c.lift, 1 - ease(clamp(t / 0.45, 0, 1))); }); if (t > 0.6) { mode = "shuffle"; t = 0; swapSec = planRound(); } }
        else if (mode === "shuffle") {
          if (!swap) {
            if (!swaps.length) { mode = "pick"; msg = "Where is it? Pick a cup!"; return; }
            const [a, b] = swaps.shift();
            const ca = cups.find((c) => c.slot === a), cb = cups.find((c) => c.slot === b);
            swap = { ca, cb, t: 0, from: a, to: b };
          }
          swap.t += dt / swapSec;
          const k = ease(clamp(swap.t, 0, 1)), dist = slotX(swap.to) - slotX(swap.from), arc = Math.sin(Math.PI * k) * cupH() * 0.25;
          swap.ca.dx = dist * k; swap.ca.dy = -arc; swap.cb.dx = -dist * k; swap.cb.dy = arc * 0.4;
          if (swap.t >= 1) { swap.ca.slot = swap.to; swap.cb.slot = swap.from; for (const c of [swap.ca, swap.cb]) { c.dx = 0; c.dy = 0; } swap = null; }
        } else if (mode === "reveal") {
          cups.forEach((c, i) => { if (i === picked || (t > 0.5 && i === under)) c.lift = Math.min(1, c.lift + dt * 4); });
          if (t > 1.3) {
            if (picked === under) { round += 1; mode = "show"; t = 0; msg = "Again, faster!"; }
            else g.end(found, "It was in the other cup!");
          }
        }
      },
      tap(x, y) {
        if (mode !== "pick") return;
        const i = cupAt(x, y);
        if (i < 0) return;
        picked = i; mode = "reveal"; t = 0;
        const cx = slotX(cups[i].slot);
        if (i === under) { found += 1; msg = "Found it!"; g.burst(cx, ground() - cupH(), C.gold, 12); g.popup(cx, ground() - cupH() - 16, "+1", C.pinkDeep, 1.3); if (found >= 15) g.end(found, "Eagle eyes!"); }
        else { msg = "Not there..."; g.shake(5); }
      },
      key(k) { const i = ["1", "2", "3"].indexOf(k); if (i >= 0 && mode === "pick") this.tap(slotX(i), ground() - 4); },
      draw(c) {
        c.fillStyle = "#FFF4E2"; c.fillRect(0, 0, g.W, g.H);
        c.fillStyle = "#E9C9A0"; c.fillRect(0, ground(), g.W, g.H - ground());
        c.fillStyle = "#C99A6B"; c.fillRect(0, ground(), g.W, 3);
        const cw = cupW(), ch = cupH();
        // the blob under its cup (drawn first, so a cup down covers it)
        const pc = cups[under];
        drawPet(c, g.pet, slotX(pc.slot) + pc.dx, ground() + ch * 0.12, ch * 1.3);
        cups.forEach((cp) => {
          const x = slotX(cp.slot) + cp.dx, y = ground() + cp.dy - cp.lift * ch * 0.95;
          c.save(); c.translate(x, y);
          c.beginPath(); c.moveTo(-cw * 0.5, 0); c.lineTo(-cw * 0.36, -ch); c.lineTo(cw * 0.36, -ch); c.lineTo(cw * 0.5, 0); c.closePath();
          c.fillStyle = "#F2A06B"; c.fill(); outline(c, 2.6);
          roundRect(c, -cw * 0.55, -6, cw * 1.1, 8, 4); c.fillStyle = "#E58A52"; c.fill(); outline(c, 2.2);
          c.beginPath(); c.moveTo(-cw * 0.3, -ch * 0.55); c.lineTo(cw * 0.3, -ch * 0.55); c.lineWidth = 3; c.strokeStyle = "#FFD2B0"; c.stroke();
          roundRect(c, -cw * 0.12, -ch - 8, cw * 0.24, 9, 4); c.fillStyle = "#E58A52"; c.fill(); outline(c, 2);
          c.restore();
        });
        text(c, "Found " + found, 10, 16, 15 * g.k);
        text(c, msg, g.W - 10, 16, 13 * g.k, { align: "right", color: mode === "pick" ? C.pinkDeep : C.ink });
      },
      score: () => found,
    };
  }

  // ---------- Bubble Bath: pop the bubbles before they float away; a pop bursts every bubble touching it ----------
  function bubbleBath(g) {
    let bubbles = [], spawnIn = 0.2, score = 0, timeLeft = 30, wob = 0;
    const tubTop = () => g.H - Math.max(40, g.H * 0.24);
    const spawn = (el) => {
      const n = 1 + Math.floor(g.rand() * 3), r0 = g.u * (8 + g.rand() * 7);
      let x = g.W * (0.18 + g.rand() * 0.64), y = tubTop() + 4;
      for (let i = 0; i < n; i++) {
        const r = r0 * (0.8 + g.rand() * 0.4);
        bubbles.push({ x, y, r, vy: -g.H * lerp(0.13, 0.3, el / 30) * (0.8 + g.rand() * 0.4), ph: g.rand() * 6, duck: g.rand() < 0.04 });
        const a = g.rand() * Math.PI * 2; x += Math.cos(a) * r * 1.7; y += Math.abs(Math.sin(a)) * r * 1.2;
      }
    };
    return {
      update(dt) {
        timeLeft -= dt; wob += dt;
        if (timeLeft <= 0) return g.end(score, "Squeaky clean!");
        spawnIn -= dt;
        if (spawnIn <= 0) { spawnIn = lerp(0.7, 0.32, (30 - timeLeft) / 30) * (0.7 + g.rand() * 0.6); spawn(30 - timeLeft); }
        for (const b of bubbles) { b.y += b.vy * dt; b.x += Math.sin(wob * 2 + b.ph) * g.u * 8 * dt; b.ph += dt * 0.3; }
        bubbles = bubbles.filter((b) => b.y + b.r > -4);
      },
      tap(x, y) {
        let best = -1, bd = Infinity;
        bubbles.forEach((b, i) => { const d = Math.hypot(b.x - x, b.y - y); if (d <= b.r * 1.15 && d < bd) { bd = d; best = i; } });
        if (best < 0) return;
        const chain = WL.bubbleChain(bubbles, best);
        let pts = 0;
        for (const i of chain) { const b = bubbles[i]; pts += b.duck ? 5 : 1; g.burst(b.x, b.y, b.duck ? C.gold : C.water, b.duck ? 10 : 5, true); }
        score += pts;
        g.popup(x, y - 10, chain.length >= 3 ? `Chain x${chain.length}! +${pts}` : "+" + pts, chain.length >= 3 ? C.pinkDeep : "#2F7FB5", chain.length >= 3 ? 1.3 : 1);
        const set = new Set(chain);
        bubbles = bubbles.filter((_, i) => !set.has(i));
      },
      draw(c) {
        c.fillStyle = "#E4F4FB"; c.fillRect(0, 0, g.W, g.H);
        const tile = Math.max(18, g.u * 22);
        c.strokeStyle = "#CDE8F4"; c.lineWidth = 1.5;
        for (let x = tile; x < g.W; x += tile) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, g.H); c.stroke(); }
        for (let y = tile; y < g.H; y += tile) { c.beginPath(); c.moveTo(0, y); c.lineTo(g.W, y); c.stroke(); }
        const tt = tubTop(), petS = Math.min(g.W * 0.46, g.H * 0.5);
        // foam on the rim behind the blob, the blob sitting in the water, then the front of the tub
        for (let i = 0; i < 9; i++) circle(c, g.W * (0.12 + i * 0.095), tt + 2 + Math.sin(wob * 2 + i) * 1.5, g.u * 7 + (i % 3) * 2, C.white, 1.8);
        drawPet(c, g.pet, g.W / 2, tt + petS * 0.3, petS, 1 + Math.sin(wob * 3) * 0.02, 1 - Math.sin(wob * 3) * 0.02);
        roundRect(c, g.W * 0.08, tt + 6, g.W * 0.84, g.H - tt - 10, 14); c.fillStyle = C.white; c.fill(); outline(c, 2.6);
        c.fillStyle = "#BFE6F5"; c.fillRect(g.W * 0.08 + 6, tt + 10, g.W * 0.84 - 12, 5);
        for (const fx of [0.16, 0.28, 0.72, 0.84]) circle(c, g.W * fx, tt + 6, g.u * 6, C.white, 1.6);
        for (const b of bubbles) {
          c.save(); c.globalAlpha = 0.92;
          circle(c, b.x, b.y, b.r, b.duck ? "rgba(255,228,110,0.6)" : "rgba(214,238,250,0.55)");
          c.lineWidth = 2.4; c.strokeStyle = b.duck ? "#C98A00" : "#3A8FC4"; c.stroke();
          c.beginPath(); c.arc(b.x, b.y, b.r * 0.8, Math.PI * 0.15, Math.PI * 0.55); c.lineWidth = 2; c.strokeStyle = "rgba(247,168,196,0.9)"; c.stroke();
          c.beginPath(); c.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, Math.PI * 1.1, Math.PI * 1.7); c.lineWidth = 2.4; c.strokeStyle = C.white; c.stroke();
          if (b.duck) { c.translate(b.x, b.y); c.fillStyle = C.gold; c.beginPath(); c.ellipse(0, b.r * 0.15, b.r * 0.5, b.r * 0.35, 0, 0, Math.PI * 2); c.fill(); circle(c, b.r * 0.2, -b.r * 0.2, b.r * 0.28, C.gold); circle(c, b.r * 0.28, -b.r * 0.26, b.r * 0.05, C.ink); }
          c.restore();
        }
        text(c, String(score), 10, 16, 18 * g.k, { stroke: C.white });
        timeBar(c, g.W * 0.3, 9, g.W * 0.4, 12, timeLeft / 30);
      },
      score: () => score,
    };
  }

  // ---------- Star Hop: hop from cloud to cloud and grab the stars (double jump); endless, faster and faster ----------
  function starHop(g) {
    let clouds = [], stars = [], score = 0, speed = 0, dist = 0, land = 0, hill = 0;
    const p = { x: 0, y: 0, vy: 0, jumps: 0, ground: true };
    const size = () => Math.max(34, Math.min(g.W, g.H) * 0.2);
    const addCloud = (x, y, w) => {
      clouds.push({ x, y, w });
      if (g.rand() < 0.75) { const n = 1 + Math.floor(g.rand() * 3); for (let i = 0; i < n; i++) stars.push({ x: x + w * ((i + 1) / (n + 1)), y: y - size() * (0.9 + (i % 2) * 0.5), got: false, ph: g.rand() * 6 }); }
    };
    const next = () => {
      const last = clouds[clouds.length - 1];
      // a gap a single hop always clears at the current speed (a hop flies ~0.9 s), never more than a little up
      const reach = speed * 0.8;
      const gap = Math.min(reach, size() * 0.5 + g.rand() * reach * 0.8);
      const y = clamp(last.y + (g.rand() - 0.6) * g.H * 0.22, g.H * 0.45, g.H * 0.85);
      addCloud(last.x + last.w + gap, y, size() * (1.6 + g.rand() * 1.6));
    };
    const jump = () => { if (p.jumps < 2) { p.vy = -g.H * (p.jumps ? 0.95 : 1.2); p.jumps += 1; p.ground = false; g.burst(p.x, p.y, C.white, 4); } };
    return {
      begin() {
        clouds = []; stars = [];
        addCloud(-10, g.H * 0.72, g.W * 0.6); stars = [];
        while (clouds[clouds.length - 1].x < g.W * 2) next();
        p.x = g.W * 0.25; p.y = g.H * 0.72; p.vy = 0; p.jumps = 0; speed = g.W * 0.3;
      },
      update(dt) {
        speed = Math.min(g.W * 0.75, speed + g.W * 0.012 * dt); dist += speed * dt; hill += dt;
        for (const cl of clouds) cl.x -= speed * dt;
        for (const s of stars) { s.x -= speed * dt; s.ph += dt * 4; }
        clouds = clouds.filter((cl) => cl.x + cl.w > -20); stars = stars.filter((s) => s.x > -20 && !s.got);
        while (clouds[clouds.length - 1].x < g.W * 1.6) next();
        const prev = p.y;
        p.vy += g.H * 2.7 * dt; p.y += p.vy * dt;
        land = Math.max(0, land - dt * 5);
        if (p.vy >= 0) for (const cl of clouds) {
          if (p.x >= cl.x + 4 && p.x <= cl.x + cl.w - 4 && prev <= cl.y + 2 && p.y >= cl.y) { if (!p.ground) land = 1; p.y = cl.y; p.vy = 0; p.jumps = 0; p.ground = true; break; }
        }
        if (p.vy > 0 && p.ground && !clouds.some((cl) => p.x >= cl.x + 4 && p.x <= cl.x + cl.w - 4 && Math.abs(p.y - cl.y) < 2)) p.ground = false;
        const r = size() * 0.45;
        for (const s of stars) if (!s.got && Math.hypot(s.x - p.x, s.y - (p.y - r)) < r + size() * 0.2) {
          s.got = true; score += 1; g.burst(s.x, s.y, C.gold, 8); g.popup(s.x, s.y - 12, "+1", "#C98A00");
          if (score % 10 === 0) g.popup(g.W / 2, g.H * 0.35, score + " stars!", C.pinkDeep, 1.5);
        }
        if (p.y - size() > g.H) g.end(score, "Whoops, fell off the clouds!");
      },
      tap() { jump(); },
      key(k) { if (k === " " || k === "ArrowUp" || k === "w") jump(); },
      draw(c) {
        const gr = c.createLinearGradient(0, 0, 0, g.H); gr.addColorStop(0, "#A9DCF3"); gr.addColorStop(1, "#FCE1EC");
        c.fillStyle = gr; c.fillRect(0, 0, g.W, g.H);
        // far hills drift slowly
        c.fillStyle = "#D7EFC4";
        const off = -(dist * 0.15) % (g.W * 0.8);
        for (let x = off - g.W * 0.4; x < g.W + g.W * 0.8; x += g.W * 0.8) { c.beginPath(); c.ellipse(x, g.H * 1.02, g.W * 0.5, g.H * 0.22, 0, Math.PI, 0); c.fill(); }
        for (const cl of clouds) {
          c.save(); c.translate(cl.x, cl.y);
          c.beginPath();
          const n = Math.max(2, Math.round(cl.w / (size() * 0.5)));
          c.moveTo(0, 0);
          for (let i = 0; i < n; i++) { const x0 = (cl.w / n) * i, x1 = (cl.w / n) * (i + 1); c.quadraticCurveTo((x0 + x1) / 2, -size() * 0.42, x1, 0); }
          c.quadraticCurveTo(cl.w + 6, size() * 0.18, cl.w - 6, size() * 0.28); c.lineTo(6, size() * 0.28); c.quadraticCurveTo(-6, size() * 0.18, 0, 0);
          c.fillStyle = C.white; c.fill(); outline(c, 2.4);
          c.restore();
        }
        for (const s of stars) { c.save(); c.translate(s.x, s.y + Math.sin(s.ph) * 2); c.rotate(Math.sin(s.ph) * 0.2); const k = size() / 48; c.scale(k, k); c.fillStyle = C.gold; c.fill(STAR); c.lineWidth = 1.8 / k * 0.6; c.strokeStyle = C.brown; c.stroke(STAR); c.restore(); }
        const sq = p.ground ? 1 + land * 0.18 : 0.9, st = p.ground ? 1 - land * 0.16 : 1.1;
        drawPet(c, g.pet, p.x, p.y + 3, size(), sq, st);
        c.save(); c.translate(10, 16); c.scale(0.9 * g.k, 0.9 * g.k); c.fillStyle = C.gold; c.fill(STAR); c.lineWidth = 1.6; c.strokeStyle = C.brown; c.stroke(STAR); c.restore();
        text(c, String(score), 24, 16, 18 * g.k, { stroke: C.white });
        if (dist < g.W * 1.2) {
          c.font = FONT(11 * g.k, 700);
          const hint = ["Click or Space to hop, twice for a double jump", "Click to hop, twice to double jump", "Click to hop"].find((t) => c.measureText(t).width <= g.W - 16) || "Hop!";
          text(c, hint, g.W / 2, g.H - 12, 11 * g.k, { align: "center", color: C.soft, weight: 700, stroke: C.white });
        }
      },
      score: () => score,
      peek: () => ({ x: p.x, y: p.y, ground: p.ground, clouds: clouds.map((cl) => [cl.x, cl.y, cl.w]) }),
    };
  }

  const GAMES = { catch: berryCatch, memory: flameMemory, seek: hideAndSeek, bubbles: bubbleBath, hop: starHop };

  /**
   * Start a game in `box` (emptied first). done(score) is called once, after the end card. opts: { petSvg }.
   * Returns stop() for when the sheet closes (no score then).
   */
  function start(box, id, done, opts) {
    const make = GAMES[id], meta = WL.GAMES[id];
    if (!make || !meta) return () => {};
    box.innerHTML = `<canvas class="gm-cv" role="img" aria-label="${meta.label}. ${meta.how}"></canvas>`;
    const cv = box.querySelector("canvas"), c = cv.getContext("2d");
    let raf = 0, last = 0, stopped = false, called = false, startedAt = 0;
    const fx = [], pops = [];
    let shakeT = 0, shakeA = 0;
    const g = {
      W: 0, H: 0, u: 1, k: 1, rand: WL.rng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0),
      pointer: { x: 0, y: 0, active: false }, keys: {}, pet: petImage(opts && opts.petSvg),
      phase: "intro", final: 0, finalMsg: "",
      burst(x, y, color, n, ring) {
        if (motionOff()) return;
        for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n + g.rand() * 0.5, v = 60 + g.rand() * 90; fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6, color, r: ring ? 3 : 2.5 + g.rand() * 2 }); }
      },
      popup(x, y, s, color, size) { pops.push({ x, y, s, color, size: size || 1, life: 1 }); },
      shake(a) { if (!motionOff()) { shakeT = 0.3; shakeA = a; } },
      end(score, msg) { if (g.phase !== "play") return; g.phase = "over"; g.final = Math.max(0, Math.floor(score)); g.finalMsg = msg || ""; g.overAt = performance.now(); setTimeout(finish, 1400); },
    };
    const game = make(g);
    box._game = game; // read-only peek for tests
    function finish() { if (called || stopped) return; called = true; stop(); done(g.final); }

    function resize() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
      if (!r.width || !r.height) return;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      g.W = r.width; g.H = r.height; g.dpr = dpr; g.u = Math.min(g.W, g.H) / 200; g.k = clamp(Math.min(g.W, g.H) / 220, 0.8, 1.4);
      if (g.phase === "intro" || !game.resized) draw();
    }
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(cv);
    resize();

    function begin() {
      if (g.phase !== "intro") return;
      g.phase = "play"; startedAt = performance.now();
      if (game.begin) game.begin();
    }
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const [x, y] = local(e);
      g.pointer.x = x; g.pointer.y = y; g.pointer.active = true;
      if (g.phase === "intro") { begin(); return; }
      if (g.phase === "play" && game.tap) game.tap(x, y);
    }
    function onMove(e) { const [x, y] = local(e); g.pointer.x = x; g.pointer.y = y; g.pointer.active = true; }
    function onKey(e) {
      if (!box.isConnected) return;
      const k = e.key;
      if (e.type === "keyup") { g.keys[k] = false; return; }
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
      if (g.phase === "intro" && (k === " " || k === "Enter")) { begin(); return; }
      g.keys[k] = true;
      if (g.phase === "play" && game.key && !e.repeat) game.key(k);
    }
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    function draw() {
      if (!g.W) return;
      c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      c.clearRect(0, 0, g.W, g.H);
      c.save();
      if (shakeT > 0) c.translate((Math.random() - 0.5) * shakeA * (shakeT / 0.3), (Math.random() - 0.5) * shakeA * (shakeT / 0.3));
      game.draw(c);
      for (const p of fx) { c.globalAlpha = clamp(p.life / 0.6, 0, 1); circle(c, p.x, p.y, p.r, p.color); }
      c.globalAlpha = 1;
      for (const p of pops) { c.globalAlpha = clamp(p.life * 1.5, 0, 1); text(c, p.s, p.x, p.y - (1 - p.life) * 22, 15 * g.k * p.size, { align: "center", color: p.color, stroke: C.white }); }
      c.globalAlpha = 1;
      c.restore();
      if (g.phase === "intro") card(meta.label, meta.how, "Click to start");
      else if (g.phase === "over") card(g.finalMsg || "Done!", "", `${g.final} ${meta.unit}`);
    }
    function card(title, how, cta) {
      c.fillStyle = "rgba(255,251,234,0.86)"; c.fillRect(0, 0, g.W, g.H);
      const w = Math.min(g.W - 24, 300), lines = how ? wrap(c, how, w - 24, 12.5 * g.k) : [];
      const h = 30 * g.k + lines.length * 16 * g.k + 44 * g.k, x = (g.W - w) / 2, y = (g.H - h) / 2;
      roundRect(c, x, y, w, h, 16); c.fillStyle = C.card; c.fill(); outline(c, 2.4);
      text(c, title, g.W / 2, y + 18 * g.k, 17 * g.k, { align: "center" });
      lines.forEach((l, i) => text(c, l, g.W / 2, y + 40 * g.k + i * 16 * g.k, 12.5 * g.k, { align: "center", color: C.soft, weight: 700 }));
      const pulse = g.phase === "intro" && !motionOff() ? 1 + Math.sin(performance.now() / 260) * 0.04 : 1;
      const bw = Math.min(w - 40, 150 * g.k), bh = 26 * g.k, by = y + h - bh - 9 * g.k;
      c.save(); c.translate(g.W / 2, by + bh / 2); c.scale(pulse, pulse);
      roundRect(c, -bw / 2, -bh / 2, bw, bh, bh / 2); c.fillStyle = g.phase === "over" ? C.butter : C.pink; c.fill(); outline(c, 2.2);
      text(c, cta, 0, 1, 14 * g.k, { align: "center" });
      c.restore();
    }

    function frame(now) {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (!box.isConnected) { stop(); return; }
      if (document.hidden) { last = 0; return; }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (g.phase === "play" && dt > 0) game.update(dt);
      shakeT = Math.max(0, shakeT - dt);
      for (const p of fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt; }
      for (let i = fx.length - 1; i >= 0; i--) if (fx[i].life <= 0) fx.splice(i, 1);
      for (const p of pops) p.life -= dt * 1.1;
      for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life <= 0) pops.splice(i, 1);
      draw();
    }
    raf = requestAnimationFrame(frame);

    function stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    }
    return stop;
  }

  window.HearthGames = { start };
})();
