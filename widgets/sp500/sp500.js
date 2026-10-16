// S&P 500 widget: fetch, compute, render.
const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), label: $("label"), ticker: $("ticker"), market: $("market"),
  price: $("price"), pct: $("pct"), chg: $("chg"),
  chart: $("chart"), svg: $("svg"), line: $("line"), area: $("area"), ref: $("ref"),
  dot: $("dot"), halo: $("halo"), cross: $("cross"), hoverDot: $("hoverDot"), tip: $("tip"),
  updated: $("updated"), range: $("range"),
};

let shownPrice = NaN;      // what the price counter currently displays (for the tween)
let current = null;        // last good data set
let drawnOnce = false;
let lastKey = "";          // symbol+range of the drawn chart; a change replays the draw-in

const RANGES = { "1d": { interval: "5m", label: "1D", delta: "today" }, "5d": { interval: "15m", label: "5D", delta: "5 days" } };

function autoName(label, symbol) {
  if (symbol === "^GSPC") return label || "S&P 500";
  return label === "S&P 500" ? "" : label;
}

function opts() {
  const o = umbra.options;
  return {
    symbol: (o.symbol || "^GSPC").trim().toUpperCase(),
    // An empty label (or the old "S&P 500" default saved with another symbol) means "name it after the symbol".
    label: autoName((o.label || "").trim(), (o.symbol || "^GSPC").trim().toUpperCase()),
    range: RANGES[o.range] ? o.range : "1d",
  };
}

function url({ symbol, range }) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${RANGES[range].interval}`;
}

async function load() {
  const o = opts();
  el.label.textContent = o.label || o.symbol;
  el.ticker.textContent = o.symbol;
  el.range.textContent = RANGES[o.range].label;

  try {
    const json = await umbra.fetchJson(url(o));
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    if (!r) throw new Error((json && json.chart && json.chart.error && json.chart.error.description) || "No data");

    const meta = r.meta;
    if (!o.label) el.label.textContent = meta.shortName || meta.longName || o.symbol;
    const quote = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const samples = Chart.samples(r.timestamp || [], quote.close || []);
    const period = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;

    current = {
      key: `${o.symbol}|${o.range}`,
      price: meta.regularMarketPrice,
      prev: meta.chartPreviousClose,
      samples,
      open: !!period && Date.now() / 1000 >= period.start && Date.now() / 1000 < period.end,
      deltaLabel: RANGES[o.range].delta,
      fetchedAt: new Date(),
    };
    el.card.classList.remove("stale");
    render();
  } catch (err) {
    el.card.classList.add("stale");
    el.updated.textContent = current ? `Offline, retrying  ·  last ${time(current.fetchedAt)}` : `Can't load ${o.symbol}: ${err.message}`;
  }
}

function time(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function render() {
  const d = current;
  if (!d || typeof d.price !== "number" || typeof d.prev !== "number") return;

  // change math: absolute, percent, direction
  const change = d.price - d.prev;
  const pct = d.prev !== 0 ? (change / d.prev) * 100 : 0;
  const trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  el.card.dataset.trend = trend;

  umbra.tween(shownPrice, d.price, 700, (v) => (el.price.textContent = umbra.fmt(v)));
  shownPrice = d.price;
  el.pct.textContent = `${sign}${umbra.fmt(Math.abs(pct))}%`;
  el.chg.textContent = `${sign}${umbra.fmt(Math.abs(change))} ${d.deltaLabel}`;

  el.market.classList.toggle("open", d.open);
  el.market.querySelector("span").textContent = d.open ? "Market open" : "Closed";
  el.updated.textContent = `Updated ${time(d.fetchedAt)}`;

  drawChart();
  window.chrome?.webview?.postMessage({ type: "rendered" });
}

let geometry = null;

function drawChart() {
  const d = current;
  if (!d || d.samples.length < 2) return;
  const w = el.chart.clientWidth, h = el.chart.clientHeight;
  el.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const values = Chart.denoise(d.samples.map((s) => s.v));
  const inset = 18; // keep the line clear of the rounded window edges
  const { points, refY } = Chart.project(values, d.prev, w - inset * 2, h);
  points.forEach((p) => (p.x += inset));
  const line = Chart.smoothPath(points);

  el.line.setAttribute("d", line);
  el.area.setAttribute("d", Chart.areaPath(line, points, h));
  for (const [k, v] of Object.entries({ x1: inset, x2: w - inset, y1: refY, y2: refY })) el.ref.setAttribute(k, v);

  const last = points[points.length - 1];
  for (const c of [el.dot, el.halo]) { c.setAttribute("cx", last.x); c.setAttribute("cy", last.y); }

  // Draw-in animation the first time (and whenever symbol/range changes). Chromium pauses
  // animations in covered windows, so only animate when the widget is actually visible.
  const visible = document.visibilityState === "visible" && document.documentElement.dataset.motion !== "off";
  if (visible && (!drawnOnce || lastKey !== d.key)) {
    const len = el.line.getTotalLength();
    el.line.style.strokeDasharray = `${len}`;
    el.line.style.strokeDashoffset = `${len}`;
    el.line.classList.remove("draw");
    void el.line.getBoundingClientRect();
    el.line.classList.add("draw");
    el.line.addEventListener("animationend", () => {
      el.line.style.strokeDasharray = "";
      el.line.style.strokeDashoffset = "";
      el.line.classList.remove("draw");
    }, { once: true });
    drawnOnce = true;
    lastKey = d.key;
  }
  el.chart.classList.add("ready");
  geometry = { points, w, h };
}

// hover: crosshair + tooltip on the nearest sample
el.chart.addEventListener("pointermove", (e) => {
  if (!geometry || !current) return;
  const rect = el.chart.getBoundingClientRect();
  const i = Chart.nearest(geometry.points, e.clientX - rect.left);
  const p = geometry.points[i], s = current.samples[i];
  el.cross.setAttribute("x1", p.x); el.cross.setAttribute("x2", p.x);
  el.cross.setAttribute("y1", 0); el.cross.setAttribute("y2", geometry.h);
  el.hoverDot.setAttribute("cx", p.x); el.hoverDot.setAttribute("cy", p.y);
  const when = new Date(s.t * 1000);
  const label = opts().range === "1d" ? time(when) : `${when.toLocaleDateString([], { weekday: "short" })} ${time(when)}`;
  el.tip.innerHTML = `<b>${label}</b>${umbra.fmt(s.v)}`;
  const half = el.tip.offsetWidth / 2 + 6;
  el.tip.style.left = `${Math.min(geometry.w - half, Math.max(half, p.x))}px`;
  el.chart.classList.add("hover");
});
el.chart.addEventListener("pointerleave", () => el.chart.classList.remove("hover"));

// click (not drag) opens the full chart
el.card.addEventListener("click", (e) => {
  if (e.detail === 2) umbra.openUrl(`https://finance.yahoo.com/quote/${encodeURIComponent(opts().symbol)}`);
});

new ResizeObserver(() => current && drawChart()).observe(el.chart);
umbra.onSettings(() => load());
umbra.every(load);
