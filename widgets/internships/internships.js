// Internships widget: speedyapply's INTERN_INTL.md, filtered by region, with unread postings marked.
// Saved in umbra.store: "state" = { items, fetchedAt, known, fresh }
//   items      every parsed posting (so options re-filter offline)
//   known      ids of every posting seen in the list so far (pruned to what's still listed)
//   fresh      ids that appeared since the user last looked ("new"); cleared by clicking a posting or the badge
// Parsing and filtering are in parser.js.

const SOURCE = "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/INTERN_INTL.md";
const SOURCE_PAGE = "https://github.com/speedyapply/2027-SWE-College-Jobs/blob/main/INTERN_INTL.md";
const DAY = 86400000;
const FIRST_RUN_NEW_DAYS = 2;   // on the very first fetch only postings this young count as new
const RETRY_MS = 5 * 60000;     // after a failed fetch, wait this long before trying again
const REGION_LABEL = { emea: "EMEA", europe: "Europe", mea: "Middle East and Africa", all: "All international" };

const $ = (id) => document.getElementById(id);
const listEl = $("list"), metaEl = $("meta"), badgeEl = $("badge"), footEl = $("foot");

let state = null;       // see header
let error = "";         // "", "offline" or "format"
let lastTry = 0;
let loading = true;
let busy = false;

const opts = () => umbra.options;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function loadState() {
  const s = await umbra.store.get("state", null);
  state = s && Array.isArray(s.items) ? { items: s.items, fetchedAt: s.fetchedAt || 0, known: s.known || [], fresh: s.fresh || [] } : null;
}
async function saveState() {
  try { await umbra.store.set("state", state); }
  catch (e) { console.warn("internships: could not save", e); }
}

/** Fetch, parse, and update `state`. Keeps the old data on any failure. */
async function refresh(force) {
  if (busy) return;
  const everyMs = Math.max(1, Number(opts().checkHours) || 3) * 3600000;
  const age = state ? Date.now() - state.fetchedAt : Infinity;
  if (!force && age < everyMs) return;
  if (Date.now() - lastTry < RETRY_MS && state) return;
  busy = true; lastTry = Date.now();
  try {
    const md = await umbra.fetchText(SOURCE);
    const { items, rows, skipped } = InternParser.parse(md);
    // The format check: a table that stopped parsing must not wipe the saved list or mark everything new.
    if (rows < 10 || items.length < 10 || skipped / rows > 0.2) {
      console.warn(`internships: unexpected table format (${rows} rows, ${items.length} parsed, ${skipped} skipped)`);
      error = "format";
      return;
    }
    const now = items.map((i) => i.id);
    const ids = new Set(now);
    const known = new Set(state?.known || []);
    let fresh;
    if (!state || !state.known.length) {
      fresh = items.filter((i) => i.age <= FIRST_RUN_NEW_DAYS).map((i) => i.id);
    } else {
      const arrivals = now.filter((id) => !known.has(id));
      fresh = [...new Set([...(state.fresh || []), ...arrivals])].filter((id) => ids.has(id));
    }
    state = {
      items: items.map(({ id, company, role, loc, more, country, remote, age, url }) => ({ id, company, role, loc, more, country, remote, age, url })),
      fetchedAt: Date.now(), known: now, fresh,
    };
    error = "";
    await saveState();
  } catch (e) {
    console.warn("internships: fetch failed", e);
    error = "offline";
  } finally {
    busy = false;
  }
}

const ageText = (it) => {
  const d = it.age + Math.floor((Date.now() - (state?.fetchedAt || Date.now())) / DAY);
  return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
};

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

function showState(title, body, link) {
  listEl.replaceChildren();
  const box = el("div", "state");
  box.append(el("strong", "", title));
  box.append(document.createTextNode(body));
  if (link) {
    box.append(document.createElement("br"));
    const a = el("a", "", link.text);
    a.dataset.noDrag = "";
    a.addEventListener("click", link.fn);
    box.append(a);
  }
  listEl.append(box);
}

