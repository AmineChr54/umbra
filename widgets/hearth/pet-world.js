// Hearth pet world: the blob's room as plain SVG (the same rules as mascot.js: literal colours, no scripts, no styles, no
// ids, no external references), plus a small DOM helper that keeps it alive (walking, looking at the pointer, tricks).
// pet-world.css moves it; everything there follows --motion-scale and html[data-motion="off"].
//
//   HearthWorld.renderRoom({ mood, outfit, level, title, room, phase, season, holiday, gift, asleep, now })  -> "<svg ...>"
//   const m = HearthWorld.mount(el, state); m.update(state); m.react("feed"); m.act("spin", 2400); m.look(dx, dy); m.walk(x)
//
// The room is 240 x 240 like the old scene (mascot.js renderScene), with the wall and floor running far past the sides
// so any widget shape is filled. Left: the window. Middle: the hearth, the rug and the blob. Right: a picture and a corner.
(function (root) {
  "use strict";

  const M = root.HearthMascot || (typeof require === "function" ? require("./mascot.js") : null);
  const P = M.PALETTE;
  const OUT = `stroke="${P.brown}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;
  const OUT2 = `stroke="${P.brown}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

  const WALLPAPER = {
    "": { base: P.wall, stripe: null },
    wall_mint: { base: "#E2F4E6", stripe: "#CFEBD6" },
    wall_sky: { base: "#E1F0FA", stripe: "#CBE5F5" },
    wall_rose: { base: "#FBE5EC", stripe: "#F6D0DD" },
    wall_night: { base: "#3A4170", stripe: null, stars: true },
  };
  const RUG = {
    "": { fill: P.pink, ring: P.butter },
    rug_sky: { fill: "#9ED3EE", ring: P.white },
    rug_sage: { fill: P.greenDeep, ring: P.butter },
    rug_gold: { fill: "#F2C14E", ring: P.pinkDeep },
  };
  const SKY = {
    night: { top: "#26325E", low: "#3B4A80" },
    dawn: { top: "#F6B9A0", low: "#FFE4BE" },
    day: { top: "#A9DCF3", low: "#D7F0FB" },
    dusk: { top: "#E98A86", low: "#FBC99A" },
  };

  // ---------- small art ----------

  const heart = (x, y, s, fill) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 8 C-14 -2 -9 -13 0 -6 C9 -13 14 -2 0 8 Z" fill="${fill}" ${OUT2}/></g>`;
  const starPath = "M0 -7 Q1.2 -1.2 7 0 Q1.2 1.2 0 7 Q-1.2 1.2 -7 0 Q-1.2 -1.2 0 -7 Z";

  function windowArt(o) {
    const sky = SKY[o.phase] || SKY.day;
    let inside = `<rect x="0" y="0" width="50" height="60" fill="${sky.low}"/><rect x="0" y="0" width="50" height="30" fill="${sky.top}"/>`;
    if (o.phase === "night") {
      inside += `<circle cx="36" cy="14" r="7" fill="${P.butter}"/><circle cx="39" cy="12" r="6" fill="${sky.top}"/>` +
        [[8, 10], [20, 6], [14, 22], [28, 26], [44, 30], [6, 34]].map(([x, y], i) => `<circle class="pw-twinkle pw-d${i % 3}" cx="${x}" cy="${y}" r="1.2" fill="${P.white}"/>`).join("");
    } else if (o.phase === "day") {
      inside += `<circle class="pw-sun" cx="38" cy="14" r="7" fill="${P.butter}" stroke="#F2C14E" stroke-width="2"/>` +
        `<g class="pw-cloud"><ellipse cx="14" cy="22" rx="9" ry="4.5" fill="${P.white}"/><ellipse cx="19" cy="19" rx="6" ry="4.5" fill="${P.white}"/></g>`;
    } else {
      inside += `<circle cx="${o.phase === "dawn" ? 12 : 38}" cy="40" r="8" fill="${o.phase === "dawn" ? "#FFD27A" : "#FF9E6E"}"/>`;
    }
    // hills
    inside += `<path d="M0 50 Q14 40 28 48 T50 44 V60 H0 Z" fill="${o.phase === "night" ? "#2F4A3A" : P.greenDeep}"/>`;
    if (o.season === "winter") inside += `<path d="M0 52 Q14 44 28 50 T50 47 V60 H0 Z" fill="${P.white}" opacity="0.9"/>` +
      [6, 16, 26, 36, 44, 11, 31].map((x, i) => `<circle class="pw-snow pw-d${i % 4}" cx="${x}" cy="${-4 - (i % 3) * 6}" r="1.4" fill="${P.white}"/>`).join("");
    if (o.season === "spring") inside += [8, 22, 38, 30].map((x, i) => `<ellipse class="pw-fall pw-d${i % 4}" cx="${x}" cy="-4" rx="1.8" ry="1.1" fill="${P.pink}"/>`).join("");
    if (o.season === "autumn") inside += [10, 26, 40].map((x, i) => `<path class="pw-fall pw-d${i % 4}" d="M${x} -6 q3 -3 6 0 q-3 3 -6 0 Z" fill="${i % 2 ? "#E8834A" : "#F2C14E"}"/>`).join("");
    if (o.season === "summer" && o.phase === "night") inside += [12, 30, 42].map((x, i) => `<circle class="pw-firefly pw-d${i % 3}" cx="${x}" cy="${44 - i * 4}" r="1.4" fill="#F6F59A"/>`).join("");
    if (o.season === "summer" && o.phase === "day") inside += `<path class="pw-bird" d="M18 30 q3 -3 6 0 q3 -3 6 0" fill="none" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round"/>`;
    const curtains = o.room.window
      ? (() => {
        const c = o.room.window === "curtains_sage" ? P.greenDeep : P.pink;
        return `<path d="M8 20 H24 Q20 50 26 92 H8 Z" fill="${c}" ${OUT2}/><path d="M70 20 H54 Q58 50 52 92 H70 Z" fill="${c}" ${OUT2}/>` +
          `<path d="M6 18 H72" stroke="${P.brown}" stroke-width="3" stroke-linecap="round"/>`;
      })() : "";
    return `<g class="pw-window"><rect x="12" y="24" width="54" height="64" rx="4" fill="${P.butter}" ${OUT}/>` +
      `<svg x="14" y="26" width="50" height="60" viewBox="0 0 50 60">${inside}</svg>` +
      `<path d="M39 26 V86 M14 54 H64" stroke="${P.butter}" stroke-width="3"/><path d="M39 26 V86 M14 54 H64" stroke="${P.brown}" stroke-width="0.8" opacity="0.4"/>` +
      `<rect x="8" y="86" width="62" height="7" rx="3" fill="${P.butter}" ${OUT2}/>${curtains}</g>`;
  }

  function wallItem(id, now) {
    const x = 176, y = 30;
    if (id === "painting") return `<g class="pw-wallitem"><rect x="${x}" y="${y}" width="50" height="40" rx="3" fill="#C99A6B" ${OUT}/>` +
      `<rect x="${x + 5}" y="${y + 5}" width="40" height="30" fill="#BFE6F5"/><path d="M${x + 5} ${y + 28} Q${x + 18} ${y + 16} ${x + 28} ${y + 26} T${x + 45} ${y + 22} V${y + 35} H${x + 5} Z" fill="${P.greenDeep}"/>` +
      `<circle cx="${x + 36}" cy="${y + 12}" r="4" fill="${P.butter}"/></g>`;
    if (id === "clock") {
      const d = new Date(now || Date.now());
      const ha = ((d.getHours() % 12) + d.getMinutes() / 60) * 30, ma = d.getMinutes() * 6;
      const cx = x + 25, cy = y + 22;
      return `<g class="pw-wallitem"><circle cx="${cx}" cy="${cy}" r="19" fill="${P.white}" ${OUT}/>` +
        [0, 90, 180, 270].map((a) => `<path d="M${cx} ${cy - 15} v3" stroke="${P.ink}" stroke-width="1.6" transform="rotate(${a} ${cx} ${cy})"/>`).join("") +
        `<path class="pw-hand-h" d="M${cx} ${cy} V${cy - 9}" stroke="${P.ink}" stroke-width="2.6" stroke-linecap="round" transform="rotate(${ha.toFixed(1)} ${cx} ${cy})"/>` +
        `<path class="pw-hand-m" d="M${cx} ${cy} V${cy - 14}" stroke="${P.pinkDeep}" stroke-width="1.8" stroke-linecap="round" transform="rotate(${ma} ${cx} ${cy})"/>` +
        `<circle cx="${cx}" cy="${cy}" r="2" fill="${P.ink}"/></g>`;
    }
    if (id === "photo") return `<g class="pw-wallitem" transform="rotate(-4 ${x + 25} ${y + 20})"><rect x="${x + 4}" y="${y}" width="42" height="40" rx="2" fill="${P.white}" ${OUT}/>` +
      `<rect x="${x + 9}" y="${y + 5}" width="32" height="24" fill="#FBE5EC"/>` +
      `<circle cx="${x + 19}" cy="${y + 21}" r="6" fill="${P.green}" ${OUT2}/><circle cx="${x + 31}" cy="${y + 21}" r="6" fill="#BFE6F5" ${OUT2}/>` +
      heart(x + 25, y + 11, 0.4, P.pinkDeep) + `</g>`;
    return "";
  }

  function mantelItem(id, holiday) {
    let s = "";
    if (id === "lights") {
      const cols = [P.pinkDeep, P.butter, "#9ED3EE", P.greenDeep];
      s += `<path d="M78 24 Q99 34 120 24 T162 24" fill="none" stroke="${P.brown}" stroke-width="1.4"/>` +
        [84, 94, 104, 114, 126, 136, 146, 156].map((x, i) => `<circle class="pw-bulb pw-d${i % 3}" cx="${x}" cy="${24 + (i % 4 === 1 || i % 4 === 2 ? 6 : 3)}" r="2.6" fill="${cols[i % 4]}" ${OUT2.replace("1.8", "1")}/>`).join("");
    }
    if (id === "candles") s += [86, 96, 146].map((x, i) => `<rect x="${x}" y="${i === 1 ? 0 : -4}" width="6" height="${i === 1 ? 10 : 14}" rx="1.5" fill="${P.white}" ${OUT2}/>` +
      `<path class="pw-flame" d="M${x + 3} ${i === 1 ? -6 : -10} q3 4 0 6 q-3 -2 0 -6 Z" fill="#F2C14E"/>`).join("");
    if (holiday === "winterfest") s += `<path d="M76 20 Q120 34 164 20" fill="none" stroke="#5E9E5A" stroke-width="5" stroke-linecap="round"/>` +
      [90, 108, 126, 146].map((x, i) => `<circle cx="${x}" cy="${25 + (i % 2) * 3}" r="2.6" fill="${i % 2 ? P.butter : "#D9434F"}"/>`).join("") +
      `<path d="M150 26 h10 v14 q0 6 -8 6 h-6 v-6 h4 Z" fill="#D9434F" ${OUT2}/><path d="M150 26 h10 v4 h-10 Z" fill="${P.white}"/>`;
    if (holiday === "valentine") s += `<path d="M78 22 Q120 34 162 22" fill="none" stroke="${P.pinkDeep}" stroke-width="1.2"/>` + [90, 110, 130, 150].map((x, i) => heart(x, 28 + (i % 2) * 3, 0.45, i % 2 ? P.pink : P.pinkDeep)).join("");
    return s;
  }

  function floorL(id) {
    if (id === "plant") return `<g class="pw-plant"><path d="M22 168 h28 l-4 24 h-20 Z" fill="#E59866" ${OUT}/>` +
      `<g class="pw-sway"><path d="M36 168 C30 150 18 146 16 132 C28 136 34 146 36 168 Z" fill="${P.greenDeep}" ${OUT2}/>` +
      `<path d="M36 168 C40 148 52 140 56 126 C46 132 38 144 36 168 Z" fill="${P.greenDeep}" ${OUT2}/>` +
      `<path d="M36 168 C34 150 36 136 36 120 C40 138 40 152 36 168 Z" fill="${P.green}" ${OUT2}/></g></g>`;
    if (id === "cactus") return `<g><path d="M24 172 h24 l-3 20 h-18 Z" fill="#E59866" ${OUT}/>` +
      `<rect x="30" y="134" width="12" height="40" rx="6" fill="#8CC07A" ${OUT2}/><path d="M30 152 h-6 v-10 a3 3 0 0 1 6 0 Z" fill="#8CC07A" ${OUT2}/>` +
      `<path d="M42 146 h6 v-8 a3 3 0 0 0 -6 0 Z" fill="#8CC07A" ${OUT2}/><circle cx="36" cy="132" r="3" fill="${P.pink}" ${OUT2}/></g>`;
    return "";
  }
  function floorR(id, lit) {
    if (id === "lamp") return `<g>${lit ? `<circle class="pw-lampglow" cx="206" cy="118" r="34" fill="${P.butter}" opacity="0.35"/>` : ""}` +
      `<path d="M206 126 V186" stroke="${P.brown}" stroke-width="3"/><ellipse cx="206" cy="188" rx="12" ry="3.5" fill="${P.ink}"/>` +
      `<path d="M192 126 L198 106 H214 L220 126 Z" fill="${lit ? P.butter : "#F6E7B0"}" ${OUT}/></g>`;
    if (id === "bookshelf") {
      const books = (y, cols) => cols.map((c, i) => `<rect x="${188 + i * 7}" y="${y - (i % 2 ? 13 : 15)}" width="6" height="${i % 2 ? 13 : 15}" fill="${c}" ${OUT2.replace("1.8", "1")}/>`).join("");
      return `<g><rect x="184" y="128" width="44" height="62" rx="2" fill="#C99A6B" ${OUT}/>` +
        `<path d="M184 148 H228 M184 168 H228" stroke="${P.brown}" stroke-width="2"/>` +
        books(147, [P.pinkDeep, "#9ED3EE", P.butter, P.greenDeep, P.pink]) + books(167, [P.butter, P.pink, "#9ED3EE", P.pinkDeep]) +
        books(188, ["#9ED3EE", P.greenDeep, P.pink, P.butter, P.pinkDeep]) + `</g>`;
    }
    return "";
  }
  function toyArt(id) {
    const x = 58, y = 196;
    if (id === "ball") return `<g class="pw-toy"><circle cx="${x}" cy="${y - 8}" r="9" fill="${P.white}" ${OUT}/>` +
      `<path d="M${x - 9} ${y - 8} H${x + 9}" stroke="${P.pinkDeep}" stroke-width="3"/><path d="M${x} ${y - 17} Q${x + 5} ${y - 8} ${x} ${y + 1}" fill="none" stroke="#9ED3EE" stroke-width="3"/></g>`;
    if (id === "yarn") return `<g class="pw-toy"><circle cx="${x}" cy="${y - 8}" r="9" fill="${P.pink}" ${OUT}/>` +
      `<path d="M${x - 6} ${y - 14} Q${x} ${y - 6} ${x + 7} ${y - 12} M${x - 8} ${y - 6} Q${x} ${y} ${x + 8} ${y - 4}" fill="none" stroke="${P.brown}" stroke-width="1.2"/>` +
      `<path d="M${x + 8} ${y - 4} q10 6 16 2" fill="none" stroke="${P.pinkDeep}" stroke-width="1.6"/></g>`;
    if (id === "duck") return `<g class="pw-toy"><path d="M${x - 10} ${y - 8} q0 8 10 8 h4 q8 0 8 -8 q0 -4 -4 -5 q-2 -8 -9 -8 q-7 0 -7 7 q-6 0 -2 6 Z" fill="${P.butter}" ${OUT2}/>` +
      `<path d="M${x + 1} ${y - 16} l6 2 l-6 2 Z" fill="#F2A04B"/><circle cx="${x - 2}" cy="${y - 17}" r="1.2" fill="${P.ink}"/></g>`;
    if (id === "kite") return `<g class="pw-toy"><path d="M${x - 4} ${y - 34} L${x + 8} ${y - 20} L${x - 2} ${y - 2} L${x - 14} ${y - 18} Z" fill="#9ED3EE" ${OUT2}/>` +
      `<path d="M${x - 4} ${y - 34} L${x - 2} ${y - 2} M${x - 14} ${y - 18} L${x + 8} ${y - 20}" stroke="${P.brown}" stroke-width="1"/>` +
      `<path d="M${x - 2} ${y - 2} q6 4 2 8 q-4 4 4 6" fill="none" stroke="${P.pinkDeep}" stroke-width="1.4"/></g>`;
    return "";
  }
  function giftArt(kind) {
    if (!kind) return "";
    const x = 186, y = 196;
    return `<g class="pw-gift pw-gift-${kind}"><rect x="${x - 13}" y="${y - 24}" width="26" height="20" rx="2" fill="${kind === "theirs" ? P.pink : "#9ED3EE"}" ${OUT}/>` +
      `<rect x="${x - 15}" y="${y - 29}" width="30" height="7" rx="2" fill="${kind === "theirs" ? P.pinkDeep : "#6EBBE0"}" ${OUT2}/>` +
      `<path d="M${x} ${y - 29} V${y - 4}" stroke="${P.butter}" stroke-width="4"/>` +
      `<path d="M${x} ${y - 29} q-9 -10 -12 -3 q3 5 12 3 q9 -10 12 -3 q-3 5 -12 3" fill="${P.butter}" ${OUT2}/></g>`;
  }
  function holidayFloor(h) {
    if (h === "halloween") return `<g class="pw-pumpkin" transform="translate(-40 24)"><ellipse cx="216" cy="190" rx="13" ry="10" fill="#F2913D" ${OUT}/>` +
      `<path d="M216 180 q2 -6 6 -6" stroke="#5E9E5A" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      `<path d="M210 187 l3 -3 l3 3 Z M218 187 l3 -3 l3 3 Z M209 193 q7 5 14 0" fill="${P.ink}" stroke="${P.ink}" stroke-width="1"/></g>`;
    if (h === "birthday") return `<g class="pw-cake" transform="translate(-38 30)"><rect x="196" y="176" width="30" height="16" rx="3" fill="${P.white}" ${OUT}/>` +
      `<path d="M196 182 q5 4 10 0 q5 4 10 0 q5 4 10 0" fill="none" stroke="${P.pink}" stroke-width="3"/>` +
      `<rect x="209" y="164" width="4" height="12" fill="#9ED3EE" ${OUT2}/><path class="pw-flame" d="M211 158 q3 4 0 6 q-3 -2 0 -6 Z" fill="#F2C14E"/></g>`;
    return "";
  }
  function holidaySky(h) {
    if (h === "birthday" || h === "anniversary" || h === "newyear") {
      const cols = h === "anniversary" ? [P.pinkDeep, P.pink, P.pinkDeep] : [P.pink, "#9ED3EE", P.butter];
      return `<g class="pw-balloons">` + [[172, 104], [184, 96], [196, 106]].map(([x, y], i) =>
        `<path d="M${x} ${y + 14} q-3 18 4 34" fill="none" stroke="${P.brown}" stroke-width="1"/>` +
        `<g class="pw-bob pw-d${i}"><ellipse cx="${x}" cy="${y}" rx="8" ry="10" fill="${cols[i]}" ${OUT2}/></g>`).join("") + `</g>` +
        (h === "newyear" || h === "birthday" ? `<g class="pw-confetti">` + [[40, 60], [70, 40], [150, 30], [200, 70], [110, 54], [30, 110]].map(([x, y], i) =>
          `<rect class="pw-fall2 pw-d${i % 4}" x="${x}" y="${y}" width="5" height="3" rx="1" fill="${[P.pinkDeep, P.butter, "#9ED3EE", P.greenDeep][i % 4]}"/>`).join("") + `</g>` : "");
    }
    return "";
  }

  /** Extras that tricks and idle acts show (hidden until pet-world.css plays them). */
  const EXTRAS = () =>
    `<g class="pw-x pw-x-juggle">${[0, 1, 2].map((i) => `<circle class="pw-jb pw-d${i}" cx="120" cy="118" r="5" fill="${[P.pinkDeep, P.butter, "#9ED3EE"][i]}" ${OUT2}/>`).join("")}</g>` +
    `<g class="pw-x pw-x-fireworks">${[[80, 70], [160, 60], [120, 40]].map(([x, y], i) => `<g class="pw-burst pw-d${i}" transform="translate(${x} ${y})">` +
      [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -4 V-13" stroke="${[P.pinkDeep, P.butter, "#9ED3EE"][i]}" stroke-width="2.4" stroke-linecap="round" transform="rotate(${a})"/>`).join("") + `</g>`).join("")}</g>` +
    `<g class="pw-x pw-x-butterfly"><g class="pw-fly"><path d="M0 0 q-7 -8 -9 -2 q2 5 9 2 q7 -8 9 -2 q-2 5 -9 2" fill="${P.pink}" ${OUT2.replace("1.8", "1")}/></g></g>` +
    `<g class="pw-x pw-x-read"><path d="M138 176 l10 -3 v12 l-10 3 Z M138 176 l-10 -3 v12 l10 3 Z" fill="${P.white}" ${OUT2}/></g>` +
    `<g class="pw-x pw-x-note">${[0, 1].map((i) => `<path class="pw-notefloat pw-d${i}" d="M${150 + i * 10} 120 v-10 l6 -2 v10" fill="none" stroke="${P.ink}" stroke-width="1.6"/><circle cx="${148 + i * 10}" cy="120" r="2.2" fill="${P.ink}"/>`).join("")}</g>`;

  // ---------- the room ----------

  function norm(o) {
    const s = o && typeof o === "object" ? o : {};
    const room = s.room && typeof s.room === "object" ? s.room : {};
    return {
      mood: s.mood, outfit: s.outfit, level: s.level, title: typeof s.title === "string" ? s.title : "",
      room, phase: SKY[s.phase] ? s.phase : "day", season: ["winter", "spring", "summer", "autumn"].includes(s.season) ? s.season : "summer",
      holiday: typeof s.holiday === "string" ? s.holiday : "", gift: s.gift === "mine" || s.gift === "theirs" ? s.gift : "",
      asleep: !!s.asleep, now: Number(s.now) || 0,
      pet: s.pet !== false, still: !!s.still,             // shop pictures: an empty room that does not move
    };
  }
  /** The key that decides a full redraw (the clock's hands, the walk and the looking are updated in place). */
  const keyOf = (o) => JSON.stringify([o.mood, o.outfit, o.level, o.title, o.room, o.phase, o.season, o.holiday, o.gift, o.asleep]);

  function renderRoom(opts) {
    const o = norm(opts);
    const wp = WALLPAPER[o.room.wallpaper] || WALLPAPER[""];
    const rug = RUG[o.room.rug] || RUG[""];
    const dark = o.phase === "night" ? 0.36 : o.phase === "dusk" || o.phase === "dawn" ? 0.1 : 0;
    const lamp = o.room.floorR === "lamp";
    let wall = `<rect x="-400" y="-400" width="1040" height="540" fill="${wp.base}"/>`;
    if (wp.stripe) for (let x = -96; x < 340; x += 24) wall += `<rect x="${x}" y="-400" width="10" height="540" fill="${wp.stripe}" opacity="0.7"/>`;
    if (wp.stars) wall += [[30, 110], [70, 14], [172, 96], [228, 12], [-20, 60], [260, 120], [140, 4]].map(([x, y]) => `<g transform="translate(${x} ${y}) scale(0.5)"><path d="${starPath}" fill="${P.butter}"/></g>`).join("");
    const floor = `<rect x="-400" y="140" width="1040" height="500" fill="${P.floor}"/>` +
      [-60, 0, 60, 120, 180, 240, 300].map((x) => `<path d="M${x} 140 L${x - 30} 240" stroke="${P.brown}" stroke-width="1" opacity="0.08"/>`).join("") +
      `<path d="M-400 140 H640" stroke="${P.brown}" stroke-width="3" opacity="0.25"/>`;
    const brick = (y) => `<path d="M82 ${y} h76" stroke="${P.brown}" stroke-width="1.4" opacity="0.35"/>`;
    const hearth =
      `<rect x="76" y="10" width="88" height="12" rx="6" fill="${P.butter}" ${OUT.replace("2.6", "4")}/>` +
      `<path d="M82 22 H158 V132 H82 Z" fill="${P.brick}" ${OUT.replace("2.6", "4")}/>` +
      brick(40) + brick(58) + brick(76) + brick(94) + brick(112) +
      `<path d="M98 132 V76 Q98 48 120 48 Q142 48 142 76 V132 Z" fill="${P.hole}" ${OUT.replace("2.6", "4")}/>` +
      `<g class="hm-fire"><path d="M120 128 C104 122 106 102 114 94 C114 102 118 104 120 98 C122 92 119 84 125 76 C128 86 138 94 136 108 C135 120 130 126 120 128 Z" fill="${P.pink}" stroke="${P.brown}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="M120 128 C112 124 114 112 120 107 C122 112 127 114 127 119 C127 124 124 127 120 128 Z" fill="${P.butter}"/></g>`;
    const rugArt = `<ellipse cx="120" cy="196" rx="84" ry="17" fill="${rug.fill}" stroke="${P.brown}" stroke-width="4"/>` +
      `<ellipse cx="120" cy="196" rx="64" ry="11" fill="none" stroke="${rug.ring}" stroke-width="3" stroke-dasharray="8 7" stroke-linecap="round"/>`;
    // The blob: the mascot's own svg, placed on the rug inside a walker (moved by JS) and an act layer (tricks, idle acts).
    const blob = !o.pet ? "" : M.renderSvg({ mood: o.mood, outfit: o.outfit, level: o.level, title: o.title }).replace("<svg ", `<svg x="68" y="112" width="104" height="104" `);
    const night = dark ? `<rect class="pw-dark" x="-400" y="-400" width="1040" height="1040" fill="#1B2140" opacity="${dark}"/>` +
      `<circle class="pw-fireglow" cx="120" cy="110" r="52" fill="${P.butter}" opacity="${o.phase === "night" ? 0.14 : 0.08}"/>` +
      (lamp ? `<circle class="pw-lampglow" cx="206" cy="122" r="44" fill="${P.butter}" opacity="0.28"/>` : "") : "";
    const label = (o.title ? o.title + ", " : "") + "the blob's room" + (o.asleep ? ", asleep" : "");
    return `<svg xmlns="http://www.w3.org/2000/svg" class="hm-scene pw-scene pw-${o.phase} pw-${o.season}${o.holiday ? " pw-h-" + o.holiday : ""}${o.asleep ? " pw-asleep" : ""}${o.still ? " pw-still" : ""}" viewBox="0 0 240 240" role="img" aria-label="${esc(label)}" data-mood="${esc(o.mood || "")}">` +
      wall + floor + windowArt(o) + wallItem(o.room.wall, o.now) + hearth + mantelItem(o.room.mantel, o.holiday) +
      floorL(o.room.floorL) + floorR(o.room.floorR, lamp && dark > 0) + holidayFloor(o.holiday) + rugArt + toyArt(o.room.toy) + giftArt(o.gift) +
      holidaySky(o.holiday) +
      (o.pet ? `<g class="pw-walker"><g class="pw-act">${blob}</g>${EXTRAS()}</g>` : "") + night +
      `</svg>`;
  }

  // ---------- DOM helper ----------

  const motionOff = () => typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "off";

  /**
   * Draws the room into `el`; { update(state), react(name), act(name, ms), look(dx, dy), walk(x), clock(now), svg() }.
   * update() redraws only when something visible changed, so the idle animations keep running between polls.
   */
  function mount(el, state) {
    let cur = norm(state), key = "", timers = {}, walkX = 0, lookAt = [0, 0];
    // What is playing right now, so a redraw in the middle (a mood or face change) carries it on instead of wiping it.
    const playing = { react: null, act: null };
    const root = () => el.querySelector("svg.pw-scene");
    const blob = () => el.querySelector("svg.pw-scene svg.hm");
    function draw() {
      const k = keyOf(cur);
      if (k === key) return;
      key = k;
      el.innerHTML = renderRoom(cur);
      walk(walkX, true);
      look(lookAt[0], lookAt[1]);
      resume();
    }
    /** Put a running reaction or act back on the new markup, rewound to where it was (negative delays on every animated part). */
    function resume() {
      const t = Date.now();
      for (const [kind, node, prefix] of [["react", blob(), "hm-react-"], ["act", root(), "pw-act-"]]) {
        const p = playing[kind];
        if (!p || !node) continue;
        const left = p.until - t;
        if (left <= 120) { playing[kind] = null; continue; }
        node.classList.add(prefix + p.name);
        rewind(node, t - p.at);
      }
    }
    function rewind(node, ms) {
      if (!(ms > 0) || typeof node.getAnimations !== "function") return;
      for (const a of node.getAnimations({ subtree: true })) {
        try { if (a.playState !== "finished") a.currentTime = (Number(a.currentTime) || 0) + ms; } catch (e) { /* ignore */ }
      }
    }
    function walk(x, instant) {
      walkX = Math.max(-46, Math.min(46, Number(x) || 0));
      const w = el.querySelector(".pw-walker");
      if (!w) return;
      if (instant) { w.style.transition = "none"; void w.getBoundingClientRect(); }
      w.style.transform = `translateX(${walkX}px)`;
      if (instant) requestAnimationFrame(() => { w.style.transition = ""; });
    }
    function look(dx, dy) {
      lookAt = [Math.max(-1, Math.min(1, dx || 0)), Math.max(-1, Math.min(1, dy || 0))];
      const face = el.querySelector("svg.pw-scene svg.hm .hm-face");
      if (face) face.setAttribute("transform", `translate(${(lookAt[0] * 5).toFixed(1)} ${(lookAt[1] * 3).toFixed(1)})`);
    }
    draw();
    return {
      update(next) { cur = norm(Object.assign({}, cur, next)); draw(); },
      react(name) {
        if (motionOff()) return;
        const svg = blob();
        if (!svg || !M.REACTIONS.includes(name)) return;
        M.REACTIONS.forEach((r) => svg.classList.remove("hm-react-" + r));
        void svg.getBoundingClientRect();
        svg.classList.add("hm-react-" + name);
        playing.react = { name, at: Date.now(), until: Date.now() + M.REACTION_MS };
        clearTimeout(timers.react);
        timers.react = setTimeout(() => { playing.react = null; const n = blob(); if (n) n.classList.remove("hm-react-" + name); }, M.REACTION_MS);
      },
      /** Play "pw-act-<name>" on the room for `ms` (a trick or an idle act). Returns false when motion is off. */
      act(name, ms) {
        const r = root();
        if (!r || motionOff()) return false;
        for (const c of [...r.classList]) if (c.startsWith("pw-act-")) r.classList.remove(c);
        void r.getBoundingClientRect();
        r.classList.add("pw-act-" + name);
        playing.act = { name, at: Date.now(), until: Date.now() + (ms || 2400) };
        clearTimeout(timers.act);
        timers.act = setTimeout(() => { playing.act = null; const n = root(); if (n) n.classList.remove("pw-act-" + name); }, ms || 2400);
        return true;
      },
      look, walk,
      /** Turn the clock's hands to `now` (once a minute) without a redraw. */
      clock(now) {
        const d = new Date(now || Date.now());
        const h = el.querySelector(".pw-hand-h"), m = el.querySelector(".pw-hand-m");
        if (!h || !m) return;
        const [, cx, cy] = /rotate\([^ ]+ ([\d.]+) ([\d.]+)\)/.exec(h.getAttribute("transform")) || [];
        if (!cx) return;
        h.setAttribute("transform", `rotate(${(((d.getHours() % 12) + d.getMinutes() / 60) * 30).toFixed(1)} ${cx} ${cy})`);
        m.setAttribute("transform", `rotate(${d.getMinutes() * 6} ${cx} ${cy})`);
      },
      svg: root,
      destroy() { Object.values(timers).forEach(clearTimeout); el.innerHTML = ""; },
    };
  }

  const api = { renderRoom, mount, keyOf, WALLPAPER, RUG, SKY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthWorld = api;
})(typeof window !== "undefined" ? window : globalThis);
