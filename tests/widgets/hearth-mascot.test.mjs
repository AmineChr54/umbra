import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const H = require("../../tools/hearth-mascot/mascot.js");
const css = readFileSync(new URL("../../tools/hearth-mascot/mascot.css", import.meta.url), "utf8");

/** A small strict XML well-formedness check (no DTD, no PIs): one root, balanced tags, quoted unique attributes, known entities. */
function checkXml(xml) {
  const stack = [];
  let roots = 0, pos = 0;
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
  while (pos < xml.length) {
    if (xml[pos] === "<") {
      tag.lastIndex = pos;
      const m = tag.exec(xml);
      if (!m) throw new Error("bad tag at " + pos + ": " + xml.slice(pos, pos + 60));
      const [all, close, name, attrs, selfClose] = m;
      if (close) {
        if (stack.pop() !== name) throw new Error("unbalanced </" + name + "> at " + pos);
      } else {
        if (!stack.length) roots++;
        const seen = new Set();
        for (const a of attrs.matchAll(/([\w:-]+)="/g)) { if (seen.has(a[1])) throw new Error("duplicate attribute " + a[1]); seen.add(a[1]); }
        if (!selfClose) stack.push(name);
      }
      if (!stack.length && !close && !selfClose) throw new Error("unreachable");
      pos += all.length;
    } else {
      const next = xml.indexOf("<", pos);
      const text = xml.slice(pos, next < 0 ? xml.length : next);
      if (/[<>]/.test(text)) throw new Error("raw < or > in text");
      for (const e of text.matchAll(/&([^;\s]*);?/g)) if (!/^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(e[1]) || !e[0].endsWith(";")) throw new Error("bad entity " + e[0]);
      pos = next < 0 ? xml.length : next;
    }
  }
  if (stack.length) throw new Error("unclosed <" + stack.at(-1) + ">");
  assert.equal(roots, 1, "exactly one root element");
  // attribute values must not contain a raw & either
  for (const v of xml.matchAll(/="([^"]*)"/g)) if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(v[1])) throw new Error("bad entity in attribute " + v[1]);
}

/** Rules the SVG must satisfy so it is safe to inject with innerHTML, to use as <img>, and to ship in a sandboxed widget. */
function checkSafe(svg) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<script|<style|<foreignObject|<image|<use|<a[\s>]|<iframe|<link|<animate|<set\b/i);
  assert.doesNotMatch(svg, /\son\w+\s*=/i, "no event handlers");
  assert.doesNotMatch(svg, /javascript:|data:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i, "no external references");
  assert.doesNotMatch(svg, /\b(?:xlink:)?href\s*=/i, "no links at all");
  assert.doesNotMatch(svg, /url\(/i, "no paint servers or external urls");
  assert.doesNotMatch(svg, /\sid="/, "no ids that could clash when several blobs share a page");
}

const allCombos = () => {
  const heads = [null, "hat", "flower-crown", "party", "anniversary"];
  const faces = [null, "glasses"];
  const necks = [null, "scarf", "bow"];
  return heads.flatMap((h) => faces.flatMap((f) => necks.map((n) => [h, f, n].filter(Boolean))));
};

// ---------- vocabulary ----------

test("the issue's seven moods exist, with at least 4 outfits (5 normal + 2 celebration)", () => {
  assert.deepEqual([...H.MOODS], ["happy", "content", "hungry", "thirsty", "sleepy", "sad", "love"]);
  assert.ok(H.OUTFITS.length >= 4);
  for (const id of H.CELEBRATION_OUTFITS) assert.ok(H.OUTFITS.includes(id));
  assert.deepEqual([...H.REACTIONS], ["feed", "water", "pet", "tap"]);
});

test("every outfit has a slot, and slots are head, face and neck", () => {
  for (const id of H.OUTFITS) assert.ok(H.SLOTS.includes(H.OUTFIT_SLOT[id]), id);
});

// ---------- selection ----------

test("normalize always returns a complete, valid option set", () => {
  for (const bad of [undefined, null, 5, "x", [], {}, { mood: "nope", outfit: 3, level: "abc", reaction: "x", title: 9 }]) {
    const n = H.normalize(bad);
    assert.ok(H.MOODS.includes(n.mood));
    assert.deepEqual(n.outfit, []);
    assert.equal(n.level, 1);
    assert.equal(n.stage, 1);
    assert.equal(n.reaction, null);
    assert.equal(n.title, "");
  }
  assert.equal(H.normalize({ mood: "sad" }).mood, "sad");
  assert.equal(H.normalize({ level: 7.9 }).level, 7);
  assert.equal(H.normalize({ level: 100000 }).level, 999);
  assert.equal(H.normalize({ level: -4 }).level, 1);
  assert.equal(H.normalize({ reaction: "feed" }).reaction, "feed");
  assert.equal(H.normalize({ title: "x".repeat(100) }).title.length, 40);
});

test("outfit selection: unknown ids dropped, one per slot (last wins), stable head-face-neck order", () => {
  assert.deepEqual(H.normalizeOutfit("hat"), ["hat"]);
  assert.deepEqual(H.normalizeOutfit(["scarf", "glasses", "hat"]), ["hat", "glasses", "scarf"]);
  assert.deepEqual(H.normalizeOutfit(["hat", "party", "scarf", "bow"]), ["party", "bow"]);
  assert.deepEqual(H.normalizeOutfit(["nope", 4, null, "__proto__", "toString", "glasses"]), ["glasses"]);
  assert.deepEqual(H.normalizeOutfit(null), []);
  assert.deepEqual(H.normalizeOutfit(""), []);
});

test("stages follow the level thresholds and never leave 1..5", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 9, 10, 14, 15, 500, NaN, "x"].map(H.stageForLevel), [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 1, 1]);
});