function render() {
  $("title").textContent = opts().title || "Internships";
  footEl.hidden = true; footEl.className = "foot";
  metaEl.className = "meta";

  if (!state) {
    badgeEl.hidden = true;
    if (loading) {
      metaEl.textContent = "Loading";
      listEl.replaceChildren(...[0, 1, 2, 3, 4].map(() => { const s = el("div", "skel"); s.append(el("i"), el("i"), el("i")); return s; }));
    } else if (error === "format") {
      metaEl.textContent = "Can't read the list";
      showState("The list changed shape", "The source's table no longer matches what this widget expects. It will try again later.", { text: "Open the source", fn: () => umbra.openUrl(SOURCE_PAGE) });
    } else {
      metaEl.textContent = "Offline";
      showState("Can't reach GitHub", "Check your connection. Postings will load as soon as it's back.", { text: "Try again", fn: () => reload(true) });
    }
    return;
  }

  const o = opts();
  const matches = InternParser.filter(state.items, o).sort((a, b) => a.age - b.age);
  const fresh = new Set(state.fresh);
  const unread = matches.filter((i) => fresh.has(i.id)).length;
  const max = Math.max(3, Math.min(12, Number(o.maxRows) || 7));

  badgeEl.hidden = unread === 0;
  badgeEl.textContent = `${unread} new`;
  badgeEl.title = "Mark all as read";

  const region = REGION_LABEL[o.region] || "EMEA";
  if (error) {
    metaEl.classList.add("stale");
    metaEl.textContent = error === "format"
      ? `List format changed. Showing ${clock(state.fetchedAt)}`
      : `Offline. Showing ${clock(state.fetchedAt)}`;
  } else {
    metaEl.textContent = `${region} · ${matches.length} posting${matches.length === 1 ? "" : "s"} · checked ${clock(state.fetchedAt)}`;
  }

  if (!matches.length) {
    showState("No postings match", "Try another region or fewer keywords in this widget's settings.");
    return;
  }

  listEl.replaceChildren(...matches.slice(0, max).map((it) => {
    const isNew = fresh.has(it.id);
    const row = el("button", "row" + (isNew ? " new" : ""));
    row.type = "button"; row.dataset.noDrag = ""; row.dataset.id = it.id;
    row.title = `${it.company}: ${it.role}\n${it.loc}${it.more ? ` +${it.more} more` : ""}`;
    const r1 = el("div", "r1");
    r1.append(el("span", "co", it.company), el("span", "age", ageText(it)));
    row.append(el("span", "dot"), r1, el("div", "role", it.role),
      el("div", "loc", it.remote ? `Remote · ${it.loc}` : it.loc + (it.more ? ` +${it.more}` : "")));
    row.addEventListener("click", () => open(it));
    return row;
  }));

  if (matches.length > max) {
    footEl.hidden = false;
    footEl.textContent = `+${matches.length - max} more postings match`;
  }
}

async function open(it) {
  umbra.openUrl(it.url);
  if (state.fresh.includes(it.id)) {
    state.fresh = state.fresh.filter((id) => id !== it.id);
    await saveState();
    render();
  }
}

badgeEl.addEventListener("click", async () => {
  if (!state) return;
  state.fresh = [];
  await saveState();
  render();
});

let first = true;
async function reload(force) {
  if (!state) { loading = true; render(); }
  await refresh(force === true);
  loading = false;
  render();
  if (first) { first = false; umbra.rendered(); }
}

umbra.ready.then(async () => {
  if (!umbra.store || !umbra.fetchText) {
    // Older Umbra has no umbra.store / umbra.fetchText, so the widget can neither fetch the list nor remember what you've seen.
    $("title").textContent = opts().title || "Internships";
    metaEl.textContent = "Needs a newer Umbra";
    listEl.innerHTML = `<div class="state"><strong>Update Umbra</strong>Internships needs a newer Umbra to read the list and remember what you've seen.<br>
      <a data-no-drag id="get-update">Get the latest Umbra</a></div>`;
    $("get-update").addEventListener("click", () => umbra.openUrl("https://github.com/AmineChr54/umbra/releases/latest"));
    umbra.rendered();
    return;
  }
  await loadState();
  if (state) { loading = false; render(); }
  umbra.every(() => reload(false));
  umbra.onSettings(() => { if (!first) render(); });
  umbra.store.onChange(async () => { await loadState(); render(); });
});
