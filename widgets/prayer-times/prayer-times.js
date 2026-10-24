// Prayer Times: the city is resolved to coordinates (bundled Tunisia governorates first, then Open-Meteo geocoding),
// then a month of calculated times comes from the Aladhan API by coordinates, cached in umbra.store, so it works offline
// and each API is called about once a month. Minute adjustments and iqama delays are applied locally (times.js).
(() => {
  const T = window.PrayerTimes;
  const P = window.PrayerPlaces;
  const $ = (id) => document.getElementById(id);
  const RETRY_MS = 5 * 60000;           // after a failed download, wait before trying again
  const OFFLINE_RETRY_MS = 60000;       // offline: try again soon (the "online" event also retries at once)
  const PRAYERS = T.PRAYERS;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // { key, place: { name, lat, lon, tz, cc } | null, months: { "2026-10": { tz, days, fetchedAt } } } for the current
  // city/country/method/school. The resolved place is kept, so the geocoder is asked once per city.
  let cache = null;
  let data = null;         // cache.months merged: { tz, days }
  let notified = {};       // "2026-10-17|Fajr" -> ms, so each prayer is announced once
  let fetching = false;
  let failure = null;      // { e: classifyError(...), service, retryAt } of the last failed attempt
  let rendered = false, lastRows = "", tickTimer = null;

  const init = (async () => {
    await umbra.ready;
    cache = await umbra.store.get("cache", null);
    notified = (await umbra.store.get("notified", null)) || {};
    if (!cache || typeof cache.months !== "object" || !cache.months) cache = null;
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
    const country = String(o.country || "").trim();
    const cc = P.findCountry(country);
    // "auto" follows the country; any number is the user's override and sticks. 1.0 stored its old default "3" as
    // `method` for everyone, so only a method someone actually picked there (not "3") carries over as an override.
    const legacy = o.method != null && String(o.method) !== "3" ? String(o.method) : "auto";
    const m = String(o.calcMethod ?? "auto") === "auto" ? legacy : String(o.calcMethod);
    const method = m === "auto" || m === "" ? P.methodFor(cc) : T.clampInt(m, 0, 99, 3);
    return {
      city: String(o.city || "").trim(), country, cc, method, autoMethod: m === "auto" || m === "",
      school: T.clampInt(o.school, 0, 1), hijri: o.hijri !== false, notify: !!o.notify, adjust, iqama, hour12, locale,
    };
  }
  const locKey = (o) => [P.norm(o.city), o.cc || P.norm(o.country), o.method, o.school].join("|");

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

  /** City + country -> { name, lat, lon, tz, cc }: a bundled preset needs no network; otherwise Open-Meteo. */
  async function resolvePlace(o) {
    const preset = P.findPreset(o.cc, o.city);
    if (preset) return preset;
    let list = T.parseGeocode(await umbra.fetchJson(T.geocodeUrl(o.city, o.cc)), o.cc);
    // A country Umbra doesn't recognise: match Open-Meteo's own country name instead of guessing.
    if (!o.cc && o.country) list = list.filter((r) => P.norm(r.country) === P.norm(o.country));
    if (!list.length) throw Object.assign(new Error("City not found"), { code: "notfound" });
    const r = list[0];
    return { name: r.name, lat: r.lat, lon: r.lon, tz: r.tz, cc: r.cc };
  }

  async function ensure() {
    await init;
    const o = opts();
    if (!o.city || fetching) return;
    const key = locKey(o);
    if (!cache || cache.key !== key) { cache = { key, place: null, months: {} }; merge(); }
    const missing = T.monthsNeeded(Date.now(), data && data.tz).filter((m) => !cache.months[m.id]);
    if (cache.place && !missing.length) return;
    if (failure && Date.now() < failure.retryAt) return;
    fetching = true;
    render();
    let service = "City search";
    try {
      if (!cache.place) {
        const place = await resolvePlace(o);
        if (!cache || cache.key !== key) return;            // the user changed city/method meanwhile
        cache.place = place;
      }
      service = "The prayer time service";
      for (const m of missing) {
        const parsed = T.parseCalendar(await umbra.fetchJson(T.calendarUrl(m.y, m.m, cache.place, o.method, o.school)));
        if (!cache || cache.key !== key) return;            // this answer is for an old city/method
        cache.months[m.id] = { ...parsed, fetchedAt: Date.now() };
      }
      // keep three months at most
      const ids = Object.keys(cache.months).sort();
      for (const id of ids.slice(0, Math.max(0, ids.length - 3))) delete cache.months[id];
      failure = null;
    } catch (err) {
      const e = T.classifyError(err, navigator.onLine);
      const wait = e.kind === "notfound" ? Infinity : e.kind === "offline" ? OFFLINE_RETRY_MS : RETRY_MS;
      failure = { e, service, retryAt: Date.now() + wait };
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

  function failureText(o) {
    if (!failure) return "";
    const at = Number.isFinite(failure.retryAt) && failure.e.kind !== "offline"
      ? T.formatTime(failure.retryAt, Intl.DateTimeFormat().resolvedOptions().timeZone, { hour12: o.hour12, locale: o.locale }) : "";
    return T.errorMessage(failure.e, { service: failure.service, retryAt: at, city: o.city, country: o.cc ? P.countryName(o.cc) : o.country });
  }

  function render() {
    const o = opts();
    if (!o.city) return message("Set a city and country in the widget options");
    const now = Date.now();
    const st = data && cache && cache.key === locKey(o) ? T.schedule(data, now, o) : null;
    if (!st || !st.hasToday) {
      if (failure && !fetching) return message(failureText(o));
      return message("Loading prayer times", true);
    }
    const f = { hour12: o.hour12, locale: o.locale };
    const time = (ts) => T.formatTime(ts, st.tz, f);

    $("msg").hidden = true;
    $("app").hidden = false;
    const place = cache.place;
    const country = place && place.cc ? P.countryName(place.cc) : o.country;
    $("city").textContent = [place ? place.name : o.city, country].filter(Boolean).join(", ");
    const hijri = o.hijri ? T.formatHijri(st.hijri) : "";
    $("date").textContent = T.formatDate(now, st.tz, o.locale) + (hijri ? `  ·  ${hijri}` : "");
    const stale = !!failure;
    $("stale").hidden = !stale;
    $("stale").textContent = stale ? T.errorLabel(failure.e) : "";
    $("stale").title = stale ? failureText(o) + " Showing saved times." : "";

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
    $("upd").textContent = at ? `${stale ? "Saved " : "Updated "}${T.formatDate(at, st.tz, o.locale)}` : "";
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
    const where = cache && cache.place ? cache.place.name : o.city;
    umbra.notify({ title: `${e.name} time`, body: `${T.formatTime(e.ts, st.tz, f)} in ${where}` }).catch(() => {});
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
  window.addEventListener("online", () => {
    if (failure && failure.e.kind !== "notfound") { failure.retryAt = 0; ensure(); }
  });

  $("credit").onclick = () => umbra.openUrl("https://aladhan.com");

  let lastLoc = null;
  umbra.every(async () => { await ensure(); render(); checkNotify(); });
  umbra.onSettings(async () => {
    await init;
    const key = locKey(opts());
    lastRows = "";
    if (key !== lastLoc) {
      lastLoc = key;
      failure = null;
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
