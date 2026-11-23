// Hearth places (2.1): the scenes the pet can live in besides the cozy room, bought in the shop and picked in the Room
// panel (relay spot "place"). Plain SVG strings like pet-world.js (literal colours, no ids, no scripts, no external
// references). Each place draws its own backdrop in the room's 240 x 240 space (running far past the sides so any
// widget shape is filled) and says which room spots it still shows: a beach has no wallpaper or mantel.
//
//   HearthPlaces.get(id) -> { label, shows: [spot...], ownSky, back(o, kit) -> svg } | null
// `o` is the room state (phase, season, now...), `kit` the room's palette and helpers (P, OUT, OUT2, SKY, starPath).
(function (root) {
  "use strict";

  const W = (x, y, w, h, fill, extra) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra ? " " + extra : ""}/>`;
  /** Sky in two bands for the phase, from far above down to `ground`. */
  const sky = (o, k, ground) => {
    const s = k.SKY[o.phase] || k.SKY.day;
    return W(-400, -400, 1040, 460, s.top) + W(-400, 40, 1040, ground - 40, s.low) + W(-400, 24, 1040, 18, s.low, 'opacity="0.5"');
  };
  const stars = (k, list, op) => list.map(([x, y, s], i) => `<g transform="translate(${x} ${y}) scale(${s || 0.4})"><path class="pw-twinkle pw-d${i % 4}" d="${k.starPath}" fill="${k.P.butter}" opacity="${op || 1}"/></g>`).join("");
  /** Sun by day, a low warm sun at dawn and dusk, the moon at night. */
  const sunMoon = (o, k, x, y) => {
    const P = k.P;
    if (o.phase === "night") return `<circle cx="${x}" cy="${y}" r="12" fill="${P.butter}"/><circle cx="${x + 5}" cy="${y - 3}" r="10.5" fill="${(k.SKY.night).top}"/>` +
      stars(k, [[x - 120, y - 10, 0.4], [x - 70, y + 14, 0.35], [x - 170, y + 22, 0.45], [x - 30, y + 30, 0.3], [x - 200, y - 6, 0.35], [x + 30, y + 26, 0.4]]);
    if (o.phase === "dawn" || o.phase === "dusk") return `<circle cx="${x}" cy="${y + 40}" r="14" fill="#FFD27A" ${k.OUT2}/>`;
    return `<circle class="pw-sun" cx="${x}" cy="${y}" r="13" fill="${P.butter}" stroke="#F2C14E" stroke-width="3"/>`;
  };
  const cloud = (k, x, y, s, d) => `<g class="pw-cloud pw-d${d || 0}" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="16" ry="7" fill="${k.P.white}"/><ellipse cx="8" cy="-5" rx="10" ry="7" fill="${k.P.white}"/><ellipse cx="-8" cy="-2" rx="8" ry="5.5" fill="${k.P.white}"/></g>`;
  const bird = (k, x, y, d) => `<path class="pw-bird pw-d${d || 0}" d="M${x} ${y} q3 -3 6 0 q3 -3 6 0" fill="none" stroke="${k.P.ink}" stroke-width="1.3" stroke-linecap="round"/>`;
  const flower = (k, x, y, petal, sway) => `<g class="${sway ? "pw-sway pw-d" + (sway % 4) : ""}"><path d="M${x} ${y} V${y - 16}" stroke="#7DBE5B" stroke-width="2.2"/>` +
    [0, 72, 144, 216, 288].map((a) => `<circle cx="${(x + Math.cos(a * Math.PI / 180) * 3.6).toFixed(1)}" cy="${(y - 18 + Math.sin(a * Math.PI / 180) * 3.6).toFixed(1)}" r="3" fill="${petal}" ${k.OUT2.replace("1.8", "1")}/>`).join("") +
    `<circle cx="${x}" cy="${y - 18}" r="2.4" fill="${k.P.butter}" ${k.OUT2.replace("1.8", "1")}/></g>`;
  const planks = (k, y0, y1, fill, line, step) => {
    let s = W(-400, y0, 1040, y1 - y0, fill);
    for (let y = y0 + step; y < y1; y += step) s += `<path d="M-400 ${y} H640" stroke="${line}" stroke-width="1.4" opacity="0.5"/>`;
    return s;
  };

  const PLACES = {
    garden: {
      label: "Garden", shows: ["rug", "toy", "floorL", "floorR"],
      back(o, k) {
        const P = k.P;
        let s = sky(o, k, 150) + sunMoon(o, k, 200, 34) + (o.phase === "night" ? "" : cloud(k, 46, 34, 1, 0) + cloud(k, 150, 18, 0.8, 2) + bird(k, 96, 40, 1));
        s += `<path d="M-400 132 Q-60 96 60 124 Q150 104 240 122 Q420 100 640 130 V160 H-400 Z" fill="#B9DC9A"/>`;
        s += `<path d="M-400 140 Q0 120 120 136 Q260 120 640 138 V160 H-400 Z" fill="#A6D184"/>`;
        // the fence
        for (let x = -98; x < 340; x += 22) s += `<path d="M${x} 150 V122 l5 -6 l5 6 V150 Z" fill="#F7E7CB" ${k.OUT2}/>`;
        s += `<rect x="-400" y="128" width="1040" height="5" fill="#EFD9B2" ${k.OUT2}/><rect x="-400" y="141" width="1040" height="5" fill="#EFD9B2" ${k.OUT2}/>`;
        // sunflowers peeking over the fence
        for (const [x, d] of [[-8, 0], [250, 1], [78, 2]]) s += `<g class="pw-sway pw-d${d}"><path d="M${x} 150 V96" stroke="#5E9E5A" stroke-width="3"/><path d="M${x} 124 q-10 -6 -12 2 q8 4 12 -2 Z" fill="#7DBE5B" ${k.OUT2}/>` +
          [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse cx="${x}" cy="${86}" rx="4" ry="9" fill="#FFCF4A" ${k.OUT2.replace("1.8", "1.2")} transform="rotate(${a} ${x} 96) translate(0 0)"/>`).join("") +
          `<circle cx="${x}" cy="96" r="7" fill="#8A5A3C" ${k.OUT2}/></g>`;
        // the lawn
        s += W(-400, 150, 1040, 500, "#CFE9B4") + `<path d="M-400 150 H640" stroke="#9CC77C" stroke-width="3"/>`;
        for (const [x, y] of [[20, 168], [64, 226], [176, 230], [222, 172], [140, 162], [-30, 200], [262, 214], [104, 168]]) s += `<path d="M${x} ${y} l-3 -7 M${x} ${y} l0 -8 M${x} ${y} l3 -7" stroke="#8CC07A" stroke-width="1.6" stroke-linecap="round"/>`;
        s += flower(k, 12, 222, P.pink, 1) + flower(k, 232, 214, "#9ED3EE", 2) + flower(k, 60, 236, P.butter, 3) + flower(k, 190, 236, P.pinkDeep, 0);
        if (o.phase !== "night") s += `<g class="pw-x-butterfly-garden"><g class="pw-bird pw-d2" transform="translate(166 84)"><path d="M0 0 q-6 -7 -8 -2 q2 4 8 2 q6 -7 8 -2 q-2 4 -8 2" fill="${P.pink}" ${k.OUT2.replace("1.8", "1")}/></g></g>`;
        else s += [[30, 170], [200, 160], [120, 140]].map(([x, y], i) => `<circle class="pw-firefly pw-d${i}" cx="${x}" cy="${y}" r="1.6" fill="#F6F59A"/>`).join("");
        return s;
      },
    },
    beach: {
      label: "Beach", shows: ["rug", "toy", "floorR"],
      back(o, k) {
        const P = k.P;
        let s = sky(o, k, 104) + sunMoon(o, k, 196, 30) + (o.phase === "night" ? "" : cloud(k, 60, 30, 0.9, 1) + bird(k, 120, 44, 0) + bird(k, 138, 52, 2));
        const sea = o.phase === "night" ? "#2F4F7E" : "#7CC6EA", sea2 = o.phase === "night" ? "#3C6296" : "#A4DBF2";
        s += W(-400, 100, 1040, 52, sea) + W(-400, 100, 1040, 6, sea2);
        s += `<g class="pw-bob pw-d1"><path d="M30 98 h24 l-4 6 h-16 Z" fill="${P.white}" ${k.OUT2}/><path d="M42 97 V78 l11 16 Z" fill="${P.pink}" ${k.OUT2}/></g>`;
        for (let i = 0; i < 3; i++) s += `<path class="pw-wave pw-d${i}" d="M-420 ${116 + i * 11} q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="${P.white}" stroke-width="2" stroke-linecap="round" opacity="${0.75 - i * 0.15}"/>`;
        // sand, the wet edge, shells
        s += W(-400, 150, 1040, 500, "#F6E1B0") + `<path d="M-400 150 Q-300 146 -200 151 T0 150 T200 151 T400 149 T640 151 V158 H-400 Z" fill="#E9CC8C"/>`;
        for (const [x, y] of [[30, 180], [90, 214], [160, 170], [210, 224], [-20, 210], [260, 182], [130, 232]]) s += `<circle cx="${x}" cy="${y}" r="1.4" fill="#D6B577"/>`;
        s += `<path d="M150 228 l3 -7 l3 7 l7 1 l-5 5 l2 7 l-7 -3 l-6 3 l1 -7 l-5 -5 Z" fill="#F2A04B" ${k.OUT2}/>`;
        s += `<path d="M38 226 q6 -10 12 0 Z" fill="${P.pink}" ${k.OUT2}/><path d="M41 226 l3 -6 M47 226 l-3 -6" stroke="${P.brown}" stroke-width="1"/>`;
        // the umbrella (left corner)
        s += `<path d="M40 196 L58 104" stroke="${P.brown}" stroke-width="3.4" stroke-linecap="round"/>` +
          `<path d="M4 120 Q22 76 76 96 Q66 104 58 104 Q48 98 40 108 Q30 104 22 114 Q12 112 4 120 Z" fill="${P.pinkDeep}" ${k.OUT2}/>` +
          `<path d="M22 114 Q30 86 58 86 M40 108 Q44 90 58 86 M58 104 Q60 94 58 86" fill="none" stroke="${P.white}" stroke-width="3" opacity="0.8"/>`;
        return s;
      },
    },
    snowy: {
      label: "Snowy cabin", shows: ["rug", "toy", "floorL", "floorR", "wall"],
      back(o, k) {
        const P = k.P, s0 = k.SKY[o.phase] || k.SKY.day;
        let s = "";
        for (let y = -400, i = 0; y < 142; y += 16, i++) s += `<rect x="-400" y="${y}" width="1040" height="16" fill="${i % 2 ? "#C99A6B" : "#BB8A5D"}"/><path d="M-400 ${y + 16} H640" stroke="${P.brown}" stroke-width="1.6" opacity="0.45"/>`;
        for (const [x, y] of [[30, 12], [150, 44], [206, 108], [-40, 76], [96, 124], [260, 28]]) s += `<circle cx="${x}" cy="${y}" r="2.4" fill="#8A6040" opacity="0.6"/>`;
        // the window: snow and pines outside
        let out = W(0, 0, 50, 60, s0.low) + W(0, 0, 50, 26, s0.top);
        if (o.phase === "night") out += `<circle cx="38" cy="12" r="5" fill="${P.butter}"/>`;
        out += `<path d="M0 44 Q25 34 50 44 V60 H0 Z" fill="${P.white}"/>`;
        for (const [x, h] of [[10, 26], [24, 20], [40, 28]]) out += `<path d="M${x} ${52 - h} l-7 ${h * 0.55} h4 l-6 ${h * 0.45} h18 l-6 ${-h * 0.45} h4 Z" fill="#4F8A68" stroke="${P.brown}" stroke-width="0.8"/><path d="M${x} ${52 - h} l-3 5 h6 Z" fill="${P.white}"/>`;
        out += [6, 16, 26, 36, 44, 11, 31, 21].map((x, i) => `<circle class="pw-snow pw-d${i % 4}" cx="${x}" cy="${-4 - (i % 3) * 7}" r="1.5" fill="${P.white}"/>`).join("");
        s += `<rect x="10" y="22" width="58" height="68" rx="4" fill="#F7E7CB" ${k.OUT}/><svg x="14" y="26" width="50" height="60" viewBox="0 0 50 60">${out}</svg>` +
          `<path d="M39 26 V86 M14 54 H64" stroke="#F7E7CB" stroke-width="3"/><rect x="6" y="88" width="66" height="8" rx="3" fill="${P.white}" ${k.OUT2}/>`;
        // the iron stove with a kettle
        s += `<path d="M114 -400 V40" stroke="#3E3A3A" stroke-width="10"/><path d="M114 -400 V40" stroke="#5A5454" stroke-width="5"/>` +
          `<rect x="88" y="40" width="52" height="16" rx="4" fill="#4A4444" ${k.OUT}/><rect x="84" y="56" width="60" height="70" rx="8" fill="#3E3A3A" ${k.OUT}/>` +
          `<rect x="98" y="70" width="32" height="32" rx="6" fill="#2A2020" ${k.OUT2}/>` +
          `<g class="pw-flame"><path d="M114 100 C104 96 106 84 110 80 C112 86 114 86 115 82 C116 78 115 74 118 70 C121 76 126 82 124 90 C123 97 120 100 114 100 Z" fill="#F2913D"/><path d="M114 100 C109 98 110 92 114 89 C116 92 119 94 119 96 C119 99 117 100 114 100 Z" fill="${P.butter}"/></g>` +
          `<rect x="92" y="126" width="8" height="12" fill="#3E3A3A" ${k.OUT2}/><rect x="128" y="126" width="8" height="12" fill="#3E3A3A" ${k.OUT2}/>` +
          `<path d="M150 38 h18 q4 0 4 4 v10 q0 4 -4 4 h-18 q-4 0 -4 -4 v-10 q0 -4 4 -4 Z" fill="${P.pinkDeep}" ${k.OUT2}/><path d="M146 44 q-6 0 -6 -6" fill="none" stroke="${P.brown}" stroke-width="2"/>` +
          `<path class="pw-steam" d="M158 32 q-4 -5 0 -10 q4 -5 0 -10" fill="none" stroke="${P.white}" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>`;
        s += planks(k, 140, 640, "#D9A877", "#A87A4E", 14) + `<path d="M-400 140 H640" stroke="${P.brown}" stroke-width="3" opacity="0.35"/>`;
        return s;
      },
    },
    starry: {
      label: "Starry hill", shows: ["rug", "toy", "floorR"], ownSky: true,
      back(o, k) {
        const P = k.P;
        let s = W(-400, -400, 1040, 500, "#1C2550") + W(-400, 60, 1040, 100, "#2B3670") + W(-400, 100, 1040, 60, "#36447F");
        s += stars(k, [[20, 20, 0.6], [60, 50, 0.4], [96, 14, 0.5], [130, 40, 0.35], [160, 66, 0.45], [228, 84, 0.4], [-30, 40, 0.5], [270, 30, 0.5], [44, 84, 0.3], [110, 80, 0.3], [-60, 90, 0.4], [300, 70, 0.35], [8, 60, 0.3]]);
        s += `<circle cx="190" cy="40" r="20" fill="#FFF6CF" ${k.OUT2}/><circle cx="183" cy="35" r="4" fill="#EFE3B0"/><circle cx="196" cy="48" r="3" fill="#EFE3B0"/><circle cx="198" cy="32" r="2" fill="#EFE3B0"/>`;
        s += `<circle cx="190" cy="40" r="30" fill="#FFF6CF" opacity="0.12"/>`;
        s += `<path class="pw-shoot" d="M60 16 l26 10" stroke="${P.white}" stroke-width="2" stroke-linecap="round"/>`;
        s += `<path d="M-400 132 Q-100 96 80 120 Q180 100 300 116 Q460 104 640 122 V200 H-400 Z" fill="#2E4A5C"/>`;
        s += `<path d="M-400 156 Q0 120 120 140 Q240 124 640 150 V640 H-400 Z" fill="#3D6B50"/>` + W(-400, 170, 1040, 470, "#3D6B50");
        // the tent with a lantern (left corner)
        s += `<path d="M-4 176 L32 108 L72 176 Z" fill="#F2913D" ${k.OUT}/><path d="M32 108 L22 176 H42 Z" fill="#7A3E26" ${k.OUT2}/>` +
          `<path d="M32 108 V100" stroke="${P.brown}" stroke-width="2"/><path d="M32 100 l9 3 l-9 3" fill="${P.pink}" ${k.OUT2.replace("1.8", "1")}/>` +
          `<circle class="pw-fireglow" cx="78" cy="172" r="16" fill="${P.butter}" opacity="0.2"/><rect x="72" y="164" width="12" height="14" rx="3" fill="${P.butter}" ${k.OUT2}/><path d="M74 164 q4 -6 8 0" fill="none" stroke="${P.brown}" stroke-width="1.6"/>`;
        s += [[100, 158], [180, 150], [210, 190], [40, 206], [150, 220]].map(([x, y], i) => `<circle class="pw-firefly pw-d${i % 4}" cx="${x}" cy="${y}" r="1.7" fill="#F6F59A"/>`).join("");
        for (const [x, y] of [[120, 222], [24, 230], [228, 214], [180, 236]]) s += `<path d="M${x} ${y} l-3 -7 M${x} ${y} l0 -8 M${x} ${y} l3 -7" stroke="#5E8C66" stroke-width="1.6" stroke-linecap="round"/>`;
        return s;
      },
    },
    cafe: {
      label: "Cozy cafe", shows: ["rug", "toy", "floorL", "floorR", "wall"],
      back(o, k) {
        const P = k.P;
        let s = W(-400, -400, 1040, 500, "#FFF1DC") + W(-400, 100, 1040, 40, "#E5B98C");
        for (let x = -396; x < 640; x += 12) s += `<path d="M${x} 100 V140" stroke="#C9976A" stroke-width="1.4"/>`;
        s += `<path d="M-400 100 H640" stroke="${P.brown}" stroke-width="2.4"/>`;
        // the chalkboard menu
        s += `<rect x="8" y="22" width="62" height="64" rx="4" fill="#3C5A4A" stroke="#A8784E" stroke-width="5"/>` +
          `<path d="M18 34 h12 M34 34 h8 M46 34 h12" stroke="#F1F1E8" stroke-width="2.2" stroke-linecap="round"/>` +
          `<path d="M18 48 h22 M18 58 h16 M18 68 h20" stroke="#F1F1E8" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>` +
          `<path d="M50 52 h12 v8 q0 6 -6 6 q-6 0 -6 -6 Z M62 54 q4 0 4 3 q0 3 -4 3" fill="none" stroke="#F1F1E8" stroke-width="1.6"/>` +
          `<path d="M56 74 C49 69 52 64 56 67 C60 64 63 69 56 74 Z" fill="${P.pink}"/>`;
        // hanging lamps
        for (const [x, d] of [[96, 0], [150, 2]]) s += `<path d="M${x} -400 V18" stroke="${P.brown}" stroke-width="1.6"/><path d="M${x - 11} 30 Q${x} 12 ${x + 11} 30 Z" fill="#F2C14E" ${k.OUT2}/>` +
          `<circle class="pw-fireglow pw-d${d}" cx="${x}" cy="34" r="14" fill="${P.butter}" opacity="0.25"/>`;
        // the counter with a cake stand and cupcakes
        s += `<rect x="76" y="92" width="96" height="48" rx="3" fill="#C99A6B" ${k.OUT}/><rect x="72" y="86" width="104" height="9" rx="3" fill="#8A5A3C" ${k.OUT2}/>` +
          `<path d="M90 104 h68 M90 120 h68" stroke="${P.brown}" stroke-width="1.4" opacity="0.4"/>` +
          `<path d="M92 86 v-4 h20 v4 M102 82 v-14" stroke="${P.brown}" stroke-width="1.8" fill="none"/><path d="M92 68 h20 v-6 q-10 -10 -20 0 Z" fill="${P.white}" ${k.OUT2}/>` +
          `<path d="M94 62 h16" stroke="${P.pink}" stroke-width="3"/><circle cx="102" cy="54" r="2.6" fill="${P.pinkDeep}" ${k.OUT2.replace("1.8", "1")}/>`;
        for (const [x, c] of [[126, P.pink], [140, "#9ED3EE"], [154, P.butter]]) s += `<path d="M${x - 5} 86 l1.5 -8 h7 l1.5 8 Z" fill="#E9C28E" ${k.OUT2.replace("1.8", "1.2")}/><path d="M${x - 6} 78 q6 -9 12 0 Z" fill="${c}" ${k.OUT2.replace("1.8", "1.2")}/>`;
        s += `<path class="pw-steam" d="M176 76 q-3 -4 0 -8 q3 -4 0 -8" fill="none" stroke="#C9B9A6" stroke-width="2" stroke-linecap="round"/><rect x="170" y="78" width="12" height="10" rx="2" fill="${P.white}" ${k.OUT2}/>`;
        // checker floor
        s += W(-400, 140, 1040, 500, "#F4E3C8");
        for (let y = 147, r = 0; y < 300; y += 14, r++) s += `<path d="M-400 ${y} H640" stroke="#E6CBA6" stroke-width="14" stroke-dasharray="14 14" stroke-dashoffset="${(r % 2) * 14}"/>`;
        s += `<path d="M-400 140 H640" stroke="${P.brown}" stroke-width="3" opacity="0.35"/>`;
        return s;
      },
    },
    treehouse: {
      label: "Treehouse", shows: ["rug", "toy", "floorL", "floorR", "wall"],
      back(o, k) {
        const P = k.P, s0 = k.SKY[o.phase] || k.SKY.day;
        let s = "";
        for (let x = -400, i = 0; x < 640; x += 20, i++) s += `<rect x="${x}" y="-400" width="20" height="540" fill="${i % 2 ? "#D9A877" : "#CF9C6A"}"/><path d="M${x} -400 V140" stroke="${P.brown}" stroke-width="1.2" opacity="0.4"/>`;
        for (let x = -70; x < 320; x += 20) s += `<circle cx="${x}" cy="12" r="1" fill="${P.brown}" opacity="0.5"/><circle cx="${x}" cy="120" r="1" fill="${P.brown}" opacity="0.5"/>`;
        // the round window full of leaves and birds
        let out = W(0, 0, 100, 100, s0.low) + W(0, 0, 100, 40, s0.top);
        if (o.phase === "night") out += stars(k, [[20, 18, 0.5], [70, 12, 0.4], [50, 30, 0.35]]) + `<circle cx="74" cy="26" r="7" fill="${P.butter}"/>`;
        else out += cloud(k, 30, 30, 0.9, 1) + bird(k, 54, 22, 0) + bird(k, 66, 30, 2);
        out += `<path d="M-6 70 Q20 54 40 70 Q60 56 80 72 Q96 60 110 70 V110 H-6 Z" fill="#7DBE5B"/><path d="M-6 84 Q30 70 60 86 Q86 74 110 84 V110 H-6 Z" fill="#5E9E5A"/>`;
        // a square view under a thick round frame (no clip paths: the frame covers the corners)
        s += `<svg x="80" y="26" width="80" height="80" viewBox="0 0 100 100">${out}</svg>` +
          `<circle cx="120" cy="66" r="50.5" fill="none" stroke="#C99A6B" stroke-width="15"/>` +
          `<circle cx="120" cy="66" r="58" fill="none" ${k.OUT}/><circle cx="120" cy="66" r="43" fill="none" ${k.OUT}/>` +
          `<path d="M120 23 V109 M77 66 H163" stroke="#C99A6B" stroke-width="4"/><path d="M120 23 V109 M77 66 H163" stroke="${P.brown}" stroke-width="0.8" opacity="0.4"/>`;
        // leaves and a branch over the top corners
        const leaf = (x, y, r, c, d) => `<g class="pw-sway pw-d${d}"><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.62}" fill="${c}" ${k.OUT2}/></g>`;
        s += `<path d="M-400 -6 Q-60 10 40 -2 Q120 -14 200 4 Q300 16 640 -4" fill="none" stroke="#8A5A3C" stroke-width="9" stroke-linecap="round"/>`;
        s += leaf(-6, 4, 16, "#7DBE5B", 0) + leaf(20, -4, 13, "#5E9E5A", 1) + leaf(186, 8, 15, "#7DBE5B", 2) + leaf(214, -2, 12, "#5E9E5A", 3) + leaf(240, 10, 16, "#7DBE5B", 1) + leaf(52, 2, 10, "#8CC07A", 2);
        // a hanging lantern
        s += `<path d="M44 0 V34" stroke="${P.brown}" stroke-width="1.6"/><rect x="38" y="34" width="12" height="16" rx="3" fill="${P.butter}" ${k.OUT2}/><circle class="pw-fireglow" cx="44" cy="42" r="14" fill="${P.butter}" opacity="0.2"/>`;
        s += planks(k, 140, 640, "#C99A6B", "#8A6040", 12) + `<path d="M-400 140 H640" stroke="${P.brown}" stroke-width="3" opacity="0.4"/>`;
        return s;
      },
    },
  };

  const get = (id) => (Object.prototype.hasOwnProperty.call(PLACES, id) ? PLACES[id] : null);
  const api = { get, ids: Object.freeze(Object.keys(PLACES)) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthPlaces = api;
})(typeof window !== "undefined" ? window : globalThis);
