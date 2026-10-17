// Prayer Times: month of calculated times from the Aladhan API, cached in umbra.store, so it works offline and
// the API is called about once a month. Minute adjustments and iqama delays are applied locally (times.js).
(() => {
  const T = window.PrayerTimes;
  const $ = (id) => document.getElementById(id);
  const API = "https://api.aladhan.com/v1/calendarByCity";
  const RETRY_MS = 5 * 60000;           // after a failed download, wait before trying again
  const PRAYERS = T.PRAYERS;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let cache = null;        // { key, months: { "2026-10": { tz, days, fetchedAt } } } for the current city/method/school
  let data = null;         // cache.months merged: { tz, days }
  let notified = {};       // "2026-10-17|Fajr" -> ms, so each prayer is announced once
  let fetching = false, lastFail = 0, errorText = "";
  let rendered = false, lastRows = "", tickTimer = null;

  const init = (async () => {
    await umbra.ready;
    cache = await umbra.store.get("cache", null);
    notified = (await umbra.store.get("notified", null)) || {};
    if (!cache || typeof cache.months !== "object") cache = null;
    merge();
  })();

  function opts() {
    const o = umbra.options;
    const adjust = {}, iqama = {};
    for (const p of PRAYERS) {
      adjust[p] = T.clampInt(o["adjust" + p], -30, 30);
      iqama[p] = T.clampInt(o["iqama" + p], 0, 90);
    }
    const pref = String(o.timeFormat || "auto");
    // umbra.hour12 / umbra.locale only exist on newer hosts; without them "auto" means 24-hour.
    const hour12 = pref === "12" ? true : pref === "24" ? false : T.resolveHour12(umbra.hour12, umbra.locale);
    const locale = typeof umbra.locale === "string" && umbra.locale ? umbra.locale : undefined;
    return {
      city: String(o.city || "").trim(), country: String(o.country || "").trim(),
      method: T.clampInt(o.method, 0, 99, 3), school: T.clampInt(o.school, 0, 1),
      hijri: o.hijri !== false, notify: !!o.notify, adjust, iqama, hour12, locale,
    };
  }
  const locKey = (o) => [o.city.toLowerCase(), o.country.toLowerCase(), o.method, o.school].join("|");

  function merge() {
    data = null;
    if (!cache) return;
    const ids = Object.keys(cache.months).sort();
    if (!ids.length) return;
    const days = {};
    for (const id of ids) Object.assign(days, cache.months[id].days);
    data = { tz: cache.months[ids[ids.length - 1]].tz, days };
  }

  // ---- data ----

  async function ensure() {
    await init;
    const o = opts();
    if (!o.city || !o.country || fetching) return;
    const key = locKey(o);
    if (!cache || cache.key !== key) { cache = { key, months: {} }; merge(); }
    const missing = T.monthsNeeded(Date.now(), data && data.tz).filter((m) => !cache.months[m.id]);
    if (!missing.length || Date.now() - lastFail < RETRY_MS) return;
    fetching = true;
    render();
    try {
      for (const m of missing) {
        const url = `${API}/${m.y}/${m.m}?city=${encodeURIComponent(o.city)}&country=${encodeURIComponent(o.country)}&method=${encodeURIComponent(o.method)}&school=${encodeURIComponent(o.school)}`;
        const parsed = T.parseCalendar(await umbra.fetchJson(url));
        if (!cache || cache.key !== key) return;            // the user changed city/method meanwhile; this answer is stale
        cache.months[m.id] = { ...parsed, fetchedAt: Date.now() };
      }
      // keep three months at most
      const ids = Object.keys(cache.months).sort();
      for (const id of ids.slice(0, Math.max(0, ids.length - 3))) delete cache.months[id];
      errorText = ""; lastFail = 0;
    } catch (e) {
      lastFail = Date.now();
      errorText = /geocode|400|BAD/i.test(String(e && e.message)) ? "No match for this city. Check city and country in the widget options." : "Can't reach the prayer time service.";
    } finally {
      fetching = false;
      merge();
      umbra.store.set("cache", cache).catch(() => {});
      render();
    }
  }

  // ---- view ----

  // A "Loading" message is not a real frame yet; every other message (setup hint, error) is final.
  function message(text, loading) {
    $("msg").textContent = text;
    $("msg").hidden = false;
    $("app").hidden = true;
    if (!loading) firstFrame();
  }

  function firstFrame() {
    if (rendered) return;
    rendered = true;
    requestAnimationFrame(() => umbra.rendered());
  }

  function setStatus(stale) {
    try { umbra.status?.(stale ? "offline" : "ok"); } catch { /* optional newer-host API */ }
  }

  function render() {
    const o = opts();
    if (!o.city || !o.country) return message("Set a city and country in the widget options");
    const now = Date.now();
    const st = data && cache && cache.key === locKey(o) ? T.schedule(data, now, o) : null;
    if (!st || !st.hasToday) {
      if (errorText && !fetching) return message(errorText);
      return fetching || !lastFail ? message("Loading prayer times", true) : message(errorText || "No times for today yet");
    }
    const f = { hour12: o.hour12, locale: o.locale };
    const time = (ts) => T.formatTime(ts, st.tz, f);

    $("msg").hidden = true;
    $("app").hidden = false;
    $("city").textContent = `${o.city}, ${o.country}`;
    const hijri = o.hijri ? T.formatHijri(st.hijri) : "";
    $("date").textContent = T.formatDate(now, st.tz, o.locale) + (hijri ? `  ·  ${hijri}` : "");
    const stale = !!errorText;
    $("stale").hidden = !stale;
    setStatus(stale);

    if (st.next) {
      $("nname").textContent = st.next.name;
      $("nat").textContent = `at ${time(st.next.ts)}`;
      $("count").textContent = T.formatCountdown(st.next.ts - now);
    } else {
      $("nname").textContent = "Fajr";
      $("nat").textContent = "waiting for tomorrow's times";
      $("count").textContent = "--:--";
    }
    const ip = st.iqamaPending;
    $("iqp").textContent = ip ? `${ip.name} iqama in ${T.formatCountdown(ip.ms)} (${time(ip.at)})` : "";

    const showIqama = PRAYERS.some((p) => o.iqama[p] > 0);
    const rows = st.rows.map((r) => {
      const cls = ["row", r.prayer ? "" : "sun", r.isCurrent ? "cur" : "", r.isNext ? "next" : "", r.past && !r.isCurrent ? "past" : ""].filter(Boolean).join(" ");
      const iq = showIqama ? `<span class="iq num">${r.iqamaTs ? esc(time(r.iqamaTs)) : ""}</span>` : "";
      return `<div class="${cls}"><span class="nm">${esc(r.name)}</span><span class="tm num">${esc(time(r.ts))}</span>${iq}</div>`;
    }).join("");
    const head = showIqama ? '<div class="head"><span></span><span>Adhan</span><span>Iqama</span></div>' : "";
    const html = head + rows;
    if (html !== lastRows) {
      lastRows = html;
      $("rows").innerHTML = html;
    }
    $("rows").classList.toggle("noiq", !showIqama);

    const months = cache ? Object.values(cache.months) : [];
    const at = months.reduce((a, m) => Math.max(a, m.fetchedAt || 0), 0);
    $("upd").textContent = at ? `${stale ? "Last updated " : "Updated "}${T.formatDate(at, st.tz, o.locale)}` : "";
    firstFrame();
  }

  // ---- notifications ----

  async function checkNotify() {
    await init;
    const o = opts();
    if (!o.notify || !data) return;
    const now = Date.now();
    const st = T.schedule(data, now, o);
    if (!st.hasToday) return;
    const due = T.notifyDue(st.events, now, notified);
    if (!due.length) return;
    for (const e of due) notified[`${e.key}|${e.name}`] = now;
    notified = T.pruneNotified(notified, st.todayKey);
    umbra.store.set("notified", notified).catch(() => {});
    // Only the latest one if several were missed; rejects (switch off, rate limit) are fine.
    const e = due[due.length - 1];
    const f = { hour12: o.hour12, locale: o.locale };
    umbra.notify({ title: `${e.name} time`, body: `${T.formatTime(e.ts, st.tz, f)} in ${o.city}` }).catch(() => {});
  }

  // ---- timers ----

  // The countdown ticks every second, but only while the window is visible.
  function startTick() {
    if (tickTimer || document.visibilityState !== "visible") return;
    tickTimer = setInterval(render, 1000);
  }
  function stopTick() { clearInterval(tickTimer); tickTimer = null; }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { render(); startTick(); } else stopTick();
  });
  setInterval(checkNotify, 20000);

  $("credit").onclick = () => umbra.openUrl("https://aladhan.com");

  let lastLoc = null;
  umbra.every(async () => { await ensure(); render(); checkNotify(); });
  umbra.onSettings(async () => {
    await init;
    const key = locKey(opts());
    lastRows = "";
    if (key !== lastLoc) {
      lastLoc = key;
      lastFail = 0; errorText = "";
      if (cache && cache.key !== key) { cache = null; merge(); }
      render();
      await ensure();
    }
    render();
    checkNotify();
  });

  init.then(() => {
    lastLoc = locKey(opts());
    render();
    startTick();
  });
})();
