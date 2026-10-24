// Prayer Times. The location, method and per-prayer minutes are chosen on the widget's own setup screen and kept in
// umbra.store; Settings only has display options. A month of calculated times comes from the Aladhan API by
// coordinates, cached in umbra.store, so it works offline and the API is called about once a month. Minute adjustments
// and iqama delays are applied locally (times.js). City search: bundled Tunisia governorates, then Open-Meteo.
(() => {
  const T = window.PrayerTimes;
  const P = window.PrayerPlaces;
  const $ = (id) => document.getElementById(id);
  const RETRY_MS = 5 * 60000;           // after a failed download, wait before trying again
  const OFFLINE_RETRY_MS = 60000;       // offline: try again soon (the "online" event also retries at once)
  const PRAYERS = T.PRAYERS;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Saved setup (umbra.store): location { name, lat, lon, tz, cc, country } | null, method "auto" | "18", school 0 | 1.
  // Per-prayer minutes stay widget options (Settings, folded).
  let location = null, method = "auto", school = 0;
  let legacyDone = false;  // the 1.0/1.1 options were looked at once (adopted or given up)
  // { key, months: { "2026-10": { tz, days, fetchedAt } } } for the current coordinates/method/school.
  let cache = null;
  let data = null;         // cache.months merged: { tz, days }
  let notified = {};       // "2026-10-17|Fajr" -> ms, so each prayer is announced once
  let fetching = false;
  let failure = null;      // { e: classifyError(...), service, retryAt } of the last failed attempt
  let view = "times";      // "times" | "setup"
  let rendered = false, lastRows = "", tickTimer = null;

  const init = (async () => {
    await umbra.ready;
    const s = umbra.store;
    [cache, notified, location, method, school, legacyDone] = await Promise.all([
      s.get("cache", null), s.get("notified", null), s.get("location", null), s.get("method", "auto"),
      s.get("school", 0), s.get("legacyDone", false),
    ]);
    notified = notified || {};
    if (!validLocation(location)) location = null;
    method = String(method ?? "auto");
    school = school === 1 || school === "1" ? 1 : 0;
    if (!cache || typeof cache.months !== "object" || !cache.months) cache = null;
    merge();
  })();

  const validLocation = (l) => !!l && typeof l === "object" && typeof l.name === "string" && Number.isFinite(l.lat) && Number.isFinite(l.lon);

  function display() {
    const o = umbra.options;
    const pref = String(o.timeFormat || "auto");
    // umbra.hour12 / umbra.locale only exist on newer hosts; without them "auto" means 24-hour.
    const hour12 = pref === "12" ? true : pref === "24" ? false : T.resolveHour12(umbra.hour12, umbra.locale);
    const locale = typeof umbra.locale === "string" && umbra.locale ? umbra.locale : undefined;
    const adjust = {}, iqama = {};
    for (const p of PRAYERS) { adjust[p] = o["adjust" + p]; iqama[p] = o["iqama" + p]; }
    const off = P.cleanOffsets({ adjust, iqama });
    return { hijri: o.hijri !== false, notify: !!o.notify, hour12, locale, adjust: off.adjust, iqama: off.iqama };
  }
  const methodNow = () => P.resolveMethod(method, location && location.cc);
  const locKey = () => (location ? `${location.lat.toFixed(4)},${location.lon.toFixed(4)}|${methodNow()}|${school}` : "");

  function merge() {
    data = null;
    if (!cache) return;
    const ids = Object.keys(cache.months).sort();
    if (!ids.length) return;
    const days = {};
    for (const id of ids) Object.assign(days, cache.months[id].days);
    data = { tz: cache.months[ids[ids.length - 1]].tz, days };
  }

  function saveSetup() {
    const s = umbra.store;
    return Promise.all([s.set("location", location), s.set("method", method), s.set("school", school)]).catch(() => {});
  }

  const notFound = () => Object.assign(new Error("City not found"), { code: "notfound" });
  const place = (r, countryText) => ({ name: r.name, lat: r.lat, lon: r.lon, tz: r.tz || null, cc: r.cc || null, country: r.cc ? P.countryName(r.cc) : countryText || "" });

  /**
   * One-time migration from the options of 1.0/1.1 (city, country, method, school): adopt them if the city
   * resolves, otherwise the setup screen shows. Network errors keep it pending, so it is tried again later.
   */
  async function migrate() {
    const old = P.legacyConfig(umbra.options);
    if (!old) { legacyDone = true; umbra.store.set("legacyDone", true).catch(() => {}); return; }
    const preset = P.findPreset(old.cc, old.city);
    let found = preset ? place({ ...preset }, old.country) : null;
    if (!found) {
      let list = T.parseGeocode(await umbra.fetchJson(T.geocodeUrl(old.city, old.cc)), old.cc);
      if (!old.cc && old.country) list = list.filter((r) => P.norm(r.country) === P.norm(old.country));
      if (!list.length) {
        legacyDone = true;
        umbra.store.set("legacyDone", true).catch(() => {});
        throw notFound();
      }
      found = place(list[0], old.country);
    }
    if (location) return;                                    // the user finished setup meanwhile
    location = found; method = old.method; school = old.school;
    legacyDone = true;
    await saveSetup();
    umbra.store.set("legacyDone", true).catch(() => {});
  }

  async function ensure() {
    await init;
    if (fetching) return;
    if (failure && Date.now() < failure.retryAt) return;
    if (!location && legacyDone) return;
    let service = "City search";
    if (!location) {
      fetching = true;
      render();
      try { await migrate(); failure = null; }
      catch (err) {
        const e = T.classifyError(err, navigator.onLine);
        failure = e.kind === "notfound" ? null : { e, service, retryAt: Date.now() + (e.kind === "offline" ? OFFLINE_RETRY_MS : RETRY_MS) };
      } finally { fetching = false; }
      render();
      if (!location) return;
    }
    const key = locKey();
    if (!cache || cache.key !== key) { cache = { key, months: {} }; merge(); }
    const missing = T.monthsNeeded(Date.now(), data && data.tz).filter((m) => !cache.months[m.id]);
    if (!missing.length) return;
    fetching = true;
    render();
    service = "The prayer time service";
    const loc = location, meth = methodNow(), sch = school;
    try {
      for (const m of missing) {
        const parsed = T.parseCalendar(await umbra.fetchJson(T.calendarUrl(m.y, m.m, loc, meth, sch)));
        if (!cache || cache.key !== key) return;            // the user picked another city/method meanwhile
        cache.months[m.id] = { ...parsed, fetchedAt: Date.now() };
      }
      // keep three months at most
      const ids = Object.keys(cache.months).sort();
      for (const id of ids.slice(0, Math.max(0, ids.length - 3))) delete cache.months[id];
      failure = null;
    } catch (err) {
      const e = T.classifyError(err, navigator.onLine);
      failure = { e, service, retryAt: Date.now() + (e.kind === "offline" ? OFFLINE_RETRY_MS : RETRY_MS) };
    } finally {
      fetching = false;
      merge();
      umbra.store.set("cache", cache).catch(() => {});
      render();
    }
  }

  // ---- view ----

  function firstFrame() {
    if (rendered) return;
    rendered = true;
    requestAnimationFrame(() => umbra.rendered());
  }

  // A "Loading" message is not a real frame yet; every other message (error) is final.
  function message(text, loading, offerSetup) {
    $("msgText").textContent = text;
    $("msgSetup").hidden = !offerSetup;
    $("msg").hidden = false;
    $("app").hidden = true;
    $("setup").hidden = true;
    if (!loading) firstFrame();
  }

  function failureText(o) {
    if (!failure) return "";
    const at = failure.e.kind !== "offline"
      ? T.formatTime(failure.retryAt, Intl.DateTimeFormat().resolvedOptions().timeZone, { hour12: o.hour12, locale: o.locale }) : "";
    return T.errorMessage(failure.e, { service: failure.service, retryAt: at, city: location ? location.name : "", country: location ? location.country : "" });
  }

  function render() {
    if (view === "setup") return;
    const o = display();
    if (!location) {
      if (legacyDone) return openSetup();
      if (failure && !fetching) return message(failureText(o), false, true);
      return message("Loading prayer times", true);
    }
    const now = Date.now();
    const st = data && cache && cache.key === locKey() ? T.schedule(data, now, o) : null;
    if (!st || !st.hasToday) {
      if (failure && !fetching) return message(failureText(o), false, true);
      return message("Loading prayer times", true);
    }
    const f = { hour12: o.hour12, locale: o.locale };
    const time = (ts) => T.formatTime(ts, st.tz, f);

    $("msg").hidden = true;
    $("setup").hidden = true;
    $("app").hidden = false;
    $("city").textContent = [location.name, location.country].filter(Boolean).join(", ");
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

  // ---- setup screen ----

  let draft = null;        // { cc, location } while the setup screen is open
  let searchTimer = null, searchSeq = 0;
  const lists = { country: [], city: [] };

  /** Fills the method list; "Auto" names the method the country uses. cur: the value to keep selected. */
  function methodOptions(cur) {
    const auto = P.methodName(P.methodFor(draft.cc));
    const sel = $("sMethod");
    sel.innerHTML = `<option value="auto">Auto: ${esc(auto)}</option>` + P.METHODS.map(([n, label]) => `<option value="${n}">${esc(label)}</option>`).join("");
    sel.value = [...sel.options].some((x) => x.value === cur) ? cur : "auto";
  }

  function openSetup() {
    view = "setup";
    draft = { cc: location ? location.cc : null, location };
    $("sCountry").value = location ? (location.cc ? P.countryName(location.cc) : location.country) : "";
    $("sCity").value = location ? location.name : "";
    methodOptions(method);
    $("sSchool").value = String(school);
    $("sCancel").hidden = !location;
    hint("");
    hideList("country"); hideList("city");
    updateSave();
    $("app").hidden = true;
    $("msg").hidden = true;
    $("setup").hidden = false;
    firstFrame();
  }

  function closeSetup() {
    view = "times";
    draft = null;
    clearTimeout(searchTimer);
    lastRows = "";
    render();
  }

  function hint(text, isError) {
    $("sHint").textContent = text;
    $("sHint").classList.toggle("err", !!isError);
  }
  const updateSave = () => { $("sSave").disabled = !(draft && draft.location); };

  function showList(which, items, sub) {
    lists[which] = items;
    const ul = $(which === "country" ? "sCountryList" : "sCityList");
    ul.innerHTML = items.map((x, i) => `<li data-i="${i}"${i === 0 ? ' class="sel"' : ""}><span>${esc(x.name)}</span><span class="sub">${esc(sub(x))}</span></li>`).join("");
    ul.hidden = !items.length;
  }
  function hideList(which) {
    lists[which] = [];
    $(which === "country" ? "sCountryList" : "sCityList").hidden = true;
  }

  function pickCountry(c) {
    const changed = c.code !== draft.cc;
    draft.cc = c.code;
    $("sCountry").value = c.name;
    hideList("country");
    if (changed) { draft.location = null; $("sCity").value = ""; }
    methodOptions($("sMethod").value);
    updateSave();
    hint(P.presets(c.code).length ? "Governorates work offline; any other town is searched online." : "");
    $("sCity").focus();
    citySuggest();
  }

  function pickCity(r) {
    draft.location = place(r, $("sCountry").value.trim());
    if (r.cc && r.cc !== draft.cc) { draft.cc = r.cc; $("sCountry").value = P.countryName(r.cc); methodOptions($("sMethod").value); }
    $("sCity").value = r.name;
    hideList("city");
    hint(`${r.name}${r.region && r.region !== r.name ? `, ${r.region}` : ""}: ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`);
    updateSave();
  }

  const sameCity = (a, b) => P.norm(a.name) === P.norm(b.name) && a.cc === b.cc;

  function citySuggest() {
    clearTimeout(searchTimer);
    const text = $("sCity").value.trim();
    const local = P.searchPresets(draft.cc, text);
    const sub = (r) => r.region || r.country || "";
    if (local.length) showList("city", local, sub); else hideList("city");
    if (P.norm(text).length < 2) return;
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      hint("Searching…");
      try {
        const found = T.parseGeocode(await umbra.fetchJson(T.geocodeUrl(text, draft.cc, 8)), draft.cc);
        if (seq !== searchSeq || !draft) return;
        const merged = [...local, ...found.filter((r) => !local.some((l) => sameCity(l, r)))].slice(0, 8);
        if (merged.length) { showList("city", merged, sub); hint(""); }
        else { hideList("city"); hint(`No place called "${text}"${draft.cc ? ` in ${P.countryName(draft.cc)}` : ""}. Check the spelling.`, true); }
      } catch (err) {
        if (seq !== searchSeq || !draft) return;
        const e = T.classifyError(err, navigator.onLine);
        const extra = P.presets(draft.cc).length ? " Governorates in the list still work." : "";
        hint(T.errorMessage(e, { service: "City search" }).replace("Prayer times will load when you're back online.", "City search needs the internet.") + extra, true);
      }
    }, 300);
  }

  function listKeys(which, ev, pick) {
    const ul = $(which === "country" ? "sCountryList" : "sCityList");
    const items = lists[which];
    if (!items.length || ul.hidden) return;
    const lis = [...ul.children];
    let i = lis.findIndex((li) => li.classList.contains("sel"));
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      i = Math.max(0, Math.min(lis.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)));
      lis.forEach((li, k) => li.classList.toggle("sel", k === i));
      lis[i].scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pick(items[Math.max(0, i)]);
    } else if (ev.key === "Escape") hideList(which);
  }

  $("sCountry").addEventListener("input", () => {
    const list = P.searchCountries($("sCountry").value);
    if (list.length) showList("country", list, (c) => c.code); else hideList("country");
  });
  $("sCountry").addEventListener("keydown", (ev) => listKeys("country", ev, pickCountry));
  $("sCity").addEventListener("input", () => { draft.location = null; updateSave(); citySuggest(); });
  $("sCity").addEventListener("focus", () => { if (!draft.location) citySuggest(); });
  $("sCity").addEventListener("keydown", (ev) => listKeys("city", ev, pickCity));
  // pointerdown, so the pick happens before the input loses focus
  $("sCountryList").addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest("li"); if (!li) return;
    ev.preventDefault(); pickCountry(lists.country[+li.dataset.i]);
  });
  $("sCityList").addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest("li"); if (!li) return;
    ev.preventDefault(); pickCity(lists.city[+li.dataset.i]);
  });
  $("setup").addEventListener("focusout", (ev) => {
    if (ev.target === $("sCountry")) hideList("country");
    if (ev.target === $("sCity")) hideList("city");
  });
  $("sCancel").onclick = closeSetup;
  $("setup").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!draft || !draft.location) return;
    location = draft.location;
    method = $("sMethod").value || "auto";
    school = $("sSchool").value === "1" ? 1 : 0;
    legacyDone = true;
    failure = null;
    if (cache && cache.key !== locKey()) { cache = null; merge(); }
    await saveSetup();
    umbra.store.set("legacyDone", true).catch(() => {});
    closeSetup();
    await ensure();
  });
  $("gear").onclick = openSetup;
  $("msgSetup").onclick = openSetup;

  // ---- notifications ----

  async function checkNotify() {
    await init;
    const o = display();
    if (!o.notify || !data || !location || !cache || cache.key !== locKey()) return;
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
    umbra.notify({ title: `${e.name} time`, body: `${T.formatTime(e.ts, st.tz, { hour12: o.hour12, locale: o.locale })} in ${location.name}` }).catch(() => {});
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
    if (failure) { failure.retryAt = 0; ensure(); }
  });

  $("credit").onclick = () => umbra.openUrl("https://aladhan.com");

  umbra.every(async () => { await ensure(); render(); checkNotify(); });
  umbra.onSettings(async () => {
    await init;
    lastRows = "";
    render();
    checkNotify();
  });

  init.then(() => {
    render();
    startTick();
  });
})();