test("moodFor: tap shows love; the lowest state is sad; needs pick hungry or thirsty", () => {
  assert.equal(H.moodFor({ tapped: true, hunger: 0, thirst: 0, affection: 0 }), "love");
  assert.equal(H.moodFor({ hunger: 0, thirst: 0, affection: 0 }), "sad");
  assert.equal(H.moodFor({ hunger: 100, thirst: 100, affection: 10 }), "sad");
  assert.equal(H.moodFor({ hunger: 10, thirst: 80, affection: 80 }), "hungry");
  assert.equal(H.moodFor({ hunger: 80, thirst: 10, affection: 80 }), "thirsty");
  assert.equal(H.moodFor({ hunger: 10, thirst: 20, affection: 80 }), "hungry", "the lower need wins");
  assert.equal(H.moodFor({ hunger: 20, thirst: 10, affection: 80 }), "thirsty");
});

test("moodFor: sleepy when tired or at night, happy when cared for, content otherwise, never throws", () => {
  assert.equal(H.moodFor({ hunger: 80, thirst: 80, affection: 40 }), "sleepy");
  assert.equal(H.moodFor({ hunger: 90, thirst: 90, affection: 90, hour: 23 }), "sleepy");
  assert.equal(H.moodFor({ hunger: 90, thirst: 90, affection: 90, hour: 3 }), "sleepy");
  assert.equal(H.moodFor({ hunger: 90, thirst: 90, affection: 90, hour: 14 }), "happy");
  assert.equal(H.moodFor({ hunger: 50, thirst: 50, affection: 60, bonded: true, hour: 14 }), "happy");
  assert.equal(H.moodFor({ hunger: 50, thirst: 60, affection: 60, hour: 14 }), "content");
  assert.equal(H.moodFor({}), "content");
  for (const bad of [undefined, null, 3, "x", { hunger: "NaN", thirst: {}, affection: null }]) assert.ok(H.MOODS.includes(H.moodFor(bad)));
  assert.equal(H.moodFor({ hunger: -50, thirst: 200, affection: 80 }), "hungry", "out-of-range needs are clamped");
});

test("every mood can be produced by moodFor (the art for all of them is reachable)", () => {
  const seen = new Set([
    H.moodFor({ tapped: true }), H.moodFor({ affection: 0 }), H.moodFor({ hunger: 0 }), H.moodFor({ thirst: 0 }),
    H.moodFor({ affection: 40 }), H.moodFor({ hunger: 100, thirst: 100, affection: 100, hour: 12 }), H.moodFor({}),
  ]);
  assert.deepEqual([...seen].sort(), [...H.MOODS].sort());
});

test("milestoneOutfit: anniversaries and every 100 days unlock a celebration outfit", () => {
  assert.equal(H.milestoneOutfit(100), "party");
  assert.equal(H.milestoneOutfit(500), "party");
  assert.equal(H.milestoneOutfit(1000), "party");
  assert.equal(H.milestoneOutfit(365), "anniversary");
  assert.equal(H.milestoneOutfit(730), "anniversary");
  assert.equal(H.milestoneOutfit(99), null);
  assert.equal(H.milestoneOutfit(0), null);
  assert.equal(H.milestoneOutfit("x"), null);
  assert.ok(H.CELEBRATION_OUTFITS.includes(H.milestoneOutfit(365)) && H.CELEBRATION_OUTFITS.includes(H.milestoneOutfit(100)));
});

