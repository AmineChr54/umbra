const rowsEl = document.getElementById("rows"), note = document.getElementById("note");
let data = null, updated = null; // updated: date of the newest ECB rate
const parse = s => [...new Set(String(s || "").toUpperCase().split(/[\s,;]+/).filter(c => /^[A-Z]{3}$/.test(c) && c !== "EUR"))].slice(0, 6);
const day = d => d.toISOString().slice(0, 10);

function spark(vals) {
  if (vals.length < 2) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 100).toFixed(1)},${(22 - (v - lo) / r * 20).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function render() {
  const codes = parse(umbra.options.currencies), dec = Math.max(2, Math.min(6, +umbra.options.decimals || 4));
  if (!codes.length) { rowsEl.innerHTML = '<li class="empty">Pick currencies in the widget options.</li>'; note.textContent = ""; return; }
  rowsEl.innerHTML = codes.map(c => {
    const s = data && data.series[c];
    if (!s || !s.length) return `<li><span class="c">${c}</span><span></span><span class="v num">-</span><span class="d">-</span></li>`;
    const last = s[s.length - 1], pct = (last / s[0] - 1) * 100, cls = Math.abs(pct) < 0.005 ? "" : pct > 0 ? "up" : "down";
    return `<li><span class="c">${c}</span><span class="${cls}">${spark(s)}</span><span class="v num">${umbra.fmt(last, dec)}</span><span class="d num ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(2)}%</span></li>`;
  }).join("");
  note.textContent = updated ? `Rates of ${updated}` : umbra.status?.state === "none" ? "Loading..." : "";
}

async function load() {
  const codes = parse(umbra.options.currencies);
  if (!codes.length) return render();
  const from = new Date(Date.now() - 7 * 864e5);
  try {
    const j = await umbra.fetchJson(`https://api.frankfurter.dev/v1/${day(from)}..?base=EUR&symbols=${codes.join(",")}`);
    const dates = Object.keys(j.rates).sort();
    const series = {};
    for (const c of codes) series[c] = dates.map(d => j.rates[d][c]).filter(v => v != null);
    data = { series };
    updated = dates[dates.length - 1];
    await umbra.store.set("last", { data, updated, at: Date.now() });
  } catch (e) { umbra.status?.failed(e); }
  render();
}

(async () => {
  await umbra.ready;
  const last = await umbra.store.get("last", null);
  if (last) {
    data = last.data; updated = String(last.updated).split(",")[0]; // older saves also held ", checked <time>"
    if (last.at) umbra.status?.ok(new Date(last.at)); // show the saved copy as "last data"
  }
  render();
  umbra.every(async () => { await load(); umbra.rendered(); });
  let prev = umbra.options.currencies;
  umbra.onSettings(() => { if (umbra.options.currencies !== prev) { prev = umbra.options.currencies; load(); } else render(); });
})();
