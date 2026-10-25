// Hearth Pet view (#214). The relay owns the rules (see pet-logic.js); this file paints what it returns, sends the care and
// naming calls, and keeps the view alive between syncs.
//
// How it plugs into the shell (hearth.js): the shell draws `<section data-pet-root>` for the Pet view and calls
// `HearthPet.attach(thatElement, client)` after every render. The shell may throw the element away at any time, so every
// piece of state lives here (S), not in the DOM, and `attach` rebuilds the DOM from it. After the first attach this module
// follows the client by itself and only touches its own element (no shell re-render when the pet changes), so a name being
// typed is never lost to a sync.
//
//   optimistic UI: a click raises the stat at once (pet-logic `applyCare`, the README numbers) and starts the cooldown;
//   the answer of `care` replaces the guess with the relay's pet; a failure reverts it; every later sync is authoritative.
//   between syncs the stats are extrapolated with the relay's decayPerHour (the idle poll does not resend the pet).
(() => {
  "use strict";
  const L = window.HearthPetLogic;
  const M = window.HearthMascot;
  const core = window.HearthCore;
  const PREFS_KEY = "pet";          // umbra.store key of this copy: { outfit: [...], bubbles: { id: shownAt } }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HEART_ON = "♥", HEART_OFF = "♡";

  const S = {
    client: null, store: null, started: false,
    root: null, els: null, mount: null,
    view: null,
    base: null,                 // { pet, asOf (server ms), trusted }: the pet we extrapolate from
    quietUntil: 0,              // no "partner cared" or level-up guesses for a while after my own care (stale syncs may still arrive)
    lastSig: "",                // signature of the last relay pet we looked at
    cd: {},                     // action -> local ms when the button is ready again
    inflight: {},               // action -> true while a care call runs
    nameOverride: null,         // { value, until }: the name we just sent, shown until the sync agrees
    prefs: { outfit: [], bubbles: {} },
    prefsLoaded: false, saveTimer: 0,
    ui: { sheet: null, hatch: false, later: false, draft: "", err: "", busy: false, focus: false },
    bubble: null,               // { id, text, until, kind }
    flashUntil: 0,              // the "love" face after a pet
    timer: 0, lastIdleCheck: 0, openDone: false,
  };

  // ---------- small helpers ----------

  const connected = () => !!(S.root && S.root.isConnected);
  const serverNow = () => Date.now() + (S.view && S.view.sync && Number.isFinite(S.view.sync.skew) ? S.view.sync.skew : 0);
  const me = () => (S.view && S.view.me) || "a";
  const names = () => (S.view && S.view.names) || { you: "", partner: "" };
  const days = () => (S.view ? core.daysTogether(S.view.togetherSince) : null);

  /** Set a property only when it changed, so a one second tick does not rewrite the DOM. */
  function put(el, key, value) {
    if (!el) return;
    const k = "_" + key;
    if (el[k] === value) return;
    el[k] = value;
    if (key === "text") el.textContent = value;
    else if (key === "hidden") el.hidden = value;
    else if (key === "disabled") el.disabled = value;
    else if (key === "width") el.style.width = value;
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }

  function effectiveName() {
    const sync = (S.view && S.view.sync && S.view.sync.petName) || "";
    const o = S.nameOverride;
    if (o) {
      if (sync === o.value || Date.now() > o.until) S.nameOverride = null;
      else return o.value;
    }
    return sync;
  }

  function savePrefs() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(async () => {
      try { await S.store.set(PREFS_KEY, { outfit: S.prefs.outfit, bubbles: S.prefs.bubbles }); } catch (e) { /* not essential */ }
    }, 600);
  }
  async function loadPrefs() {
    try {
      const p = await S.store.get(PREFS_KEY, null);
      if (p && typeof p === "object") {
        S.prefs.outfit = Array.isArray(p.outfit) ? p.outfit.filter((x) => typeof x === "string").slice(0, 6) : [];
        const b = {};
        if (p.bubbles && typeof p.bubbles === "object") for (const [k, v] of Object.entries(p.bubbles).slice(0, 20)) if (Number.isFinite(v)) b[k] = v;
        S.prefs.bubbles = b;
      }
    } catch (e) { /* defaults */ }
    S.prefsLoaded = true;
    paint();
  }

  // ---------- bubbles and reactions ----------

  function showBubble(b, remember = true) {
    if (!b) return;
    S.bubble = { id: b.id, text: b.text, kind: b.kind || "", until: Date.now() + (b.ms || L.BUBBLE.showMs) };
    if (remember && b.kind !== "error") { S.prefs.bubbles[b.id] = Date.now(); savePrefs(); }
    paint();
    schedule();
  }
  const react = (name) => { if (S.mount && connected()) S.mount.react(name); };

  function bubbleCtx(extra) {
    const cur = S.base ? L.current(S.base, serverNow()) : null;
    return Object.assign({
      names: names(), me: me(), petName: effectiveName(), pet: cur,
      mood: cur ? L.displayMood(cur, { mascot: M }) : "content",
      bubbles: S.prefs.bubbles, now: Date.now(),
    }, extra);
  }
  function maybeAuto(trigger) {
    if (!S.base || !S.base.trusted || !connected() || S.ui.sheet || (S.view && S.view.offline) || S.bubble) return;
    showBubble(L.chooseBubble(bubbleCtx({ trigger })));
  }

  // ---------- following the relay ----------

  /** Look at the client's view: adopt a new relay pet unless one of my care calls is running (its answer comes first). */
  function absorb(v) {
    S.view = v;
    const pet = L.parsePet(v.sync && v.sync.pet);
    if (!pet) return;
    const sig = L.petSig(pet);
    if (sig === S.lastSig) return;
    if (Object.keys(S.inflight).length) return;
    S.lastSig = sig;
    const trusted = v.sync.rev > 0 && v.sync.now > 0;
    const asOf = trusted ? v.sync.now : 0;
    const prev = S.base;
    S.base = { pet, asOf, trusted };
    if (!(prev && prev.trusted && trusted)) return;
    const before = L.current(prev, asOf);
    const quiet = Date.now() < S.quietUntil;
    const seen = quiet ? null : L.detectPartnerCare(before, pet, v.me);
    if (seen) {
      const line = L.careLine(v.names.partner, effectiveName(), seen.actions) + (pet.bond.done && !before.bond.done ? ". You both cared today!" : "");
      if (seen.actions[0]) { react(seen.actions[0]); if (seen.actions[0] === "pet") S.flashUntil = Date.now() + 2500; }
      showBubble(L.chooseBubble(bubbleCtx({ trigger: "partner", line })), false);
    }
    if (!quiet && pet.level > before.level) {
      const gained = L.newlyUnlocked(L.unlockedIds(before.level, days()), L.unlockedIds(pet.level, days()));
      showBubble(L.chooseBubble(bubbleCtx({ trigger: "level", level: pet.level, newOutfit: gained.length ? L.OUTFIT_LABELS[gained[0]] : "" })), false);
    }
  }

  function onView(v) {
    if (!connected()) return;
    absorb(v);
    paint();
    schedule();
  }

  // ---------- care (optimistic, reconciled) ----------

  async function care(action) {
    const t = Date.now();
    if (!S.client || S.inflight[action] || L.cooldownLeft(S.cd, action, t) > 0 || !S.base) return;
    const before = S.base;
    const beforeCur = L.current(before, serverNow());
    S.inflight[action] = true;
    S.quietUntil = t + 15000;
    S.cd[action] = t + L.COOLDOWN_S * 1000;
    S.base = L.applyCare(before, action, serverNow(), me());
    react(action);
    if (action === "pet") S.flashUntil = t + 2500;
    paint(); schedule();

    let r = null, offline = false;
    try { r = await S.client.call("care", { action }); } catch (e) { offline = true; }
    delete S.inflight[action];

    const o = offline ? null : L.careOutcome(r);
    if (o && o.kind === "ok") {
      S.base = { pet: o.pet, asOf: serverNow(), trusted: true };
      S.lastSig = L.petSig(o.pet);
      if (o.pet.level > beforeCur.level) {
        const gained = L.newlyUnlocked(L.unlockedIds(beforeCur.level, days()), L.unlockedIds(o.pet.level, days()));
        showBubble(L.chooseBubble(bubbleCtx({ trigger: "level", level: o.pet.level, newOutfit: gained.length ? L.OUTFIT_LABELS[gained[0]] : "" })), false);
      } else showBubble(L.chooseBubble(bubbleCtx({
        trigger: action, wasSad: beforeCur.bucket === "sad" && L.current(S.base, serverNow()).bucket !== "sad",
        bondJustDone: o.pet.bond.done && !beforeCur.bond.done,
      })), false);
    } else {
      S.base = before;                       // put the pre-click pet back; the next absorb picks up anything newer
      S.lastSig = "";
      if (o && o.kind === "wait") {
        S.cd[action] = Date.now() + o.retryIn * 1000;
        showBubble(L.chooseBubble(bubbleCtx({ trigger: "wait", retryIn: o.retryIn })), false);
      } else {
        delete S.cd[action];
        showBubble({ id: "care-error", kind: "error", ms: 6000, text: offline ? core.MSG.offline : "The relay did not take that. Please try again in a moment." }, false);
      }
      if (S.view) absorb(S.view);
    }
    paint(); schedule();
  }

  // ---------- naming ----------

  async function submitName() {
    if (S.ui.busy || !S.client) return;
    const input = S.els.sheet.querySelector("input");
    S.ui.draft = input ? input.value : S.ui.draft;
    const c = L.cleanName(S.ui.draft);
    if (!c.ok) { S.ui.err = c.error; paintSheet(); return; }
    if (c.name === effectiveName()) { closeSheet(); return; }
    S.ui.busy = true; S.ui.err = "";
    S.nameOverride = { value: c.name, until: Date.now() + 20000 };
    paintSheet(); paint();
    let r = null, offline = false;
    try { r = await S.client.call("set", { petName: c.name }); } catch (e) { offline = true; }
    S.ui.busy = false;
    if (!offline && r && r.ok === true) {
      const hatch = S.ui.hatch;
      closeSheet();
      if (hatch) showBubble({ id: "meet", text: `Hello! I am ${c.name}.`, ms: 6000 }, false);
    } else {
      S.nameOverride = null;
      S.ui.err = offline ? core.MSG.offline : L.nameProblem(r && r.error);
      paintSheet();
    }
    paint();
  }

  // ---------- sheets (naming and outfits) ----------

  function openSheet(kind, hatch) {
    S.ui.sheet = kind; S.ui.hatch = !!hatch; S.ui.err = "";
    if (kind === "name") S.ui.draft = hatch ? "" : effectiveName();
    S.ui.focus = kind === "name" && !hatch;
    paintSheet();
    if (S.ui.focus) focusName();
  }
  function closeSheet() {
    S.ui.sheet = null; S.ui.err = ""; S.ui.busy = false; S.ui.focus = false;
    paintSheet();
  }
  function focusName() {
    const input = S.els && S.els.sheet.querySelector("input");
    if (!input) return;
    umbra.requestFocus();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function sheetHtml() {
    if (S.ui.sheet === "name") {
      const hatch = S.ui.hatch;
      return `<form class="pt-form" data-name-form data-no-drag>` +
        `<h3>${hatch ? "A blob has hatched!" : "Rename your blob"}</h3>` +
        `<p>${hatch ? "Name it together. Either of you can type the name, and both PCs will show it." : "Either of you can rename it. Both PCs will show the new name."}</p>` +
        `<input type="text" maxlength="20" autocomplete="off" spellcheck="false" placeholder="Ember" aria-label="Pet name" value="${esc(S.ui.draft)}" ${S.ui.busy ? "disabled" : ""}>` +
        `<p class="pt-err" role="alert">${esc(S.ui.err)}</p>` +
        `<div class="pt-row"><button class="btn primary" type="submit" data-no-drag ${S.ui.busy ? "disabled" : ""}>${S.ui.busy ? "Saving..." : "Save name"}</button>` +
        `<button class="btn quiet" type="button" data-no-drag data-act="sheet-close">${hatch ? "Later" : "Cancel"}</button></div>` +
        `<p class="pt-muted">Your blob never dies or leaves. If nobody visits it only gets sad, and a little care helps right away.</p></form>`;
    }
    if (S.ui.sheet === "outfits") {
      const cur = S.base ? L.current(S.base, serverNow()) : null;
      const level = cur ? cur.level : 1;
      const list = L.outfitList(level, days());
      const worn = L.sanitizeOutfit(S.prefs.outfit, list.filter((o) => o.unlocked).map((o) => o.id), M);
      const tiles = list.map((o) =>
        `<button class="pt-tile${worn.includes(o.id) ? " on" : ""}${o.unlocked ? "" : " locked"}" data-act="outfit" data-id="${o.id}" data-no-drag aria-pressed="${worn.includes(o.id)}" ${o.unlocked ? "" : "disabled"} title="${esc(o.unlocked ? o.label : o.label + ": " + o.full)}">` +
        `<span class="pt-art">${M.renderSvg({ mood: "content", outfit: [o.id], level: 5 })}</span><span class="pt-tl">${esc(o.label)}</span>` +
        `<span class="pt-th">${o.unlocked ? (worn.includes(o.id) ? "Wearing" : "&nbsp;") : esc(o.hint)}</span></button>`).join("");
      return `<div class="pt-form" data-no-drag><div class="pt-head"><h3>Outfit</h3>` +
        `<button class="btn" data-act="outfit-none" data-no-drag ${worn.length ? "" : "disabled"}>Take off</button><button class="btn primary" data-act="sheet-close" data-no-drag>Done</button></div>` +
        `<div class="pt-tiles">${tiles}</div>` +
        `<p class="pt-muted">Levels and milestones unlock outfits. The choice is saved on this PC only for now.</p></div>`;
    }
    return "";
  }

  /** What decides whether the sheet must be rebuilt. The text being typed is not part of it, so typing never rebuilds the form. */
  function sheetKey() {
    if (S.ui.sheet === "name") return JSON.stringify(["name", S.ui.hatch, S.ui.busy, S.ui.err]);
    if (S.ui.sheet === "outfits") {
      const cur = S.base ? L.current(S.base, serverNow()) : null;
      return JSON.stringify(["outfits", cur ? cur.level : 1, days(), S.prefs.outfit]);
    }
    return "";
  }

  function paintSheet() {
    if (!S.els) return;
    const el = S.els.sheet;
    const open = !!S.ui.sheet;
    put(el, "hidden", !open);
    S.root.classList.toggle("sheet-open", open);
    if (!open) { if (el._key) el.innerHTML = ""; el._key = ""; return; }
    const key = sheetKey();
    if (el._key === key) return;
    const active = document.activeElement;
    const hadFocus = el.contains(active) && active.tagName === "INPUT";
    const caret = hadFocus ? active.selectionStart : 0;
    el._key = key;
    el.innerHTML = sheetHtml();
    if (S.ui.sheet === "name" && (hadFocus || S.ui.focus)) {
      const input = el.querySelector("input");
      if (input && !input.disabled) { input.focus(); const c = hadFocus ? caret : input.value.length; input.setSelectionRange(c, c); }
    }
  }

  // ---------- painting ----------

  function skeleton() {
    const care = L.ACTION_IDS.map((id) =>
      `<button class="pt-cb" data-act="care" data-action="${id}" data-no-drag disabled>` +
      `<span class="pt-cl" data-label>${L.ACTIONS[id].label}</span><span class="pt-val num" data-val>-</span>` +
      `<span class="pt-bar" aria-hidden="true"><i data-fill></i></span></button>`).join("");
    return `<div class="pt-stage">` +
      `<div class="pt-scene" data-scene></div>` +
      `<div class="pt-name"><b data-pname></b><button class="pt-icon" data-act="rename" data-no-drag aria-label="Rename" title="Rename">&#9998;</button></div>` +
      `<span class="pt-lv num" data-lv></span>` +
      `<span class="pt-streak num" data-streak hidden></span>` +
      `<button class="btn pt-outfit" data-act="outfits" data-no-drag>Outfit</button>` +
      `</div>` +
      `<div class="pt-bubble" data-bubble role="status" hidden></div>` +
      `<span class="pt-safe" data-safe hidden>Sad, but safe. It never leaves.</span>` +
      `<div class="pt-care" data-care>${care}</div>` +
      `<div class="pt-foot"><div class="pt-xp"><b class="num" data-xplv></b><span class="pt-bar xp" aria-hidden="true"><i data-xpfill></i></span><span class="num" data-xptext></span></div>` +
      `<div class="pt-bond" data-bond></div></div>` +
      `<div class="pt-sheet" data-sheet hidden></div>`;
  }

  function paint() {
    if (!connected() || !S.els) return;
    const E = S.els, now = Date.now(), v = S.view;
    if (!v) return;
    const cur = S.base ? L.current(S.base, serverNow()) : null;
    const name = effectiveName();
    const unlocked = L.unlockedIds(cur ? cur.level : 1, days());

    // hatch: the first time the Pet view opens in a paired room with nothing named yet, ask for a name
    const synced = !!(v.sync && v.sync.rev > 0);
    if (synced && !name && !S.ui.sheet && !S.ui.later) openSheet("name", true);
    if (S.ui.sheet === "name" && S.ui.hatch && name && !S.ui.busy) closeSheet();

    // the face
    const outfit = L.sanitizeOutfit(S.prefs.outfit, unlocked, M);
    const mood = cur ? L.displayMood(cur, { mascot: M, tapped: now < S.flashUntil }) : "content";
    S.mount.update({ mood, outfit, level: cur ? cur.level : 1, title: name });

    put(E.pname, "text", name || "Unnamed blob");
    put(E.rename, "aria-label", name ? "Rename " + name : "Name your blob");
    put(E.lv, "text", cur ? "Lv " + cur.level : "");
    put(E.lv, "hidden", !cur);
    put(E.safe, "hidden", !(cur && cur.bucket === "sad"));
    const streak = cur ? cur.bond.streak : 0;
    put(E.streak, "text", streak > 0 ? `${streak} day streak` : "");
    put(E.streak, "hidden", !(streak > 0));
    put(E.streak, "title", "Days in a row that both of you cared for the blob");
    put(E.outfitBtn, "hidden", !cur);

    // care buttons: the three needs and their cooldowns
    for (const id of L.ACTION_IDS) {
      const b = E.care[id], a = L.ACTIONS[id];
      const left = L.cooldownLeft(S.cd, id, now);
      const val = cur ? cur[a.stat] : null;
      put(b.label, "text", a.label);
      put(b.val, "text", left > 0 ? L.fmtClock(left) : val === null ? "-" : String(val));   // while it cools down the number is the countdown
      put(b.fill, "width", val === null ? "0%" : Math.max(0, Math.min(100, val)) + "%");
      put(b.btn, "disabled", !cur || left > 0 || !!S.inflight[id]);
      put(b.btn, "class", "pt-cb" + (val !== null && val < 30 ? " low" : "") + (left > 0 ? " cooling" : ""));
      put(b.btn, "title", left > 0 ? `${a.label} again in ${L.fmtClock(left)}` : "");
      put(b.btn, "aria-label", `${a.label} ${name || "your blob"}. ${a.stat === "love" ? "Love" : a.stat === "food" ? "Food" : "Water"} ${val === null ? "unknown" : val + " of 100"}.` +
        (left > 0 ? ` Ready again in ${L.fmtClock(left)}.` : ""));
    }

    // level and xp
    if (cur) {
      const p = L.progress(cur);
      put(E.xplv, "text", "Lv " + p.level);
      put(E.xpfill, "width", Math.round(p.fraction * 100) + "%");
      put(E.xptext, "text", p.maxed ? "Max level" : `${umbra.fmt(p.xp, 0)}/${umbra.fmt(p.nextXp, 0)} XP`);
      put(E.xptext, "title", p.maxed ? "" : `${umbra.fmt(p.toGo, 0)} XP to the next level`);
    } else {
      put(E.xplv, "text", "Lv -"); put(E.xpfill, "width", "0%"); put(E.xptext, "text", "");
    }

    // the daily bond: only both partners together fill it (the UTC day, set by the relay)
    if (cur) {
      const side = L.bondSides(cur.bond, me());
      const nm = (s, fallback) => esc((s || fallback).slice(0, 12));
      const who = (on, label) => `<span class="pt-who${on ? " on" : ""}"><span aria-hidden="true">${on ? HEART_ON : HEART_OFF}</span> ${label}<span class="pt-sr"> ${on ? "cared today" : "has not cared yet"}</span></span>`;
      const html = `<span class="pt-today">Today</span>${who(side.you, "You")}${who(side.partner, nm(names().partner, "Partner"))}` +
        (cur.bond.done ? `<b class="pt-done">Bond done</b>` : "");
      if (E.bond._html !== html) { E.bond._html = html; E.bond.innerHTML = html; }
      put(E.bond, "title", "Both of you caring for the blob on the same UTC day fills the bond.");
    } else if (E.bond._html !== "") { E.bond._html = ""; E.bond.innerHTML = ""; }

    // speech bubble
    if (S.bubble && now >= S.bubble.until) S.bubble = null;
    if (!S.bubble && !cur) { /* nothing to say until the first sync */ }
    put(E.bubble, "hidden", !S.bubble);
    if (S.bubble) { put(E.bubble, "text", S.bubble.text); put(E.bubble, "class", "pt-bubble" + (S.bubble.kind === "error" ? " error" : "")); }

    paintSheet();
  }

  /** One timer: every second while something counts down, else every 30 s (decay, midnight, the unprompted bubble). */
  function schedule() {
    clearTimeout(S.timer); S.timer = 0;
    if (!connected() || (umbra.settings && umbra.settings.paused)) return;
    const now = Date.now();
    const busy = L.ACTION_IDS.some((id) => L.cooldownLeft(S.cd, id, now) > 0) || S.bubble || now < S.flashUntil;
    S.timer = setTimeout(tick, busy ? 1000 : 30000);
  }
  function tick() {
    S.timer = 0;
    if (!connected()) return;
    const now = Date.now();
    if (now - S.lastIdleCheck > 5 * 60 * 1000) { S.lastIdleCheck = now; maybeAuto(S.openDone ? "idle" : "open"); S.openDone = true; }
    paint(); schedule();
  }

  // ---------- input ----------

  const ACTS = {
    care(el) { care(el.dataset.action); },
    rename() { openSheet("name", false); },
    outfits() { openSheet("outfits", false); },
    "sheet-close"() { if (S.ui.sheet === "name" && S.ui.hatch) S.ui.later = true; closeSheet(); },
    outfit(el) {
      const cur = S.base ? L.current(S.base, serverNow()) : null;
      const unlocked = L.unlockedIds(cur ? cur.level : 1, days());
      S.prefs.outfit = L.toggleOutfit(S.prefs.outfit, el.dataset.id, unlocked, M);
      savePrefs(); paintSheet(); paint();
    },
    "outfit-none"() { S.prefs.outfit = []; savePrefs(); paintSheet(); paint(); },
  };

  function bind(root) {
    root.addEventListener("click", (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || el.disabled) return;
      const fn = ACTS[el.dataset.act];
      if (fn) { e.stopPropagation(); Promise.resolve(fn(el)).catch((err) => console.error(err)); }
    });
    root.addEventListener("input", (e) => { if (e.target.tagName === "INPUT") { S.ui.draft = e.target.value; if (S.ui.err) { S.ui.err = ""; const p = root.querySelector(".pt-err"); if (p) p.textContent = ""; if (S.els.sheet) S.els.sheet._key = sheetKey(); } } });
    root.addEventListener("submit", (e) => { e.preventDefault(); e.stopPropagation(); submitName(); });
    root.addEventListener("focusin", (e) => { S.ui.focus = e.target.tagName === "INPUT"; });
    // a focusout caused by the shell throwing the element away must not forget that the user was typing
    root.addEventListener("focusout", (e) => { const t = e.target; if (t.tagName === "INPUT") setTimeout(() => { if (t.isConnected) S.ui.focus = false; }, 0); });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && connected() && S.ui.sheet) { if (S.ui.sheet === "name" && S.ui.hatch) S.ui.later = true; closeSheet(); }
  });

  // ---------- public ----------

  function attach(el, client) {
    if (!el) return;
    if (!S.started) {
      S.started = true;
      S.client = client;
      S.store = umbra.store;
      client.subscribe(onView);
      loadPrefs();
    }
    if (S.root === el) return;
    S.root = el;
    el.classList.add("pt");
    el.innerHTML = skeleton();
    const q = (s) => el.querySelector(s);
    const care = {};
    el.querySelectorAll(".pt-cb").forEach((btn) => { care[btn.dataset.action] = { btn, label: btn.querySelector("[data-label]"), val: btn.querySelector("[data-val]"), fill: btn.querySelector("[data-fill]") }; });
    S.els = {
      scene: q("[data-scene]"), pname: q("[data-pname]"), rename: q(".pt-icon"), lv: q("[data-lv]"), bubble: q("[data-bubble]"),
      safe: q("[data-safe]"), outfitBtn: q(".pt-outfit"), streak: q("[data-streak]"), care, xplv: q("[data-xplv]"), xpfill: q("[data-xpfill]"), xptext: q("[data-xptext]"),
      bond: q("[data-bond]"), sheet: q("[data-sheet]"),
    };
    S.mount = M.mount(S.els.scene, { mood: "content", level: 1 }, { scene: true });
    bind(el);
    S.view = client.getView();
    absorb(S.view);
    paint();
    if (S.ui.sheet) paintSheet();
    schedule();
    if (!S.openDone) setTimeout(() => { if (connected() && !S.openDone && S.base) { S.openDone = true; S.lastIdleCheck = Date.now(); maybeAuto("open"); } }, 1500);
  }

  window.HearthPet = { attach };
})();
