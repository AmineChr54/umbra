// Hearth mascot: an original round "blob spirit" drawn as plain SVG, in the Meadow palette. Pure functions, no
// dependencies. The only DOM code is `mount`, which is optional.
//
// Browser: window.HearthMascot. Node: module.exports. Pair it with mascot.css (idle animations, reactions).
//
//   HearthMascot.renderSvg({ mood: "happy", outfit: ["hat", "scarf"], level: 7 })  -> "<svg ...>...</svg>"
//   HearthMascot.renderScene({ mood, outfit, level })   -> the same blob standing on a rug in front of a small hearth
//   const m = HearthMascot.mount(element, { mood, outfit, level }); m.update({ mood: "sad" }); m.react("feed");
//
// The strings carry no scripts, no event handlers, no <style> and no external references: every colour is a literal
// attribute, so a string also works as an <img> or a data: URL (static, without the animations).
//
// Staged in tools/hearth-mascot/ until the widget skeleton (#209) exists; copy mascot.js and mascot.css into
// widgets/hearth/ (a widget folder is self-contained) and load them from index.html.
(function (root) {
  "use strict";

  // ---------- palette (Meadow) ----------

  const PALETTE = Object.freeze({
    green: "#DDF0C8", butter: "#FFF3B0", pink: "#F7A8C4", brown: "#6B4F3A",
    // supporting shades for shading, tongue, water and the scene
    greenDeep: "#B7DA98", pinkDeep: "#E5648F", ink: "#4A3426", mouth: "#7A3246", water: "#BFE6F5",
    white: "#FFFFFF", wall: "#FFF8DC", floor: "#E9F5D8", brick: "#F6DCC8", hole: "#5E4533",
  });
  const P = PALETTE;

  // ---------- vocabulary ----------

  /** Faces. `love` is what a received tap shows. */
  const MOODS = Object.freeze(["happy", "content", "hungry", "thirsty", "sleepy", "sad", "love"]);
  /** One-shot reaction animations (restarted by `mount().react`). */
  const REACTIONS = Object.freeze(["feed", "water", "pet", "tap"]);
  /** An outfit occupies one slot; two outfits in the same slot never combine (the later one wins). */
  const SLOTS = Object.freeze(["head", "face", "neck"]);
  const OUTFIT_SLOT = Object.freeze({
    hat: "head", "flower-crown": "head", party: "head", anniversary: "head",
    glasses: "face",
    scarf: "neck", bow: "neck",
  });
  const OUTFITS = Object.freeze(Object.keys(OUTFIT_SLOT));
  /** Outfits that are unlocked by a milestone rather than by a level. */
  const CELEBRATION_OUTFITS = Object.freeze(["party", "anniversary"]);

  const DEFAULT_MOOD = "content";
  const STAGE_COUNT = 5;
  /** The lowest level of each growth stage (index 0 = stage 1). The pet logic may change these. */
  const STAGE_FROM_LEVEL = Object.freeze([1, 3, 6, 10, 15]);
  const STAGE_SCALE = Object.freeze([0.8, 0.87, 0.93, 0.97, 1]);
  const REACTION_MS = 1800;

  // ---------- selection (pure) ----------

  const isMood = (m) => MOODS.includes(m);

  function stageForLevel(level) {
    const n = Math.floor(Number(level));
    if (!Number.isFinite(n) || n < 1) return 1;
    let stage = 1;
    STAGE_FROM_LEVEL.forEach((from, i) => { if (n >= from) stage = i + 1; });
    return stage;
  }

  /** Unknown ids are dropped, one outfit per slot (the last one wins), ordered head, face, neck. Accepts a string, an array or nothing. */
  function normalizeOutfit(outfit) {
    const list = Array.isArray(outfit) ? outfit : typeof outfit === "string" && outfit ? [outfit] : [];
    const bySlot = {};
    for (const id of list) if (typeof id === "string" && Object.prototype.hasOwnProperty.call(OUTFIT_SLOT, id)) bySlot[OUTFIT_SLOT[id]] = id;
    return SLOTS.filter((s) => bySlot[s]).map((s) => bySlot[s]);
  }

  /** Always returns a complete, valid option set: { mood, outfit[], level, stage, reaction|null, title }. */
  function normalize(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const level = Number.isFinite(Number(o.level)) && Number(o.level) >= 1 ? Math.min(999, Math.floor(Number(o.level))) : 1;
    return {
      mood: isMood(o.mood) ? o.mood : DEFAULT_MOOD,
      outfit: normalizeOutfit(o.outfit),
      level,
      stage: stageForLevel(level),
      reaction: REACTIONS.includes(o.reaction) ? o.reaction : null,
      title: typeof o.title === "string" ? o.title.slice(0, 40) : "",
    };
  }

  const need = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : dflt; };

  /**
   * The mood for a pet state. Needs are 0..100 where 100 is fully satisfied (the relay decays them).
   *   { hunger, thirst, affection, bonded, tapped, hour }   all optional; a missing need counts as 60.
   * Priority: tapped -> love; affection < 25 -> sad; hunger or thirst < 30 -> hungry/thirsty (the lower one);
   * affection < 45 or night (hour 22..5) -> sleepy; bonded or all needs >= 70 -> happy; otherwise content.
   * The lowest state is sad: nothing here can make the pet disappear.
   */
  function moodFor(state) {
    const s = state && typeof state === "object" ? state : {};
    const hunger = need(s.hunger, 60), thirst = need(s.thirst, 60), affection = need(s.affection, 60);
    if (s.tapped) return "love";
    if (affection < 25) return "sad";
    if (hunger < 30 || thirst < 30) return hunger <= thirst ? "hungry" : "thirsty";
    const hour = Number(s.hour);
    const night = Number.isFinite(hour) && (hour >= 22 || hour < 6);
    if (affection < 45 || night) return "sleepy";
    if (s.bonded || Math.min(hunger, thirst, affection) >= 70) return "happy";
    return "content";
  }

  /** The celebration outfit unlocked on a milestone day count: a year (or a multiple) -> anniversary, else every 100 days -> party. */
  function milestoneOutfit(days) {
    const d = Math.floor(Number(days));
    if (!Number.isFinite(d) || d < 1) return null;
    if (d % 365 === 0) return "anniversary";
    if (d % 100 === 0) return "party";
    return null;
  }

  // ---------- svg pieces ----------

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const OUT = `stroke="${P.brown}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`;
  const OUT3 = `stroke="${P.brown}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
  const LINE = (w) => `fill="none" stroke="${P.ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

  const BODY_D = "M100 34 C138 34 166 64 168 106 C170 142 146 166 100 166 C54 166 30 142 32 106 C34 64 62 34 100 34 Z";
  const HEART_D = "M0 8 C-14 -2 -9 -13 0 -6 C9 -13 14 -2 0 8 Z";
  const STAR_D = "M0 -7 Q1.2 -1.2 7 0 Q1.2 1.2 0 7 Q-1.2 1.2 -7 0 Q-1.2 -1.2 0 -7 Z";

  const heart = (x, y, s, fill) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="${HEART_D}" fill="${fill}"/></g>`;
  const star = (x, y, s, cls, delay) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path class="hm-twinkle${delay ? " hm-d" + delay : ""}" d="${STAR_D}" fill="${P.butter}" stroke="${P.brown}" stroke-width="1.6" stroke-linejoin="round"/></g>`;
  const droplet = (x, y, s, extra) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path ${extra || ""} d="M0 -9 C5 -2 8 2 8 5 A8 8 0 0 1 -8 5 C-8 2 -5 -2 0 -9 Z" fill="${P.water}" stroke="${P.brown}" stroke-width="2.4" stroke-linejoin="round"/></g>`;
  const flower = (x, y, r, petal, center) => {
    let s = "";
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 - 90) * Math.PI / 180;
      s += `<circle cx="${(x + Math.cos(a) * r * 0.62).toFixed(1)}" cy="${(y + Math.sin(a) * r * 0.62).toFixed(1)}" r="${(r * 0.52).toFixed(1)}" fill="${petal}" stroke="${P.brown}" stroke-width="1.3"/>`;
    }
    return s + `<circle cx="${x}" cy="${y}" r="${(r * 0.38).toFixed(1)}" fill="${center}" stroke="${P.brown}" stroke-width="1.3"/>`;
  };

  const eyeOpen = (cx, o) => {
    const k = o || {};
    return `<ellipse cx="${cx}" cy="100" rx="${k.rx || 7}" ry="${k.ry || 9}" fill="${P.ink}"/>` +
      `<circle cx="${cx + 2.5}" cy="${k.ry > 9 ? 95 : 96.5}" r="${k.hl || 2.6}" fill="${P.white}"/>` +
      (k.wet ? `<circle cx="${cx - 2.5}" cy="104.5" r="1.7" fill="${P.white}"/>` : "");
  };
  const eyesOpen = (o) => `<g class="hm-eyes">${eyeOpen(74, o)}${eyeOpen(126, o)}</g>`;
  const eyesHappyClosed = `<path d="M66 104 Q74 91 82 104" ${LINE(4)}/><path d="M118 104 Q126 91 134 104" ${LINE(4)}/>`;
  const eyesSleepy = `<path d="M66 99 Q74 108 82 99" ${LINE(4)}/><path d="M118 99 Q126 108 134 99" ${LINE(4)}/>`;
  const eyesHalf = `<g class="hm-eyes">` + [74, 126].map((cx) =>
    `<path d="M${cx - 7} 101 A7 8 0 0 0 ${cx + 7} 101 Z" fill="${P.ink}"/><path d="M${cx - 9} 101 H${cx + 9}" ${LINE(3.2)}/>`).join("") + `</g>`;
  const eyesLove = heart(74, 99, 0.85, P.pinkDeep) + heart(126, 99, 0.85, P.pinkDeep);
  const browsSad = `<path d="M63 87 L82 80" ${LINE(3)}/><path d="M137 87 L118 80" ${LINE(3)}/>`;

  const mouthOpen = (wide) => {
    const w = wide ? 14 : 13;
    return `<g class="hm-mouth"><path d="M${100 - w} 112 Q100 134 ${100 + w} 112 Z" fill="${P.mouth}" stroke="${P.brown}" stroke-width="3" stroke-linejoin="round"/>` +
      `<ellipse cx="100" cy="118.5" rx="5.5" ry="3" fill="${P.pink}"/></g>`;
  };
  const mouthSmile = `<g class="hm-mouth"><path d="M91 113 Q100 122 109 113" ${LINE(3.6)}/></g>`;
  const mouthO = `<g class="hm-mouth"><ellipse cx="100" cy="119" rx="5" ry="6.5" fill="${P.mouth}" stroke="${P.brown}" stroke-width="3"/></g>`;
  const mouthTiny = `<g class="hm-mouth"><ellipse cx="100" cy="118" rx="4" ry="3" fill="${P.mouth}" stroke="${P.brown}" stroke-width="2.4"/></g>`;
  const mouthFrown = `<g class="hm-mouth"><path d="M90 123 Q100 112 110 123" ${LINE(3.6)}/></g>`;
  const mouthThirsty = `<g class="hm-mouth"><path d="M91 114 Q100 120 109 114" ${LINE(3.6)}/>` +
    `<path d="M95 117 Q100 134 105 117 Z" fill="${P.pink}" stroke="${P.brown}" stroke-width="2.4" stroke-linejoin="round"/></g>`;

  const cheeks = (op, rx) =>
    `<ellipse cx="${rx > 12 ? 50 : 53}" cy="120" rx="${rx}" ry="8" fill="${P.pink}" opacity="${op}"/>` +
    `<ellipse cx="${rx > 12 ? 150 : 147}" cy="120" rx="${rx}" ry="8" fill="${P.pink}" opacity="${op}"/>`;

  /** Eyes, mouth, cheeks and small marks of each mood. Floating decoration (zzz, hearts) is in `moodFloaters`. */
  const FACES = {
    happy: () => cheeks(0.8, 12) + eyesOpen() + mouthOpen(false),
    content: () => cheeks(0.7, 12) + eyesHappyClosed + mouthSmile,
    hungry: () => cheeks(0.55, 11) + eyesOpen({ rx: 7.5, ry: 10, hl: 3.4 }) + mouthO +
      `<path class="hm-rumble" d="M80 138 q4.5 -5 9 0 t9 0 t9 0 t9 0" ${LINE(2.6)} opacity="0.5"/>`,
    thirsty: () => cheeks(0.5, 11) + eyesHalf + mouthThirsty + droplet(151, 70, 0.8, `class="hm-drip"`),
    sleepy: () => cheeks(0.6, 12) + eyesSleepy + mouthTiny,
    sad: () => cheeks(0.3, 11) + eyesOpen({ rx: 7.5, ry: 10.5, hl: 3, wet: true }) + browsSad + mouthFrown +
      droplet(64, 117, 0.65, `class="hm-drip"`),
    love: () => cheeks(1, 14) + eyesLove + mouthOpen(true),
  };

  const zed = (x, y, s, d) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="hm-zfloat hm-d${d}" d="M0 0 H9 L0 11 H9" ${LINE(2.8)}/></g>`;
  const FLOATERS = {
    sleepy: () => zed(146, 56, 1, 0) + zed(160, 36, 0.8, 1) + zed(172, 20, 0.65, 2),
    love: () => `<g class="hm-float hm-d0">${heart(28, 58, 0.9, P.pink)}</g><g class="hm-float hm-d1">${heart(173, 44, 1.1, P.pink)}</g><g class="hm-float hm-d2">${heart(160, 74, 0.6, P.pinkDeep)}</g>`,
  };

  const sprout = (stage) => {
    if (stage < 2) return "";
    const right = `<path d="M100 25 C104 11 119 8 124 12 C122 24 111 29 100 25 Z" fill="${P.greenDeep}" ${OUT3}/>`;
    const left = `<path d="M100 25 C96 11 81 8 76 12 C78 24 89 29 100 25 Z" fill="${P.greenDeep}" ${OUT3}/>`;
    return `<g class="hm-sprout"><path d="M100 38 V25" ${OUT.replace('stroke-width="4"', 'stroke-width="3.5"')} fill="none"/>${right}${stage >= 3 ? left : ""}</g>`;
  };

  // ---------- outfits: each fits the body outline; head, face and neck never share a slot ----------

  const OUTFIT_ART = {
    hat: () =>
      `<path d="M54 61 C54 31 78 18 100 18 C122 18 146 31 146 61 Z" fill="${P.pink}" ${OUT}/>` +
      `<rect x="48" y="52" width="104" height="15" rx="7.5" fill="${P.butter}" ${OUT}/>` +
      `<circle cx="100" cy="16" r="8.5" fill="${P.butter}" ${OUT}/>` +
      `<path d="M76 40 Q80 31 88 28 M112 28 Q120 31 124 40" ${LINE(2.6).replace(P.ink, P.white)} opacity="0.7"/>`,
    "flower-crown": () =>
      `<path d="M58 62 C70 24 130 24 142 62" fill="none" stroke="${P.greenDeep}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M58 62 C70 24 130 24 142 62" fill="none" stroke="${P.brown}" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="1 5" opacity="0.6"/>` +
      flower(61, 58, 8, P.butter, P.pink) + flower(77, 41, 8.5, P.pink, P.butter) + flower(100, 34, 10, P.white, P.pink) +
      flower(123, 41, 8.5, P.butter, P.pinkDeep) + flower(139, 58, 8, P.pink, P.butter),
    party: () =>
      `<path d="M76 43 L100 3 L124 43 Q100 52 76 43 Z" fill="${P.pink}" ${OUT}/>` +
      `<circle cx="100" cy="3" r="5.5" fill="${P.butter}" ${OUT3}/>` +
      `<circle cx="92" cy="30" r="3.4" fill="${P.butter}"/><circle cx="106" cy="22" r="3.4" fill="${P.butter}"/><circle cx="110" cy="38" r="3.4" fill="${P.butter}"/>` +
      `<g class="hm-confetti">` +
      `<rect x="40" y="38" width="8" height="4" rx="1.5" fill="${P.pinkDeep}" transform="rotate(-25 44 40)"/>` +
      `<rect x="150" y="30" width="8" height="4" rx="1.5" fill="${P.butter}" stroke="${P.brown}" stroke-width="1.2" transform="rotate(30 154 32)"/>` +
      `<rect x="156" y="56" width="8" height="4" rx="1.5" fill="${P.green}" stroke="${P.brown}" stroke-width="1.2" transform="rotate(-40 160 58)"/>` +
      `<rect x="34" y="62" width="8" height="4" rx="1.5" fill="${P.butter}" stroke="${P.brown}" stroke-width="1.2" transform="rotate(50 38 64)"/></g>`,
    anniversary: () =>
      `<path d="M70 48 L68 22 L85 36 L100 16 L115 36 L132 22 L130 48 Q100 56 70 48 Z" fill="${P.butter}" ${OUT}/>` +
      `<circle cx="68" cy="21" r="4" fill="${P.pinkDeep}" ${OUT3.replace('stroke-width="3"', 'stroke-width="2"')}/>` +
      `<circle cx="100" cy="15" r="4.6" fill="${P.pinkDeep}" ${OUT3.replace('stroke-width="3"', 'stroke-width="2"')}/>` +
      `<circle cx="132" cy="21" r="4" fill="${P.pinkDeep}" ${OUT3.replace('stroke-width="3"', 'stroke-width="2"')}/>` +
      `<path d="M78 46 Q100 52 122 46" fill="none" stroke="${P.pink}" stroke-width="3" stroke-linecap="round"/>`,
    glasses: () =>
      `<circle cx="74" cy="100" r="16" fill="${P.white}" fill-opacity="0.28" stroke="${P.brown}" stroke-width="3.6"/>` +
      `<circle cx="126" cy="100" r="16" fill="${P.white}" fill-opacity="0.28" stroke="${P.brown}" stroke-width="3.6"/>` +
      `<path d="M90 98 Q100 92 110 98" fill="none" stroke="${P.brown}" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M58 96 L48 92 M142 96 L152 92" fill="none" stroke="${P.brown}" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M63 92 Q67 88 72 87" fill="none" stroke="${P.white}" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>`,
    scarf: () =>
      `<path d="M126 150 L144 150 L148 174 L127 176 Z" fill="${P.pink}" ${OUT}/>` +
      `<path d="M128 163 L146 162" ${LINE(3).replace(P.ink, P.butter)}/>` +
      `<path d="M42 138 Q100 154 158 138 L156 153 Q100 169 44 153 Z" fill="${P.pink}" ${OUT}/>` +
      `<path d="M50 146 Q100 162 150 146" fill="none" stroke="${P.butter}" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 6"/>`,
    bow: () =>
      `<path d="M100 148 C82 130 66 138 68 150 C70 163 86 162 100 148 Z" fill="${P.pink}" ${OUT}/>` +
      `<path d="M100 148 C118 130 134 138 132 150 C130 163 114 162 100 148 Z" fill="${P.pink}" ${OUT}/>` +
      `<path d="M78 146 Q84 143 90 147 M122 146 Q116 143 110 147" fill="none" stroke="${P.white}" stroke-width="2.2" stroke-linecap="round" opacity="0.75"/>` +
      `<circle cx="100" cy="148" r="6.5" fill="${P.butter}" ${OUT3}/>`,
  };

  // ---------- reaction effects: always in the markup, invisible (opacity 0) until mascot.css plays them ----------

  const FX = () =>
    `<g class="hm-fx hm-fx-feed" opacity="0"><g transform="translate(100 18)"><circle r="8" fill="${P.pinkDeep}" ${OUT3}/><path d="M0 -8 Q6 -15 11 -11 Q6 -6 0 -8 Z" fill="${P.greenDeep}" stroke="${P.brown}" stroke-width="2"/></g></g>` +
    `<g class="hm-fx hm-fx-water" opacity="0">${droplet(66, 14, 0.9)}${droplet(100, 6, 1)}${droplet(134, 14, 0.9)}</g>` +
    `<g class="hm-fx hm-fx-pet" opacity="0"><g class="hm-fx-pet1">${heart(60, 44, 1, P.pink)}</g><g class="hm-fx-pet2">${heart(100, 30, 1.25, P.pinkDeep)}</g><g class="hm-fx-pet3">${heart(142, 44, 1, P.pink)}</g></g>` +
    `<g class="hm-fx hm-fx-tap" opacity="0">${heart(100, 22, 2, P.pinkDeep)}</g>`;

  // ---------- assemble ----------

  /** The blob as the markup inside an <svg viewBox="0 0 200 200">. */
  function mascotInner(n) {
    const body = [];
    const headOutfit = n.outfit.find((id) => OUTFIT_SLOT[id] === "head");
    if (!headOutfit) body.push(sprout(n.stage)); // a hat or crown would sit on the sprout, so it steps aside
    body.push(
      `<ellipse cx="74" cy="166" rx="15" ry="8.5" fill="${P.green}" ${OUT}/><ellipse cx="126" cy="166" rx="15" ry="8.5" fill="${P.green}" ${OUT}/>`,
      `<path d="${BODY_D}" fill="${P.green}" ${OUT}/>`,
      `<path d="M44 128 Q40 150 64 160" fill="none" stroke="${P.greenDeep}" stroke-width="7" stroke-linecap="round" opacity="0.55"/>`,
      `<ellipse cx="100" cy="134" rx="38" ry="25" fill="${P.butter}"/>`,
      `<ellipse cx="66" cy="62" rx="15" ry="8" fill="${P.white}" opacity="0.6" transform="rotate(-32 66 62)"/>`,
      `<g class="hm-face">${FACES[n.mood]()}</g>`,
    );
    for (const slotOrder of ["neck", "face", "head"]) {
      const id = n.outfit.find((o) => OUTFIT_SLOT[o] === slotOrder);
      if (id) body.push(`<g class="hm-outfit hm-outfit-${id}">${OUTFIT_ART[id]()}</g>`);
    }
    const scale = STAGE_SCALE[n.stage - 1];
    const stage = `translate(100 168) scale(${scale}) translate(-100 -168)`;
    const floaters = FLOATERS[n.mood] ? `<g class="hm-floaters">${FLOATERS[n.mood]()}</g>` : "";
    return (n.stage >= 5 ? `<circle class="hm-glow" cx="100" cy="106" r="94" fill="${P.butter}" opacity="0.5"/>` : "") +
      (n.stage >= 4 ? star(22, 66, 1, "", 0) + star(178, 128, 0.8, "", 1) + star(30, 148, 0.65, "", 2) : "") +
      `<g transform="${stage}">` +
        `<ellipse class="hm-shadow" cx="100" cy="172" rx="58" ry="8" fill="${P.brown}" opacity="0.16"/>` +
        `<g class="hm-bounce"><g class="hm-react"><g class="hm-breathe">${body.join("")}</g></g>${floaters}${FX()}</g>` +
      `</g>`;
  }

  const rootClass = (n) =>
    `hm hm-mood-${n.mood} hm-stage-${n.stage}` + n.outfit.map((o) => " hm-wears-" + o).join("") + (n.reaction ? " hm-react-" + n.reaction : "");

  const labelOf = (n) => (n.title ? n.title + ", " : "") + "Hearth blob, " + n.mood + (n.outfit.length ? ", wearing " + n.outfit.join(" and ") : "");

  /** A complete <svg> string for one blob. `title` (e.g. the pet's name) only goes into the accessible label, escaped. */
  function renderSvg(opts) {
    const n = normalize(opts);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${rootClass(n)}" viewBox="0 0 200 200" role="img" aria-label="${esc(labelOf(n))}" ` +
      `data-mood="${n.mood}" data-stage="${n.stage}">${mascotInner(n)}</svg>`;
  }

  /** The Pet view backdrop: wall, a small hearth with a flickering fire, a floor and a rug, with the blob standing on the rug. */
  function renderScene(opts) {
    const n = normalize(opts);
    const brick = (x, y, w) => `<path d="M${x} ${y} h${w}" stroke="${P.brown}" stroke-width="1.4" opacity="0.35"/>`;
    const hearth =
      `<rect x="76" y="10" width="88" height="12" rx="6" fill="${P.butter}" ${OUT}/>` +
      `<path d="M82 22 H158 V132 H82 Z" fill="${P.brick}" ${OUT}/>` +
      brick(82, 40, 76) + brick(82, 58, 76) + brick(82, 76, 76) + brick(82, 94, 76) + brick(82, 112, 76) +
      `<path d="M98 132 V76 Q98 48 120 48 Q142 48 142 76 V132 Z" fill="${P.hole}" ${OUT}/>` +
      `<g class="hm-fire"><path d="M120 128 C104 122 106 102 114 94 C114 102 118 104 120 98 C122 92 119 84 125 76 C128 86 138 94 136 108 C135 120 130 126 120 128 Z" fill="${P.pink}" stroke="${P.brown}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="M120 128 C112 124 114 112 120 107 C122 112 127 114 127 119 C127 124 124 127 120 128 Z" fill="${P.butter}"/></g>`;
    const rug =
      `<ellipse cx="120" cy="196" rx="84" ry="17" fill="${P.pink}" ${OUT}/>` +
      `<ellipse cx="120" cy="196" rx="64" ry="11" fill="none" stroke="${P.butter}" stroke-width="3" stroke-dasharray="8 7" stroke-linecap="round"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="hm-scene" viewBox="0 0 240 240" role="img" aria-label="${esc(labelOf(n))}, by the hearth" data-mood="${n.mood}" data-stage="${n.stage}">` +
      `<rect x="-400" y="-400" width="1040" height="540" fill="${P.wall}"/>` +
      `<rect x="-400" y="140" width="1040" height="500" fill="${P.floor}"/>` +
      `<path d="M-400 140 H640" stroke="${P.brown}" stroke-width="3" opacity="0.25"/>` +
      hearth + rug +
      `<svg x="68" y="112" width="104" height="104" viewBox="0 0 200 200" class="${rootClass(n)}" data-mood="${n.mood}" data-stage="${n.stage}">${mascotInner(n)}</svg>` +
      `</svg>`;
  }

  /** A 64x64 light-grey silhouette of the blob for a group-tab icon (render it to icon.png, grey on transparent). */
  function iconSvg() {
    const hole = (cx) => `M${cx - 7} 100 a7 9 0 1 0 14 0 a7 9 0 1 0 -14 0 Z`;
    const d = BODY_D + " " + hole(74) + " " + hole(126) + " M88 111 Q100 130 112 111 Q100 120 88 111 Z";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
      `<g transform="translate(-9.1 -8) scale(0.41)"><path d="${d}" fill="#D4D4D4" fill-rule="evenodd"/>` +
      `<ellipse cx="74" cy="168" rx="15" ry="7" fill="#D4D4D4"/><ellipse cx="126" cy="168" rx="15" ry="7" fill="#D4D4D4"/></g></svg>`;
  }

  // ---------- optional DOM helper ----------

  const motionOff = () => typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "off";

  /**
   * Draws the blob into `el` and returns { update(opts), react(name), destroy() }. `update` merges into the current
   * options and redraws only when something visible changed (so the idle animations are not restarted by every
   * poll). `react` plays a one-shot reaction ("feed", "water", "pet", "tap"); it is a no-op with data-motion="off".
   */
  function mount(el, opts, config) {
    const scene = !!(config && config.scene);
    let state = normalize(opts);
    let key = "";
    let timer = 0;
    const draw = () => {
      const k = JSON.stringify([state.mood, state.outfit, state.stage, state.title]);
      if (k === key) return;
      key = k;
      el.innerHTML = scene ? renderScene(state) : renderSvg(state);
    };
    const svgEl = () => el.querySelector("svg.hm, svg.hm-scene svg.hm") || el.querySelector("svg");
    draw();
    return {
      update(next) { state = normalize(Object.assign({}, state, next, { reaction: null })); draw(); },
      react(name) {
        if (!REACTIONS.includes(name) || motionOff()) return;
        const svg = svgEl();
        if (!svg) return;
        REACTIONS.forEach((r) => svg.classList.remove("hm-react-" + r));
        void svg.getBoundingClientRect(); // restart the animation if the same reaction is played twice
        svg.classList.add("hm-react-" + name);
        clearTimeout(timer);
        timer = setTimeout(() => svg.classList.remove("hm-react-" + name), REACTION_MS);
      },
      destroy() { clearTimeout(timer); el.innerHTML = ""; },
    };
  }

  const api = {
    PALETTE, MOODS, REACTIONS, SLOTS, OUTFITS, OUTFIT_SLOT, CELEBRATION_OUTFITS, STAGE_COUNT, STAGE_FROM_LEVEL, REACTION_MS,
    stageForLevel, normalizeOutfit, normalize, moodFor, milestoneOutfit,
    renderSvg, renderScene, iconSvg, mount,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthMascot = api;
})(typeof window !== "undefined" ? window : globalThis);
