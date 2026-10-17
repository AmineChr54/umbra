(() => {
  const $ = id => document.getElementById(id);
  const HOSTS = ["calendar.google.com", "outlook.office365.com", "outlook.live.com", "calendar.zoho.com", "calendar.proton.me", "raw.githubusercontent.com"];
  let icsText = null;   // last good calendar text
  let stale = false;
  let error = "";
  let first = true;

  const pad = n => String(n).padStart(2, "0");
  const ics = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  /** Sample calendar dated around today so the widget can be tried (and screenshotted) without an account. */
  function demoCalendar() {
    const now = new Date(), t = ics(now), n = ics(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const e = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
    return ["BEGIN:VCALENDAR", "VERSION:2.0",
      e([`DTSTART;VALUE=DATE:${t}`, `DTEND;VALUE=DATE:${n}`, "SUMMARY:Project week"]),
      e([`DTSTART:${t}T090000`, "SUMMARY:Stand-up", "RRULE:FREQ=DAILY", "LOCATION:Room 4"]),
      e([`DTSTART:${t}T120000`, `DTEND:${t}T130000`, "SUMMARY:Lunch with Sam", "LOCATION:Cafe Einstein"]),
      e([`DTSTART:${t}T150000`, `DTEND:${t}T163000`, "SUMMARY:Design review", "LOCATION:Video call"]),
      e([`DTSTART:${n}T100000`, `DTEND:${n}T110000`, "SUMMARY:Dentist"]),
      e([`DTSTART:${n}T140000`, `DTEND:${n}T150000`, "SUMMARY:Sprint planning", "RRULE:FREQ=WEEKLY"]),
      "END:VCALENDAR"].join("\r\n");
  }

  /** Validates the address: https (webcal:// is mapped) on a declared host, so the error is clear. */
  function resolveUrl(raw) {
    const u = (raw || "").trim().replace(/^webcal:\/\//i, "https://");
    if (!u) return { error: "Add your calendar's iCal address in Settings." };
    let url;
    try { url = new URL(u); } catch { return { error: "That is not a valid address." }; }
    if (url.protocol !== "https:") return { error: "The address must be https:// or webcal://." };
    if (!HOSTS.includes(url.hostname)) return { error: `${url.hostname} is not allowed. Use Google, Outlook, Zoho, Proton or raw.githubusercontent.com.` };
    return { url: url.href };
  }

  function timeText(ms, h12) {
    const d = new Date(ms);
    if (!h12) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())}${d.getHours() < 12 ? "a" : "p"}`;
  }

  function row(ev, o, nowMs) {
    const el = document.createElement("div");
    const running = ev.start <= nowMs && ev.end > nowMs;
    el.className = "ev" + (running && !ev.allDay ? " now" : "") + (!ev.allDay && ev.end <= nowMs && ev.end > ev.start ? " past" : "");
    const when = document.createElement("div");
    when.className = "when num";
    when.textContent = ev.allDay ? "All day" : timeText(ev.start, o.clock === "12" || (o.clock !== "24" && umbra.hour12));
    const what = document.createElement("div");
    what.className = "what";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = ev.summary;
    what.append(title);
    if (o.showLocation !== false && ev.location) {
      const loc = document.createElement("div");
      loc.className = "loc";
      loc.textContent = ev.location;
      what.append(loc);
    }
    el.append(when, what);
    return el;
  }

  function render() {
    const o = umbra.options, now = new Date(), nowMs = now.getTime();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = o.showTomorrow === false ? 1 : 2;
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).getTime();
    $("date").textContent = now.toLocaleDateString(umbra.locale,{ weekday: "long", day: "numeric", month: "short" });
    $("stale").hidden = !stale;
    const list = $("list");
    list.textContent = "";

    if (icsText == null) {
      list.innerHTML = '<div class="empty"></div>';
      list.firstChild.textContent = error || "Loading";
      return;
    }
    const events = ICal.expand(icsText, dayStart, dayEnd);
    const max = Math.max(1, Math.min(12, Number(o.maxRows) || 8));
    let used = 0, hidden = 0;
    for (let d = 0; d < days; d++) {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).getTime();
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d + 1).getTime();
      const mine = events.filter(e => e.start < to && (e.end > from || (e.end === e.start && e.start >= from)))
        .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
      const head = document.createElement("div");
      head.className = "day";
      head.textContent = d === 0 ? "Today" : "Tomorrow";
      const rows = [];
      for (const e of mine) {
        if (used < max) { rows.push(row(e, o, nowMs)); used++; } else hidden++;
      }
      list.append(head);
      if (!mine.length) {
        const none = document.createElement("div");
        none.className = "ev";
        none.innerHTML = '<div class="what"><div class="title"></div></div>';
        none.querySelector(".title").textContent = "Nothing planned";
        none.style.opacity = 0.6;
        list.append(none);
      } else list.append(...rows);
    }
    // Drop whole rows that do not fit instead of showing a clipped one.
    const evs = () => [...list.querySelectorAll(".ev")];
    const more = document.createElement("div");
    more.className = "more num";
    list.append(more);
    while (list.scrollHeight > list.clientHeight + 1 && evs().length > 1) {
      const last = evs().pop();
      last.remove(); hidden++;
      if (!more.textContent) more.textContent = " ";
    }
    if (hidden) more.textContent = `+${hidden} more`; else more.remove();
  }

  async function load() {
    const raw = (umbra.options.url || "").trim();
    if (raw.toLowerCase() === "demo") { icsText = demoCalendar(); stale = false; error = ""; return; }
    const r = resolveUrl(raw);
    if (r.error) { icsText = null; stale = false; error = r.error; return; }
    try {
      const text = await umbra.fetchText(r.url);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not an iCal file");
      icsText = text; stale = false; error = "";
      umbra.store.set("ics", { url: r.url, text }).catch(() => {});
    } catch (e) {
      stale = true;
      if (icsText == null) {
        const c = await umbra.store.get("ics", null);
        if (c && c.url === r.url) icsText = c.text;
      }
      if (icsText == null) { stale = false; error = "Could not load the calendar. Check the address."; }
    }
  }

  umbra.every(async () => {
    await load();
    render();
    if (first) { first = false; umbra.rendered(); }
  });
  let lastUrl = umbra.options.url;
  umbra.onSettings(async () => {
    if (umbra.options.url !== lastUrl) { lastUrl = umbra.options.url; icsText = null; await load(); }
    render();
  });
  // Keep "now" fresh between refreshes.
  setInterval(() => { if (icsText != null) render(); }, 60000);
})();
