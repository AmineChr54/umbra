(() => {
  const API = "https://v6.bvg.transport.rest";
  const $ = id => document.getElementById(id);
  let data = null;      // last good { stopName, deps: [{ when, planned, delay, line, product, direction, cancelled }] }
  let stale = false;
  let error = "";
  let first = true;

  const shortName = n => (n || "").replace(/\s*\(Berlin\)\s*$/i, "").replace(/^S\+U\s+/, "");

  async function resolveStop(query) {
    if (/^\d{6,}$/.test(query)) return { id: query, name: "" };
    const cache = await umbra.store.get("stops", {});
    if (cache[query]) return cache[query];
    const r = await umbra.fetchJson(`${API}/locations?query=${encodeURIComponent(query)}&results=1&stops=true&addresses=false&poi=false`);
    const s = Array.isArray(r) && r.find(x => x.type === "stop" && x.id);
    if (!s) throw Object.assign(new Error("no stop"), { notFound: true });
    const hit = { id: s.id, name: s.name };
    cache[query] = hit;
    umbra.store.set("stops", cache).catch(() => {});
    return hit;
  }

  async function load() {
    const query = String(umbra.options.stop || "").trim();
    if (!query) { data = null; stale = false; error = "Set a stop in Settings."; return; }
    try {
      const stop = await resolveStop(query);
      const r = await umbra.fetchJson(`${API}/stops/${encodeURIComponent(stop.id)}/departures?duration=90&results=60`);
      const list = Array.isArray(r) ? r : r.departures || [];
      data = {
        key: query,
        stopName: shortName(stop.name),
        deps: list.map(d => ({
          when: Date.parse(d.when || d.plannedWhen || ""),
          delay: Math.round((d.delay || 0) / 60),
          line: d.line && d.line.name || "?",
          product: d.line && d.line.product || "",
          direction: shortName(d.direction || ""),
          cancelled: !!d.cancelled,
        })).filter(d => !Number.isNaN(d.when)),
      };
      stale = false; error = "";
      umbra.store.set("last", data).catch(() => {});
    } catch (e) {
      if (e && e.notFound) { data = null; stale = false; error = `No stop found for "${query}".`; return; }
      stale = true;
      if (!data || data.key !== query) {
        const c = await umbra.store.get("last", null);
        data = c && c.key === query ? c : null;
      }
      if (!data) { stale = false; error = "Could not load departures. Check your connection."; }
    }
  }

  function render() {
    const o = umbra.options, now = Date.now();
    const walk = Math.max(0, Number(o.walk) || 0);
    const rows = Math.max(1, Math.min(10, Number(o.rows) || 7));
    const wanted = String(o.lines || "").split(",").map(s => s.trim().toLowerCase().replace(/\s+/g, "")).filter(Boolean);
    $("stale").hidden = !stale;
    const list = $("list");
    list.textContent = "";
    if (!data) {
      const m = document.createElement("div");
      m.className = "msg";
      m.textContent = error || "Loading";
      list.append(m);
      $("stop").textContent = "Departures";
      return;
    }
    $("stop").textContent = data.stopName || String(o.stop);
    const deps = data.deps
      .filter(d => d.when > now - 30000 && (!wanted.length || wanted.includes(d.line.toLowerCase().replace(/\s+/g, ""))))
      .sort((a, b) => a.when - b.when)
      .slice(0, rows);
    if (!deps.length) {
      const m = document.createElement("div");
      m.className = "msg";
      m.textContent = wanted.length ? "No matching departures soon." : "No departures soon.";
      list.append(m);
      return;
    }
    for (const d of deps) {
      const mins = Math.max(0, Math.round((d.when - now) / 60000));
      const el = document.createElement("div");
      el.className = "dep" + (d.cancelled ? " cancelled" : d.delay >= 2 ? " late" : "") + (walk && mins < walk ? " gone" : "");
      const badge = document.createElement("div");
      badge.className = "line " + d.product;
      badge.textContent = d.line;
      const dir = document.createElement("div");
      dir.className = "dir";
      dir.textContent = d.direction;
      const min = document.createElement("div");
      min.className = "min num";
      if (d.cancelled) min.textContent = "cancelled";
      else {
        min.textContent = mins === 0 ? "now" : `${mins} min`;
        if (d.delay >= 2) { const s = document.createElement("small"); s.textContent = `+${d.delay}`; min.append(s); }
      }
      el.append(badge, dir, min);
      list.append(el);
    }
  }

  umbra.every(async () => {
    await load();
    render();
    if (first) { first = false; umbra.rendered(); }
  });
  let lastStop = umbra.options.stop;
  umbra.onSettings(async () => {
    if (umbra.options.stop !== lastStop) { lastStop = umbra.options.stop; data = null; await load(); }
    render();
  });
  // Count down between refreshes (the API is only asked every refresh interval).
  setInterval(() => { if (data) render(); }, 30000);
})();
