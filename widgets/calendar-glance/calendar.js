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
    const at = k => ics(new Date(now.getFullYear(), now.getMonth(), now.getDate() + k));
    const e = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
    return ["BEGIN:VCALENDAR", "VERSION:2.0",
      e([`DTSTART;VALUE=DATE:${t}`, `DTEND;VALUE=DATE:${n}`, "SUMMARY:Project week"]),
      e([`DTSTART:${t}T090000`, "SUMMARY:Stand-up", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "LOCATION:Room 4"]),
      e([`DTSTART:${t}T120000`, `DTEND:${t}T130000`, "SUMMARY:Lunch with Sam", "LOCATION:Cafe Einstein"]),
      e([`DTSTART:${t}T150000`, `DTEND:${t}T163000`, "SUMMARY:Design review", "LOCATION:Video call"]),
      e([`DTSTART:${n}T100000`, `DTEND:${n}T110000`, "SUMMARY:Dentist"]),
      e([`DTSTART:${n}T140000`, `DTEND:${n}T150000`, "SUMMARY:Sprint planning", "RRULE:FREQ=WEEKLY"]),
      e([`DTSTART:${at(3)}T180000`, `DTEND:${at(3)}T200000`, "SUMMARY:Climbing", "LOCATION:Boulder hall"]),
      e([`DTSTART:${at(5)}T110000`, `DTEND:${at(5)}T120000`, "SUMMARY:Quarterly review", "LOCATION:Video call"]),
      e([`DTSTART:${at(12)}T093000`, `DTEND:${at(12)}T103000`, "SUMMARY:Dentist follow-up"]),
      e([`DTSTART;VALUE=DATE:${at(20)}`, `DTEND;VALUE=DATE:${at(21)}`, "SUMMARY:Team offsite"]),
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

  /** Step-by-step: where to find the private .ics link in each supported calendar (b = bold UI label). */
  const GUIDES = [
    { name: "Google", steps: [
      "Open <b>calendar.google.com</b> on a computer (the phone app can't show it).",
      "Click the <b>gear</b>, then <b>Settings</b>.",
      "Under <b>Settings for my calendars</b>, pick the calendar.",
      "Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.",
      "Paste it into <b>iCal address</b> in this widget's settings."],
      note: "Repeat per calendar. Work/school accounts may hide it (admin setting). Anyone with the link can read the calendar; <b>Reset</b> makes a new one." },
    { name: "Outlook", steps: [
      "Open <b>outlook.office.com</b> or <b>outlook.live.com</b> and click the <b>gear</b>.",
      "Go to <b>Calendar</b>, then <b>Shared calendars</b>.",
      "Under <b>Publish a calendar</b>, pick the calendar and set <b>Can view all details</b>.",
      "Click <b>Publish</b>, then copy the <b>ICS</b> link.",
      "Paste it into <b>iCal address</b>."],
      note: "The link must be on outlook.office365.com or outlook.live.com. Some work accounts block publishing." },
    { name: "Zoho", steps: [
      "Open <b>calendar.zoho.com</b>.",
      "Hover the calendar in the left list and click <b>Share</b> (or the <b>⋯</b> menu).",
      "Choose <b>Private URL</b> and click <b>Create</b> (or <b>Generate</b>).",
      "Copy the <b>ICS</b> link and paste it into <b>iCal address</b>."],
      note: "Use the link that ends in .ics, not the web view link." },
    { name: "Proton", steps: [
      "Open <b>calendar.proton.me</b> and hover the calendar in the sidebar.",
      "Click <b>⋯</b>, then <b>Settings</b> (or open <b>Settings, Calendars</b>).",
      "Under <b>Share outside Proton</b>, click <b>Create link</b> and set access to <b>Full view</b>.",
      "Copy the link and paste it into <b>iCal address</b>."],
      note: "Proton encrypts calendars: only a link created this way can be read from outside." },
    { name: "GitHub", steps: [
      "Put a <code>.ics</code> file in a <b>public</b> repository.",
      "Open the file, click <b>Raw</b>.",
      "Copy the address (it starts with <code>raw.githubusercontent.com</code>).",
      "Paste it into <b>iCal address</b>."],
      note: "Public repo means public calendar. Don't use it for private events." }
  ];
  let guide = 0;

  function renderHelp() {
    const tabs = $("tabs");
    tabs.textContent = "";
    GUIDES.forEach((g, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tab"; b.textContent = g.name;
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(i === guide));
      b.onclick = () => { guide = i; renderHelp(); };
      tabs.append(b);
    });
    const g = GUIDES[guide];
    $("steps").innerHTML = g.steps.map(s => `<li>${s}</li>`).join("");
    $("note").innerHTML = g.note + " Tip: <code>webcal://</code> links work too.";
    $("steps").scrollTop = 0;
  }
  function toggleHelp(show) {
    $("help").hidden = !show;
    if (show) renderHelp();
  }
  $("info").onclick = () => toggleHelp(true);
  $("helpClose").onclick = () => toggleHelp(false);
  document.addEventListener("keydown", e => { if (e.key === "Escape") toggleHelp(false); });

  const RANGES = { "1": 1, "3": 3, "7": 7, "30": 30 };
  const RANGE_TEXT = { 1: "today", 3: "the next 3 days", 7: "the next week", 30: "the next month" };
  /**
   * Migration: installs from before `lookAhead` have `showTomorrow: false` saved and get lookAhead's default "7".
   * They keep 1 day until the user picks a look-ahead themselves (then `legacyOneDay` is cleared and remembered).
   */
  let legacyOneDay = umbra.options.showTomorrow === false;
  let lastLook = umbra.options.lookAhead;
  umbra.store.get("lookMigrated", false).then(v => { if (v) { legacyOneDay = false; render(); } }).catch(() => {});
  function lookDays(o) {
    if (legacyOneDay && String(o.lookAhead) === "7") return 1;
    return RANGES[String(o.lookAhead)] || 7;
  }
  function dayLabel(d, from) {
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    return new Date(from).toLocaleDateString(umbra.locale, { weekday: "short", day: "numeric", month: "short" });
  }

  function render() {
    const o = umbra.options, now = new Date(), nowMs = now.getTime();
    const y = now.getFullYear(), m = now.getMonth(), dd = now.getDate();
    const dayStart = new Date(y, m, dd).getTime();
    const days = lookDays(o);
    const dayEnd = new Date(y, m, dd + days).getTime();
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
    const max = Math.max(1, Math.min(40, Number(o.maxRows) || 8));
    let used = 0, hidden = 0;
    for (let d = 0; d < days; d++) {
      const from = new Date(y, m, dd + d).getTime();
      const to = new Date(y, m, dd + d + 1).getTime();
      const mine = events.filter(e => e.start < to && (e.end > from || (e.end === e.start && e.start >= from)))
        .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
      if (!mine.length) continue; // empty days are skipped
      const head = document.createElement("div");
      head.className = "day";
      head.textContent = dayLabel(d, from);
      const rows = [];
      for (const e of mine) {
        if (used < max) { rows.push(row(e, o, nowMs)); used++; } else hidden++;
      }
      if (rows.length) list.append(head, ...rows);
    }
    if (!list.firstChild && !hidden) {
      const none = document.createElement("div");
      none.className = "empty";
      none.textContent = "Nothing planned " + (days === 1 ? "today" : "in " + RANGE_TEXT[days]);
      list.append(none);
      return;
    }
    // Drop whole rows that do not fit instead of showing a clipped one (and any day heading left empty).
    const evs = () => [...list.querySelectorAll(".ev")];
    const more = document.createElement("div");
    more.className = "more num";
    list.append(more);
    while (list.scrollHeight > list.clientHeight + 1 && evs().length > 1) {
      evs().pop().remove(); hidden++;
      if (!more.textContent) more.textContent = " ";
      const heads = list.querySelectorAll(".day");
      const lastHead = heads[heads.length - 1];
      if (lastHead && lastHead.nextElementSibling === more) lastHead.remove();
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
    if (umbra.options.lookAhead !== lastLook) {
      lastLook = umbra.options.lookAhead;
      if (legacyOneDay) { legacyOneDay = false; umbra.store.set("lookMigrated", true).catch(() => {}); }
    }
    if (umbra.options.url !== lastUrl) { lastUrl = umbra.options.url; icsText = null; await load(); }
    render();
  });
  umbra.onTimeChanged?.(() => { if (icsText != null) render(); }); // time zone or clock changed: re-lay out the day
  // Keep "now" fresh between refreshes.
  setInterval(() => { if (icsText != null) render(); }, 60000);
})();
