// Hearth pet world: the pure part (no DOM, no network, no timers). tests/widgets/hearth-world.test.mjs checks the catalog
// against the relay's (tools/umbra-relay/hearth.js SHOP, QUESTS, GAMES, STICKERS), so prices shown here are the prices paid.
// Browser: window.HearthWorldLogic. Node: module.exports.
//
// The relay owns everything shared (Embers, what you own, the room, the outfit, quests, stickers, gifts, the diary). What
// only this PC decides lives here too: the time of day and season in the window, holidays, when the pet sleeps, tricks.
(function (root) {
  "use strict";

  // ---------- the catalog (mirrors the relay's SHOP) ----------

  const C = (cat, price, label, extra) => Object.freeze(Object.assign({ cat, price, label }, extra || {}));
  const CATALOG = Object.freeze({
    berry_tart: C("treat", 8, "Berry tart", { gain: { food: 30, love: 8 }, note: "Food +30, love +8" }),
    honey_cake: C("treat", 12, "Honey cake", { gain: { food: 45, love: 12 }, note: "Food +45, love +12" }),
    fish_snack: C("treat", 10, "Fish snack", { gain: { food: 50 }, note: "Food +50" }),
    smoothie: C("treat", 7, "Smoothie", { gain: { water: 45 }, note: "Water +45" }),
    cocoa: C("treat", 9, "Cocoa", { gain: { water: 35, love: 15 }, note: "Water +35, love +15" }),
    star_candy: C("treat", 15, "Star candy", { gain: { food: 20, water: 20, love: 20 }, note: "Everything +20" }),
    bubble_soap: C("treat", 10, "Bubble soap", { gain: { clean: 50, love: 5 }, note: "Clean +50, love +5" }),
    ball: C("toy", 25, "Ball", { spot: "toy" }),
    yarn: C("toy", 30, "Yarn", { spot: "toy" }),
    duck: C("toy", 35, "Rubber duck", { spot: "toy" }),
    kite: C("toy", 45, "Kite", { spot: "toy" }),
    plant: C("decor", 40, "Plant", { spot: "floorL" }),
    cactus: C("decor", 35, "Cactus", { spot: "floorL" }),
    lamp: C("decor", 50, "Lamp", { spot: "floorR", note: "Lights up the room at night" }),
    bookshelf: C("decor", 70, "Bookshelf", { spot: "floorR" }),
    painting: C("decor", 45, "Painting", { spot: "wall" }),
    clock: C("decor", 40, "Clock", { spot: "wall", note: "Shows your time" }),
    photo: C("decor", 30, "Photo of you two", { spot: "wall" }),
    lights: C("decor", 35, "Fairy lights", { spot: "mantel" }),
    candles: C("decor", 25, "Candles", { spot: "mantel" }),
    curtains_rose: C("decor", 30, "Rose curtains", { spot: "window" }),
    curtains_sage: C("decor", 30, "Sage curtains", { spot: "window" }),
    rug_sky: C("decor", 30, "Sky rug", { spot: "rug" }),
    rug_sage: C("decor", 30, "Sage rug", { spot: "rug" }),
    rug_gold: C("decor", 40, "Gold rug", { spot: "rug" }),
    wall_mint: C("decor", 35, "Mint wallpaper", { spot: "wallpaper" }),
    wall_sky: C("decor", 35, "Sky wallpaper", { spot: "wallpaper" }),
    wall_rose: C("decor", 35, "Rose wallpaper", { spot: "wallpaper" }),
    wall_night: C("decor", 50, "Starry wallpaper", { spot: "wallpaper" }),
    garden: C("place", 80, "Garden", { spot: "place", note: "Sunflowers, a fence and a big sky" }),
    beach: C("place", 100, "Beach", { spot: "place", note: "Sand, waves and a sunny umbrella" }),
    snowy: C("place", 100, "Snowy cabin", { spot: "place", note: "A log cabin with snow outside" }),
    starry: C("place", 120, "Starry hill", { spot: "place", note: "A hill under the moon and stars" }),
    cafe: C("place", 120, "Cozy cafe", { spot: "place", note: "Pastries, plants and a chalkboard" }),
    treehouse: C("place", 150, "Treehouse", { spot: "place", note: "Up in the leaves with the birds" }),
    tophat: C("outfit", 60, "Top hat", { slot: "head" }),
    beanie: C("outfit", 45, "Beanie", { slot: "head" }),
    headphones: C("outfit", 70, "Headphones", { slot: "head" }),
    star_clips: C("outfit", 40, "Star clips", { slot: "head" }),
    shades: C("outfit", 55, "Shades", { slot: "face" }),
    monocle: C("outfit", 50, "Monocle", { slot: "face" }),
    cape: C("outfit", 80, "Cape", { slot: "neck" }),
    bell: C("outfit", 35, "Bell collar", { slot: "neck" }),
  });
  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "treat", label: "Treats" }), Object.freeze({ id: "toy", label: "Toys" }),
    Object.freeze({ id: "decor", label: "Decor" }), Object.freeze({ id: "outfit", label: "Outfits" }),
    Object.freeze({ id: "place", label: "Places" }),
  ]);
  const SPOTS = Object.freeze([
    Object.freeze({ id: "place", label: "Place" }),
    Object.freeze({ id: "wallpaper", label: "Wallpaper" }), Object.freeze({ id: "rug", label: "Rug" }),
    Object.freeze({ id: "window", label: "Window" }), Object.freeze({ id: "wall", label: "Wall" }),
    Object.freeze({ id: "mantel", label: "Mantel" }), Object.freeze({ id: "floorL", label: "Left corner" }),
    Object.freeze({ id: "floorR", label: "Right corner" }), Object.freeze({ id: "toy", label: "Toy on the rug" }),
  ]);
  const itemsFor = (cat) => Object.keys(CATALOG).filter((id) => CATALOG[id].cat === cat);
  const itemsForSpot = (spot) => Object.keys(CATALOG).filter((id) => CATALOG[id].spot === spot);
  const label = (id) => (CATALOG[id] ? CATALOG[id].label : String(id || ""));

  // ---------- games, quests, stickers (mirror the relay) ----------

  const GAMES = Object.freeze({
    catch: Object.freeze({ max: 150, per: 0.2, cap: 20, label: "Berry Catch", unit: "points", how: "Move the bowl to catch berries. Golden ones count 3, catch in a row for a combo, acorns cost a heart." }),
    memory: Object.freeze({ max: 40, per: 2, cap: 20, label: "Flame Memory", unit: "rounds", how: "Watch the flames light up, then press them in the same order. One more each round." }),
    seek: Object.freeze({ max: 15, per: 2, cap: 20, label: "Hide and Seek", unit: "found", how: "Watch the cup the blob hides under while they shuffle, then pick it. Faster each round." }),
    bubbles: Object.freeze({ v21: true, max: 150, per: 0.2, cap: 20, label: "Bubble Bath", unit: "bubbles", how: "Pop the soap bubbles before they float away. A pop bursts the bubbles touching it." }),
    hop: Object.freeze({ v21: true, max: 60, per: 0.5, cap: 20, label: "Star Hop", unit: "stars", how: "Click or press Space to hop from cloud to cloud and grab the stars. Don't fall!" }),
  });
  const GAME_IDS = Object.freeze(["catch", "memory", "seek", "bubbles", "hop"]);
  /** What a score would pay (before the relay's daily cap). */
  const gameCoins = (game, score) => (GAMES[game] ? Math.min(GAMES[game].cap, Math.floor(Math.min(score, GAMES[game].max) * GAMES[game].per)) : 0);

  /** Daily quests (the relay draws one easy, one medium and one hard a day): a title, what to do, a badge glyph. */
  const Q = (tier, n, reward, xp, title, glyph, text) => Object.freeze({ tier, n, reward, xp, title, glyph, text });
  const QUESTS = Object.freeze({
    feed2: Q(1, 2, 15, 5, "Snack attack", "berry", (p) => `Feed ${p} twice`),
    water2: Q(1, 2, 15, 5, "Stay hydrated", "drop", (p) => `Give ${p} water twice`),
    pet3: Q(1, 3, 15, 5, "Cuddle time", "heart", (p) => `Pet ${p} 3 times`),
    shower1: Q(1, 1, 15, 5, "Splish splash", "bubble", (p) => `Give ${p} a shower`),
    play1: Q(1, 1, 15, 5, "Game on", "play", () => "Play any game"),
    buy1: Q(1, 1, 15, 5, "Window shopping", "coin", () => "Buy something in the shop"),
    treat1: Q(1, 1, 20, 5, "Sweet tooth", "cake", (p) => `Give ${p} a treat`),
    care6: Q(2, 6, 20, 8, "Busy paws", "paw", () => "Care 6 times between you"),
    play3: Q(2, 3, 25, 8, "Arcade night", "play", () => "Play 3 games"),
    shower2: Q(2, 2, 25, 8, "Spa day", "bubble", (p) => `Shower ${p} twice`),
    place1: Q(2, 1, 20, 8, "Interior designer", "house", () => "Put something in the room"),
    catch20: Q(2, 1, 25, 8, "Berry picker", "berry", () => "Score 20 in Berry Catch"),
    memory6: Q(2, 1, 25, 8, "Sharp mind", "flame", () => "Reach round 6 in Flame Memory"),
    seek3: Q(2, 1, 25, 8, "Seeker", "eye", (p) => `Find ${p} 3 times in Hide and Seek`),
    bubbles30: Q(2, 1, 25, 8, "Bubble master", "bubble", () => "Pop 30 bubbles in Bubble Bath"),
    hop10: Q(2, 1, 25, 8, "Star hopper", "star", () => "Grab 10 stars in Star Hop"),
    both: Q(3, 1, 30, 12, "Together", "heart", (p) => `Both of you care for ${p} today`),
    team: Q(3, 1, 35, 12, "Team play", "team", () => "Both of you play a game today"),
    record: Q(3, 1, 35, 12, "New record", "trophy", () => "Beat your best score in any game"),
    full: Q(3, 1, 35, 15, "All topped up", "sparkle", () => "Get every bar to 80 at the same time"),
    gift1: Q(3, 1, 30, 12, "Surprise!", "gift", () => "Wrap a gift for your partner"),
    care10: Q(3, 10, 35, 12, "Devoted", "heart", () => "Care 10 times between you"),
  });
  const TIER_LABELS = Object.freeze(["", "Easy", "Medium", "Hard"]);
  const questText = (id, petName) => (QUESTS[id] ? QUESTS[id].text(petName || "the blob") : "");
  /** The weekly quest (one per ISO week, Monday UTC): title, what to do, badge. */
  const W = (n, title, glyph, text) => Object.freeze({ n, title, glyph, text });
  const WEEKLY = Object.freeze({
    bond5: W(5, "Inseparable", "heart", () => "Fill the bond on 5 days this week"),
    games15: W(15, "Game week", "play", () => "Play 15 games this week"),
    shower4: W(4, "Squeaky clean", "bubble", (p) => `Shower ${p} 4 times this week`),
    quests9: W(9, "Quest hunter", "flag", () => "Finish 9 daily quests this week"),
    care25: W(25, "Caretakers", "paw", () => "Care 25 times this week"),
    treats5: W(5, "Treat week", "cake", (p) => `Give ${p} 5 treats this week`),
  });
  const weeklyText = (id, petName) => (WEEKLY[id] ? WEEKLY[id].text(petName || "the blob") : "");

  /** Stickers, in album order: label, how to earn it, and a badge (colour + glyph) for the art. */
  const S = (label, how, color, glyph) => Object.freeze({ label, how, color, glyph });
  const STICKERS = Object.freeze({
    first_game: S("First game", "Play any game", "#BFE6F5", "play"),
    first_treat: S("Treat time", "Give a treat", "#F7A8C4", "cake"),
    first_buy: S("First buy", "Buy something in the shop", "#FFF3B0", "coin"),
    first_gift: S("Gift giver", "Open a gift from your partner", "#F7A8C4", "gift"),
    first_quest: S("Quest done", "Claim a daily quest", "#DDF0C8", "flag"),
    decorated: S("Home sweet home", "Fill 4 spots in the room", "#FFF3B0", "house"),
    fashion: S("Fashionista", "Own 3 outfits from the shop", "#F7A8C4", "hat"),
    streak7: S("One week", "A 7 day bond streak", "#DDF0C8", "flame"),
    streak30: S("One month", "A 30 day bond streak", "#F7A8C4", "flame"),
    level10: S("Level 10", "Reach level 10", "#BFE6F5", "star"),
    level25: S("Level 25", "Reach level 25", "#FFF3B0", "star"),
    level50: S("Level 50", "Reach the top level", "#F7A8C4", "crown"),
    quests10: S("Quester", "Claim 10 quests", "#DDF0C8", "flag"),
    games25: S("Gamer", "Play 25 games", "#BFE6F5", "play"),
    catch40: S("Berry master", "Catch 40 berries in one game", "#F7A8C4", "berry"),
    memory10: S("Elephant memory", "Reach round 10 in Flame Memory", "#FFF3B0", "flame"),
    seek8: S("Eagle eye", "Find the blob 8 times in one game", "#DDF0C8", "eye"),
    rich: S("Saver", "Have 300 Embers at once", "#FFF3B0", "coin"),
    collector: S("Collector", "Own 15 things", "#BFE6F5", "box"),
    birthday: S("Birthday party", "Care for the blob on its birthday", "#F7A8C4", "cake"),
    first_shower: S("Squeaky clean", "Give the blob a shower", "#BFE6F5", "bubble"),
    quests50: S("Quest legend", "Claim 50 quests", "#FFF3B0", "trophy"),
    weekly1: S("Good week", "Finish a weekly quest", "#DDF0C8", "chest"),
    weekly10: S("Ten good weeks", "Finish 10 weekly quests", "#F7A8C4", "chest"),
    globetrotter: S("Globetrotter", "Own 3 places", "#BFE6F5", "house"),
  });
  const STICKER_IDS = Object.freeze(Object.keys(STICKERS));

  /** Tricks the pet knows from a level on (cosmetic; this PC only). */
  const TRICKS = Object.freeze([
    Object.freeze({ id: "sit", label: "Sit", level: 2 }), Object.freeze({ id: "wave", label: "Wave", level: 4 }),
    Object.freeze({ id: "spin", label: "Spin", level: 6 }), Object.freeze({ id: "jump", label: "Big jump", level: 9 }),
    Object.freeze({ id: "dance", label: "Dance", level: 13 }), Object.freeze({ id: "juggle", label: "Juggle", level: 18 }),
    Object.freeze({ id: "fireworks", label: "Fireworks", level: 25 }),
  ]);
  const tricksFor = (level) => TRICKS.map((t) => Object.assign({ unlocked: level >= t.level }, t));

  // ---------- time, seasons, holidays (local time of this PC) ----------

  /** night (21-5), dawn (5-7), day (7-17), dusk (17-21). */
  function skyPhase(hour) {
    const h = ((Number(hour) % 24) + 24) % 24;
    if (h >= 21 || h < 5) return "night";
    if (h < 7) return "dawn";
    if (h < 17) return "day";
    return "dusk";
  }
  /** The pet sleeps from 23:00 to 07:00 (clicking wakes it for a while). */
  const asleepAt = (hour) => hour >= 23 || hour < 7;
  /** Northern-hemisphere seasons by month (0 = January). */
  function season(month) {
    const m = ((Number(month) % 12) + 12) % 12;
    return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
  }
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  /**
   * The occasion of a local date, or "": the pet's birthday and your anniversary (both from the second year on) come
   * first, then New Year, the winter holidays, Valentine's Day and Halloween.
   * born: ms of the pet's hatching (relay `born`); since: "YYYY-MM-DD" from the Us tab.
   */
  function holiday(date, born, since) {
    const d = date instanceof Date ? date : new Date(date);
    const today = md(d);
    if (born) { const b = new Date(born); if (md(b) === today && b.getFullYear() < d.getFullYear()) return "birthday"; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(since || "") && since.slice(5) === today && Number(since.slice(0, 4)) < d.getFullYear()) return "anniversary";
    if (today === "12-31" || today === "01-01") return "newyear";
    if (today >= "12-20" && today <= "12-26") return "winterfest";
    if (today === "02-14") return "valentine";
    if (today >= "10-28" && today <= "10-31") return "halloween";
    return "";
  }
  const HOLIDAY_LINES = Object.freeze({
    birthday: (p) => `It's my birthday! Thank you for every day, I love you both.`,
    anniversary: () => "Happy anniversary, you two!",
    newyear: () => "Happy New Year! Another year together.",
    winterfest: () => "It's cozy by the fire. Happy holidays!",
    valentine: () => "Happy Valentine's Day! So much love in here.",
    halloween: () => "Boo! Did I scare you?",
  });

  // ---------- reading the relay's world ----------

  /** The world part of a relay pet, or null when the relay is older than the world (no `coins`). */
  function parseWorld(raw) {
    if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.coins))) return null;
    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    const inv = {};
    for (const [k, v] of Object.entries(obj(raw.inv))) if (CATALOG[k] && Number(v) > 0) inv[k] = Math.floor(Number(v));
    const room = {};
    for (const [k, v] of Object.entries(obj(raw.room))) if (SPOTS.some((s) => s.id === k) && CATALOG[v] && CATALOG[v].spot === k) room[k] = v;
    const quests = Array.isArray(raw.quests) ? raw.quests.filter((q) => q && QUESTS[q.id]).map((q) => ({
      id: q.id, n: Math.max(1, Number(q.n) || 1), p: Math.max(0, Number(q.p) || 0), reward: Number(q.reward) || 0, claimed: !!q.claimed,
      xp: Number(q.xp) || 2, tier: [1, 2, 3].includes(q.tier) ? q.tier : QUESTS[q.id].tier,
    })) : null;
    const b = obj(raw.questBonus);
    const questBonus = raw.questBonus ? { ready: !!b.ready, claimed: !!b.claimed, xp: Number(b.xp) || 0, reward: Number(b.reward) || 0 } : null;
    const wk = obj(raw.weekly);
    const weekly = raw.weekly && WEEKLY[wk.id] ? {
      id: wk.id, n: Math.max(1, Number(wk.n) || 1), p: Math.max(0, Number(wk.p) || 0), claimed: !!wk.claimed,
      endsAt: Number(wk.endsAt) || 0, xp: Number(wk.xp) || 0, reward: Number(wk.reward) || 0,
    } : null;
    const gift = raw.gift && CATALOG[raw.gift.item] && (raw.gift.from === "a" || raw.gift.from === "b") ? { from: raw.gift.from, item: raw.gift.item, t: Number(raw.gift.t) || 0 } : null;
    return {
      coins: Math.max(0, Math.floor(Number(raw.coins))),
      inv, room,
      wear: Array.isArray(raw.wear) ? raw.wear.filter((x) => typeof x === "string") : null,
      best: obj(raw.best),
      quests, questBonus, weekly,
      stickers: Array.isArray(raw.stickers) ? raw.stickers.filter((x) => STICKERS[x]) : [],
      gift,
      log: Array.isArray(raw.log) ? raw.log.filter((e) => Array.isArray(e) && e.length >= 3) : [],
      born: Number(raw.born) || 0,
      counts: obj(raw.counts),
    };
  }
  const owned = (w, id) => !!(w && w.inv[id] > 0);
  const ownedOutfits = (w) => (w ? Object.keys(w.inv).filter((id) => CATALOG[id] && CATALOG[id].cat === "outfit") : []);
  /** Quests that are done and not yet claimed (daily ones, then "bonus" for the chest and "week" for the weekly). */
  const claimable = (w) => {
    if (!w) return [];
    const out = w.quests ? w.quests.filter((q) => q.p >= q.n && !q.claimed) : [];
    if (w.questBonus && w.questBonus.ready && !w.questBonus.claimed) out.push({ id: "bonus" });
    if (w.weekly && w.weekly.p >= w.weekly.n && !w.weekly.claimed) out.push({ id: "week" });
    return out;
  };
  /** "2 days left" / "5 h left" until the weekly quest ends. */
  function timeLeft(endsAt, now) {
    const h = Math.max(0, (endsAt - now) / 3600000);
    if (h >= 48) return `${Math.floor(h / 24)} days left`;
    if (h >= 1) return `${Math.floor(h)} h left`;
    return "ends soon";
  }

  /** An error from a world call -> a sentence. */
  function worldProblem(r) {
    const e = r && r.error;
    if (e === "not enough embers") return `You need ${r.need || "more"} more Embers. Care for the blob, play games and finish quests to earn them.`;
    if (e === "already yours") return "You already have that.";
    if (e === "a gift is already waiting") return "A gift is already waiting to be opened.";
    if (e === "none left") return "None left. Buy more in the shop.";
    if (e === "too soon") return `Not yet: again in ${r.retryIn || 60} s.`;
    if (e === "not unlocked") return "That one isn't unlocked yet.";
    if (e === "not found" || e === "bad item" || e === "bad game" || e === "bad quest" || e === "bad spot") return "The relay doesn't know this yet. It needs an update.";
    if (e === "not done yet") return "Not done yet: keep going!";
    if (e === "already claimed") return "Already claimed.";
    return "The relay did not take that. Please try again in a moment.";
  }

  // ---------- the diary ----------

  function ago(t, now) {
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }
  /** One diary entry [t, side, kind, detail] as a sentence. */
  function diaryLine(e, me, names, petName) {
    const [, side, kind, detail] = e;
    const who = side === me ? "You" : (names && names.partner) || "Your partner";
    const pet = petName || "the blob";
    switch (kind) {
      case "feed": return `${who} fed ${pet}`;
      case "water": return `${who} gave ${pet} water`;
      case "pet": return `${who} petted ${pet}`;
      case "shower": return `${who} gave ${pet} a shower`;
      case "chest": return `${who} opened the daily chest`;
      case "week": return `${who} finished the weekly quest` + (detail ? `: ${label(detail)} for ${pet}!` : "");
      case "bond": return `You both cared today: ${detail} day streak`;
      case "buy": return `${who} bought ${label(detail)}`;
      case "gift": return `${who} wrapped a gift`;
      case "open": return `${who} opened a gift: ${label(detail)}`;
      case "use": return `${who} gave ${pet} ${label(detail).toLowerCase()}`;
      case "place": return detail ? `${who} put the ${label(detail).toLowerCase()} in the room` : `${who} moved things around`;
      case "play": { const [g, sc] = String(detail).split(":"); return `${who} played ${GAMES[g] ? GAMES[g].label : g}: ${sc}`; }
      case "quest": return `${who} finished "${questText(detail, pet)}"`;
      case "sticker": return `New sticker: ${STICKERS[detail] ? STICKERS[detail].label : detail}`;
      default: return `${who} visited ${pet}`;
    }
  }

  // ---------- games (pure parts) ----------

  /** A seeded random generator (mulberry32) so a game can be replayed in tests. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** Flame Memory: the colour sequence for `rounds` rounds (each round adds one). */
  const memorySequence = (rand, length) => Array.from({ length }, () => Math.floor(rand() * 4));
  /** Hide and Seek round r (1-based): how many swaps and how long each takes (ms). Faster and more each round. */
  const seekRound = (r) => ({ swaps: Math.min(12, 2 + r), ms: Math.max(180, 560 - r * 40) });
  /** Berry Catch: chance that a new falling thing is an acorn, rising over the 30 s. */
  const acornChance = (elapsedMs) => Math.min(0.35, 0.12 + elapsedMs / 30000 * 0.2);
  /** Berry Catch: points for a catch with `combo` catches in a row before it (x2 from 5, x3 from 10). */
  const catchPoints = (golden, combo) => (golden ? 3 : 1) * (combo >= 10 ? 3 : combo >= 5 ? 2 : 1);
  /** Bubble Bath: indexes of the bubbles a pop at `i` bursts (it and every bubble touching a burst one). */
  function bubbleChain(bubbles, i) {
    const out = new Set([i]);
    const queue = [i];
    while (queue.length) {
      const a = bubbles[queue.shift()];
      bubbles.forEach((b, j) => {
        if (out.has(j) || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d <= (a.r + b.r) * 1.02) { out.add(j); queue.push(j); }
      });
    }
    return [...out];
  }

  const api = {
    CATALOG, CATEGORIES, SPOTS, itemsFor, itemsForSpot, label,
    GAMES, GAME_IDS, gameCoins, QUESTS, TIER_LABELS, questText, WEEKLY, weeklyText, STICKERS, STICKER_IDS, TRICKS, tricksFor,
    skyPhase, asleepAt, season, holiday, HOLIDAY_LINES,
    parseWorld, owned, ownedOutfits, claimable, timeLeft, worldProblem, ago, diaryLine,
    rng, memorySequence, seekRound, acornChance, catchPoints, bubbleChain,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearthWorldLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
