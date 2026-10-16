// Crypto price widget: one CoinGecko /coins/markets call gives price, 24h change, market cap and a 7-day hourly sparkline.
const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), name: $("name"), ticker: $("ticker"), cap: $("cap"),
  price: $("price"), pct: $("pct"), chg: $("chg"),
  chart: $("chart"), svg: $("svg"), line: $("line"), area: $("area"), ref: $("ref"),
  dot: $("dot"), halo: $("halo"), updated: $("updated"), range: $("range"),
};

const RANGES = { "24h": { label: "24H", points: 24, delta: "24h" }, "7d": { label: "7D", points: 168, delta: "7 days" } };
const CURRENCIES = ["usd", "eur", "gbp", "chf", "jpy"];

let current = null;   // last good data set
let series = [];      // samples currently charted
let drawnOnce = false;
let lastKey = "";
let shownPrice = NaN;
let renderedOnce = false;

function opts() {
  const o = umbra.options;
  return {
    coin: (o.coin || "bitcoin").trim().toLowerCase(),
    currency: CURRENCIES.includes(o.currency) ? o.currency : "usd",
    range: RANGES[o.range] ? o.range : "24h",
  };
}

const time = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Currency string; small prices get more decimals so they don't read as 0.00. */
function money(v, cur) {
  const digits = cur === "jpy" ? (v < 1 ? 4 : 0) : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

function compact(v, cur) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase(), notation: "compact", maximumFractionDigits: 1 }).format(v);
}

async function load() {
  const o = opts();
  el.range.textContent = RANGES[o.range].label;
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${o.currency}&ids=${encodeURIComponent(o.coin)}&sparkline=true&price_change_percentage=24h`;
  try {
    const json = await umbra.fetchJson(url);
    const c = Array.isArray(json) && json[0];
    if (json && json.status && json.status.error_code === 429) throw new Error("rate limited, retrying");
    if (!c) throw new Error(`unknown coin "${o.coin}"`);
    let all = ((c.sparkline_in_7d && c.sparkline_in_7d.price) || []).filter((v) => typeof v === "number" && isFinite(v));
    // CoinGecko sparklines are always in USD; rescale so the last sample meets the current price in the chosen currency.
    const tail = all[all.length - 1];
    if (o.currency !== "usd" && tail > 0 && c.current_price > 0) all = all.map((v) => (v * c.current_price) / tail);
    current = {
      key: `${o.coin}|${o.currency}|${o.range}`,
      name: c.name, symbol: String(c.symbol || "").toUpperCase(),
      price: c.current_price, change24: c.price_change_24h, pct24: c.price_change_percentage_24h,
      cap: c.market_cap, spark: all, currency: o.currency, range: o.range,
      fetchedAt: new Date(),
    };
    el.card.classList.remove("stale", "empty");
    render();
  } catch (err) {
    el.card.classList.add("stale");
    if (!current) el.card.classList.add("empty");
    if (!current) { el.name.textContent = o.coin; el.ticker.textContent = ""; }
    el.updated.textContent = current ? `Offline, retrying  ·  last ${time(current.fetchedAt)}` : `Can't load: ${err.message}`;
    if (!renderedOnce) { renderedOnce = true; umbra.rendered(); }
  }
}

function render() {
  const d = current;
  if (!d || typeof d.price !== "number") return;
  const r = RANGES[d.range];
  series = d.spark.slice(-r.points);

  // 24h uses the API's own figures; 7d is measured from the first sample of the window.
  let change = 0, pct = 0;
  if (d.range === "24h" && typeof d.change24 === "number" && typeof d.pct24 === "number") {
    change = d.change24; pct = d.pct24;
  } else if (series.length) {
    change = d.price - series[0];
    pct = series[0] !== 0 ? (change / series[0]) * 100 : 0;
  }

  const trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  el.card.dataset.trend = trend;

  el.name.textContent = d.name;
  el.ticker.textContent = d.symbol;
  el.cap.textContent = typeof d.cap === "number" && d.cap > 0 ? `Cap ${compact(d.cap, d.currency)}` : "";
  el.price.classList.toggle("long", money(d.price, d.currency).length > 11);
  umbra.tween(isNaN(shownPrice) ? d.price : shownPrice, d.price, 600, (v) => (el.price.textContent = money(v, d.currency)));
  shownPrice = d.price;
  el.pct.textContent = `${sign}${umbra.fmt(Math.abs(pct))}%`;
  el.chg.textContent = `${sign}${money(Math.abs(change), d.currency)} ${r.delta}`;
  el.updated.textContent = `Updated ${time(d.fetchedAt)}`;

  drawChart();
  if (!renderedOnce) { renderedOnce = true; umbra.rendered(); }
}

function drawChart() {
  const d = current;
  const w = el.chart.clientWidth, h = el.chart.clientHeight;
  if (!d || series.length < 2 || !w) { el.chart.classList.remove("ready"); return; }
  el.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const values = Chart.denoise(series.concat(d.price));
  const inset = 18; // keep the line clear of the rounded window edges
  const { points, refY } = Chart.project(values, series[0], w - inset * 2, h);
  points.forEach((p) => (p.x += inset));
  const line = Chart.smoothPath(points);
  el.line.setAttribute("d", line);
  el.area.setAttribute("d", Chart.areaPath(line, points, h));
  for (const [k, v] of Object.entries({ x1: inset, x2: w - inset, y1: refY, y2: refY })) el.ref.setAttribute(k, v);
  const last = points[points.length - 1];
  for (const c of [el.dot, el.halo]) { c.setAttribute("cx", last.x); c.setAttribute("cy", last.y); }

  // Draw-in the first time and when coin/currency/range changes; only while visible and motion is on.
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
}

// double-click opens the coin page
el.card.addEventListener("click", (e) => {
  if (e.detail === 2) umbra.openUrl(`https://www.coingecko.com/en/coins/${encodeURIComponent(opts().coin)}`);
});

new ResizeObserver(() => drawChart()).observe(el.chart);
umbra.onSettings(() => load());
umbra.every(load);