// ---------- svg ----------

test("every mood renders well-formed, safe SVG at every stage", () => {
  for (const mood of H.MOODS) for (const level of [1, 3, 6, 10, 15]) {
    const svg = H.renderSvg({ mood, level });
    checkXml(svg); checkSafe(svg);
    assert.match(svg, new RegExp(`class="hm hm-mood-${mood} hm-stage-`));
  }
});

test("every outfit renders alone and in every legal combination, on every mood", () => {
  for (const id of H.OUTFITS) { const svg = H.renderSvg({ outfit: id }); checkXml(svg); checkSafe(svg); assert.ok(svg.includes(`hm-outfit-${id}`)); }
  for (const combo of allCombos()) for (const mood of H.MOODS) {
    const svg = H.renderSvg({ mood, outfit: combo, level: 6 });
    checkXml(svg); checkSafe(svg);
    for (const id of combo) assert.ok(svg.includes(`hm-outfit-${id}"`), `${id} present`);
    assert.equal((svg.match(/class="hm-outfit /g) || []).length, combo.length, "no outfit drawn twice");
  }
});

test("outfits in the same slot never draw on top of each other", () => {
  const svg = H.renderSvg({ outfit: ["hat", "flower-crown", "party", "anniversary", "scarf", "bow"] });
  assert.equal((svg.match(/class="hm-outfit /g) || []).length, 2);
  assert.ok(svg.includes("hm-outfit-anniversary") && svg.includes("hm-outfit-bow"));
  assert.ok(!svg.includes("hm-outfit-hat") && !svg.includes("hm-outfit-scarf"));
});

test("the growth sprout steps aside for a head outfit", () => {
  assert.ok(H.renderSvg({ level: 6 }).includes("hm-sprout"));
  assert.ok(!H.renderSvg({ level: 1 }).includes("hm-sprout"));
  for (const head of ["hat", "flower-crown", "party", "anniversary"]) assert.ok(!H.renderSvg({ level: 15, outfit: head }).includes("hm-sprout"), head);
  assert.ok(H.renderSvg({ level: 15, outfit: ["glasses", "scarf"] }).includes("hm-sprout"));
});

test("moods differ visibly and outfits change the picture", () => {
  const faces = new Set(H.MOODS.map((mood) => H.renderSvg({ mood })));
  assert.equal(faces.size, H.MOODS.length);
  const outfits = new Set(H.OUTFITS.map((outfit) => H.renderSvg({ outfit })));
  assert.equal(outfits.size, H.OUTFITS.length);
  assert.notEqual(H.renderSvg({ level: 1 }), H.renderSvg({ level: 15 }));
  assert.equal(H.renderSvg({ level: 15 }), H.renderSvg({ level: 40 }), "same stage, same picture");
});

test("rendering is deterministic and small", () => {
  const o = { mood: "love", outfit: ["party", "glasses", "bow"], level: 15 };
  assert.equal(H.renderSvg(o), H.renderSvg(o));
  assert.ok(H.renderSvg(o).length < 12000, "one blob stays under 12 KB");
  assert.ok(H.renderScene(o).length < 20000);
  assert.ok(readFileSync(new URL("../../tools/hearth-mascot/mascot.js", import.meta.url)).length < 60000);
});

test("title only reaches the accessible label, escaped", () => {
  const evil = `Ember"><script>alert(1)</script>&'`;
  const svg = H.renderSvg({ mood: "happy", title: evil });
  checkXml(svg);
  assert.ok(!svg.includes("<script"));
  assert.match(svg, /aria-label="Ember&quot;&gt;&lt;script&gt;/);
  checkXml(H.renderScene({ title: evil }));
  assert.ok(H.renderSvg({ title: "Ember" }).includes('aria-label="Ember, Hearth blob, content'));
});

test("junk input renders the default mascot instead of throwing", () => {
  for (const bad of [undefined, null, 0, "x", { mood: "<b>", outfit: ["<script>"], level: {}, reaction: "boom" }]) {
    const svg = H.renderSvg(bad);
    checkXml(svg); checkSafe(svg);
    assert.match(svg, /hm-mood-content/);
  }
});

test("reactions are in the markup but invisible until the stylesheet plays them", () => {
  const svg = H.renderSvg({});
  for (const r of H.REACTIONS) assert.match(svg, new RegExp(`class="hm-fx hm-fx-${r}" opacity="0"`));
  assert.ok(!/hm-react-/.test(svg.split(">")[0]), "no reaction class by default");
  assert.ok(H.renderSvg({ reaction: "tap" }).startsWith('<svg xmlns="http://www.w3.org/2000/svg" class="hm hm-mood-content hm-stage-1 hm-react-tap'));
});

test("renderScene: well-formed, safe, with the blob inside", () => {
  for (const mood of H.MOODS) {
    const svg = H.renderScene({ mood, outfit: ["hat", "scarf"], level: 10 });
    checkXml(svg);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="hm-scene"/);
    assert.doesNotMatch(svg, /<script|<style|<image|href|url\(|\son\w+=/i);
    assert.ok(svg.includes(`hm-mood-${mood}`));
    assert.ok(svg.includes("hm-fire"));
  }
});

test("iconSvg is a 64x64 light grey silhouette", () => {
  const svg = H.iconSvg();
  checkXml(svg);
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /#D4D4D4/);
  assert.doesNotMatch(svg, /#6B4F3A|stroke/i);
});

test("the palette has the four Meadow colours of the issue", () => {
  assert.equal(H.PALETTE.green, "#DDF0C8");
  assert.equal(H.PALETTE.butter, "#FFF3B0");
  assert.equal(H.PALETTE.pink, "#F7A8C4");
  assert.equal(H.PALETTE.brown, "#6B4F3A");
});

// ---------- css ----------

test("every animation scales with --motion-scale and stops with data-motion off", () => {
  const animations = [...css.matchAll(/animation(?:-duration)?:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => !/^\s*none\b/.test(v));
  assert.ok(animations.length > 15);
  for (const a of animations) assert.match(a, /var\(--motion-scale, 1\)/, a);
  assert.match(css, /html\[data-motion="off"\] \.hm \*/);
  assert.match(css, /html\[data-motion="off"\] \.hm-scene \*/);
  assert.match(css, /animation: none !important/);
  // reaction effects stay hidden without animation: they are opacity 0 in the markup and only the animation shows them
  assert.ok(!/\.hm-fx[^{]*\{[^}]*opacity:\s*1/.test(css));
});

test("every keyframe the stylesheet uses is defined, and every defined one is used", () => {
  const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== "none"));
  for (const u of used) assert.ok(defined.has(u), "undefined keyframes " + u);
  for (const d of defined) assert.ok(used.has(d), "unused keyframes " + d);
});

test("the stylesheet has no text smaller than 11px and no external urls", () => {
  for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 11, m[0]);
  assert.doesNotMatch(css, /url\(|@import/);
});

// ---------- mount (fake DOM) ----------

function fakeEl() {
  const classes = new Set();
  const svg = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) }, getBoundingClientRect() {} };
  return { svg, classes, innerHTML: "", querySelector() { return this.innerHTML ? svg : null; } };
}

test("mount draws once, redraws only on visible changes, and react() is a no-op with motion off", () => {
  const prev = globalThis.document;
  let motion = "on";
  globalThis.document = { documentElement: { getAttribute: () => motion } };
  try {
    const el = fakeEl();
    const m = H.mount(el, { mood: "happy", level: 5 });
    const first = el.innerHTML;
    assert.match(first, /hm-mood-happy/);
    m.update({ level: 5 });
    el.innerHTML = first + " "; // would be overwritten by a redraw
    m.update({ level: 5, mood: "happy" });
    assert.equal(el.innerHTML, first + " ", "no redraw when nothing changed");
    m.update({ mood: "sad" });
    assert.match(el.innerHTML, /hm-mood-sad/);
    assert.match(el.innerHTML, /hm-stage-2/, "update merges into the previous options");
    m.react("feed");
    assert.ok(el.classes.has("hm-react-feed"));
    m.react("nope");
    assert.ok(!el.classes.has("hm-react-nope"));
    m.react("pet");
    assert.ok(!el.classes.has("hm-react-feed") && el.classes.has("hm-react-pet"));
    m.destroy();
    assert.equal(el.innerHTML, "");
    motion = "off";
    const el2 = fakeEl();
    const m2 = H.mount(el2, {});
    m2.react("tap");
    assert.equal(el2.classes.size, 0, "reduced motion: no reaction");
    m2.destroy();
    const el3 = fakeEl();
    H.mount(el3, { mood: "love" }, { scene: true });
    assert.match(el3.innerHTML, /class="hm-scene"/);
  } finally {
    if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
  }
});
