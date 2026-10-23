// Hearth Overview: two initials joined by a bow, "N days together", milestone celebrations, and the edit sheet for the
// shared names and together-since date. The shell (hearth.js) owns the card, the header and the pairing screens; it calls
//   HearthOverview.init({ app, client, core, mascot, rerender })   once
//   HearthOverview.html(view)                                      the body of the card for the overview view
//   HearthOverview.mounted(view)                                   after the shell wrote that html into the card
// All the rules (calendar days, milestones, validation, what to send to the relay) are in overview-logic.js.
//
// For the Tap view (#211): the body has an empty <div class="hov-tap" data-slot="tap"></div> (hidden while empty). After every
// render the card element gets a bubbling "hearth-overview" CustomEvent whose detail is { tapSlot, view }; fill the slot then.
(() => {
  "use strict";
  const L = window.HearthOverviewLogic;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SEEN_KEY = "ovSeen";   // umbra.store: the key of the last milestone whose confetti has played on this copy
  const state = {
    ready: false,
    editing: false,
    busy: false,
    draft: { name: "", since: "" },
    errors: {},                // { name?, since? } for the fields, from validation
    notice: "",                // one sentence from the relay or the network
    focusId: "",               // which field had the focus, so a re-render does not lose it
    sel: [0, 0],
    pending: null,             // our own saved values until the next sync shows them (overlayPending)
    seen: "",
  };
  let ctx = null;              // { app, client, core, mascot, rerender }
  let midnightTimer = 0;
  let confettiTimer = 0;

  const PENCIL = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 13l.7-3L10.5 3.2a1.4 1.4 0 0 1 2 0l.3.3a1.4 1.4 0 0 1 0 2L6 12.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // A ribbon that runs behind both circles with a bow in the middle.
  const BOW = '<svg class="hov-bow" viewBox="0 0 56 28" aria-hidden="true">' +
    '<path d="M0 11h56v6H0z" fill="#F7A8C4" stroke="#6B4F3A" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M28 14C22 3 11 3 11 14s11 11 17 0z" fill="#F7A8C4" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M28 14c6-11 17-11 17 0s-11 11-17 0z" fill="#F7A8C4" stroke="#6B4F3A" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M26 17l-6 9M30 17l6 9" fill="none" stroke="#6B4F3A" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="28" cy="14" r="3.4" fill="#E5648F" stroke="#6B4F3A" stroke-width="2"/></svg>';

  const motionOn = () => document.documentElement.dataset.motion !== "off";
  const today = () => L.localToday(new Date());
  const fmtInt = (n) => (typeof umbra !== "undefined" && umbra.fmt ? umbra.fmt(n, 0) : String(n));

  /** The values to show: the synced ones, with our own just-saved edit on top until the sync catches up. */
  function effective(v) {
    const e = L.overlayPending(v.sync, v.me || "a", state.pending, Date.now());
    state.pending = e.pending;
    return e;
  }

  function prettyDate(iso) {
    const p = L.parseYmd(iso);
    if (!p) return "";
    try { return new Date(p.y, p.m - 1, p.d).toLocaleDateString(umbra.locale, { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return iso; }
  }

  // ---------- html ----------

  function nameSpan(name, who) {
    return name ? `<span class="hov-name">${esc(name)}</span>` : `<span class="hov-name unset">${who === "you" ? "You" : "Your partner"}</span>`;
  }

  function pair(v, e) {
    const a = e.names.a, b = e.names.b;
    const label = [a, b].filter(Boolean).join(" and ") || "Two people";
    const dot = (side, name) => `<span class="hov-dot ${side}${name ? "" : " unset"}" title="${esc(name || (v.me === side ? "Add your name" : "Your partner adds their own name"))}">${esc(L.initialOf(name))}</span>`;
    return `<div class="hov-pair" role="img" aria-label="${esc(label)}">${dot("a", a)}${BOW}${dot("b", b)}</div>`;
  }

  function main(v) {
    const e = effective(v);
    const t = today();
    const ready = v.sync.rev > 0 || v.lastOkAt > 0 || !!e.since || !!(e.names.a || e.names.b);
    const n = L.daysTogether(e.since, t);
    const youSide = v.me === "b" ? "b" : "a";
    const ms = n === null ? [] : L.milestonesOn(e.since, t, ctx.mascot && ctx.mascot.milestoneOutfit);
    const cheer = ms[0] || null;
    const names = `${nameSpan(e.names.a, youSide === "a" ? "you" : "partner")}<span class="hov-amp"> &amp; </span>${nameSpan(e.names.b, youSide === "b" ? "you" : "partner")}`;

    let days;
    if (n === null) {
      days = ready
        ? `<div class="hov-days"><span class="hov-ask">Together since when?</span> <button class="btn primary hov-setdate" data-ov="setdate" data-no-drag>Set the date</button></div>`
        : `<div class="hov-days" aria-busy="true"><b class="num hov-count">&ndash;</b> <span class="hov-unit">days together</span></div>`;
    } else if (n === 0) {
      days = `<div class="hov-days" title="${esc(prettyDate(e.since))}"><span class="hov-unit hov-one">Day one, together since today</span></div>`;
    } else {
      days = `<div class="hov-days" title="Together since ${esc(prettyDate(e.since))}"><b class="num hov-count">${esc(fmtInt(n))}</b> <span class="hov-unit">${n === 1 ? "day" : "days"} together</span></div>`;
    }
    const line = cheer ? `<div class="hov-cheer" role="status" data-outfit="${esc(cheer.outfit || "")}">${esc(L.milestoneLine(cheer, fmtInt))}</div>` : "";
    return `<section class="body hov${cheer ? " has-cheer" : ""}" data-ov-root>${pair(v, e)}` +
      `<div class="hov-info"><div class="hov-names">${names}` +
      `<button class="icon-btn hov-edit" data-ov="edit" data-no-drag aria-label="Edit names and date" title="Edit names and date">${PENCIL}</button></div>` +
      `${days}${line}<div class="hov-tap" data-slot="tap"></div></div></section>`;
  }

  function sheet(v) {
    const err = state.errors.name || state.errors.since || state.notice;
    return `<section class="hov-sheet" data-ov-sheet data-no-drag>` +
      `<div class="hov-fields">` +
      `<label class="hov-field">Your name<input id="ov-name" class="${state.errors.name ? "bad" : ""}" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Up to 20 letters" value="${esc(state.draft.name)}" aria-invalid="${state.errors.name ? "true" : "false"}"></label>` +
      `<label class="hov-field">Together since<input id="ov-since" class="num${state.errors.since ? " bad" : ""}" inputmode="numeric" maxlength="12" autocomplete="off" spellcheck="false" placeholder="YYYY-MM-DD" value="${esc(state.draft.since)}" aria-invalid="${state.errors.since ? "true" : "false"}"></label>` +
      `</div>` +
      `<div class="hov-actions"><button class="btn primary" data-ov="save" data-no-drag ${state.busy ? "disabled" : ""}>${state.busy ? "Saving..." : "Save"}</button>` +
      `<button class="btn quiet" data-ov="cancel" data-no-drag ${state.busy ? "disabled" : ""}>Cancel</button>` +
      `<span class="hov-err" role="alert" title="${esc(err)}">${esc(err)}</span></div></section>`;
  }

  /** The card body for the overview view: the strip, plus the edit sheet on top while editing. */
  function html(v) {
    return main(v) + (state.editing ? sheet(v) : "");
  }

  // ---------- after the shell wrote the html ----------

  function mounted(v) {
    if (!ctx || !ctx.app.querySelector("[data-ov-root]")) return;
    scheduleMidnight();
    if (state.editing && state.focusId) {
      const el = ctx.app.querySelector("#" + state.focusId);
      if (el) { el.focus(); try { el.setSelectionRange(state.sel[0], state.sel[1]); } catch (e) { /* not a text field */ } }
    }
    const slot = ctx.app.querySelector('[data-slot="tap"]');
    ctx.app.dispatchEvent(new CustomEvent("hearth-overview", { bubbles: true, detail: { tapSlot: slot, view: v } }));
    celebrate(v);
  }

  // ---------- milestone confetti ----------

  function celebrate(v) {
    const e = effective(v);
    const ms = L.milestonesOn(e.since, today(), ctx.mascot && ctx.mascot.milestoneOutfit);
    const m = ms[0];
    if (!m || state.seen === m.key || !state.ready) return;
    state.seen = m.key;
    Promise.resolve(umbra.store.set(SEEN_KEY, m.key)).catch(() => {});
    ctx.app.dispatchEvent(new CustomEvent("hearth-milestone", { bubbles: true, detail: { milestone: m, view: v } }));
    if (motionOn()) confetti();   // reduced motion: just the line
  }

  // The confetti lives outside the card (the shell rewrites the card's html on every change) and falls over it once.
  function confetti() {
    clearTimeout(confettiTimer);
    document.querySelectorAll(".hov-confetti").forEach((n) => n.remove());
    const box = document.createElement("div");
    box.className = "hov-confetti";
    box.setAttribute("aria-hidden", "true");
    const colors = ["var(--hm-pink)", "var(--hm-butter)", "var(--hm-green)", "var(--hm-pink-deep)"];
    box.innerHTML = L.confettiPieces(34, Math.random).map((p) =>
      `<i style="left:${p.x}%;width:${p.w}px;height:${p.h}px;background:${colors[p.color]};--dx:${p.drift}px;--rot:${p.spin}deg;animation-duration:calc(${p.dur}ms * var(--motion-scale, 1));animation-delay:${p.delay}ms"></i>`).join("");
    document.body.appendChild(box);
    confettiTimer = setTimeout(() => box.remove(), 6500);
  }

  // ---------- timers ----------

  // One timer for the next local midnight: the count and the milestones change then. Set up again on a time or zone change.
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(() => { if (ctx.app.dataset.view === "overview") ctx.rerender(); scheduleMidnight(); }, L.msToNextMidnight(new Date()));
  }

  // ---------- editing ----------

  function open(focusId) {
    const v = ctx.client.getView();
    const e = effective(v);
    state.editing = true;
    state.busy = false;
    state.errors = {}; state.notice = "";
    state.draft = { name: e.names[v.me === "b" ? "b" : "a"] || "", since: e.since || "" };
    state.focusId = focusId; state.sel = [state.draft[focusId === "ov-since" ? "since" : "name"].length, state.draft[focusId === "ov-since" ? "since" : "name"].length];
    umbra.requestFocus();
    ctx.rerender();
  }
  function close() {
    state.editing = false; state.busy = false; state.errors = {}; state.notice = ""; state.focusId = "";
    ctx.rerender();
  }

  async function save() {
    if (state.busy || !state.editing) return;
    const v = ctx.client.getView();
    if (!v.paired) { close(); return; }
    const me = v.me === "b" ? "b" : "a";
    const e = effective(v);
    const res = L.buildSetParams({ me, current: { name: e.names[me], since: e.since }, draft: state.draft, today: today() });
    if (!res.ok) {
      state.errors = res.errors; state.notice = "";
      state.focusId = res.errors.name ? "ov-name" : "ov-since";
      const f = state.draft[res.errors.name ? "name" : "since"];
      state.sel = [f.length, f.length];
      ctx.rerender();
      return;
    }
    if (!res.params) { close(); return; }
    state.errors = {}; state.notice = ""; state.busy = true;
    ctx.rerender();
    try {
      const r = await ctx.client.call("set", res.params);
      if (r && r.ok === true) {
        state.pending = Object.assign({ at: Date.now() }, res.changes);
        state.editing = false; state.focusId = "";
      } else if (r && typeof r.error === "string") state.notice = L.setErrorText(r.error);
      else if (!ctx.client.getView().paired) state.editing = false; // the pairing ended meanwhile; the shell shows why
      else state.notice = ctx.core.MSG.server;
    } catch (err) {
      state.notice = ctx.core.MSG.offline;
    }
    state.busy = false;
    ctx.rerender();
  }

  function remember(el) {
    if (!el || !el.id || (el.id !== "ov-name" && el.id !== "ov-since")) return;
    state.focusId = el.id;
    state.sel = [el.selectionStart || 0, el.selectionEnd || 0];
  }

  function wire(app) {
    app.addEventListener("click", (e) => {
      const el = e.target.closest("[data-ov]");
      if (!el || el.disabled) return;
      switch (el.dataset.ov) {
        case "edit": open("ov-name"); break;
        case "setdate": open("ov-since"); break;
        case "cancel": close(); break;
        case "save": save(); break;
      }
    });
    app.addEventListener("input", (e) => {
      const el = e.target;
      if (el.id === "ov-name") { state.draft.name = el.value; delete state.errors.name; }
      else if (el.id === "ov-since") { state.draft.since = el.value; delete state.errors.since; }
      else return;
      state.notice = "";
      remember(el);
      el.classList.remove("bad");
      const msg = app.querySelector(".hov-err");
      if (msg) { msg.textContent = ""; msg.title = ""; }
    });
    app.addEventListener("focusin", (e) => remember(e.target));
    app.addEventListener("keyup", (e) => remember(e.target));
    app.addEventListener("mouseup", (e) => remember(e.target));
    app.addEventListener("keydown", (e) => {
      if (!state.editing || !e.target.closest || !e.target.closest("[data-ov-sheet]")) return;
      if (e.key === "Enter") { e.preventDefault(); save(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.editing) { close(); } });
  }

  /** Called once by the shell, before the client starts. Returns a promise: it loads what this copy has already celebrated. */
  async function init(c) {
    ctx = c;
    wire(c.app);
    // The pairing ended (or was replaced): an open edit sheet belongs to the old one.
    c.client.subscribe((v) => { if (state.editing && !v.paired) { state.editing = false; state.busy = false; } });
    umbra.onTimeChanged(() => { scheduleMidnight(); });
    try { state.seen = String(await umbra.store.get(SEEN_KEY, "")); } catch (e) { state.seen = ""; }
    state.ready = true;
  }

  window.HearthOverview = { init, html, mounted };
})();
