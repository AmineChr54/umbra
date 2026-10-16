const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const $ = (id) => document.getElementById(id);

// WMO weather codes -> [label, icon kind]
function describe(code) {
  if (code === 0) return ["Clear", "sun"];
  if (code === 1) return ["Mostly clear", "sun"];
  if (code === 2) return ["Partly cloudy", "part"];
  if (code === 3) return ["Overcast", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return ["Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorm", "storm"];
  return ["Unknown", "cloud"];
}

function rays(cx, cy, r1, r2) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, c = Math.cos(a), n = Math.sin(a);
    s += `M${(cx + c * r1).toFixed(1)} ${(cy + n * r1).toFixed(1)}L${(cx + c * r2).toFixed(1)} ${(cy + n * r2).toFixed(1)}`;
  }
  return s;
}
const cloud = (dy) =>
  `<path class="cloud" d="M13 ${34 + dy}a8 8 0 0 1 1.5-15.9A10 10 0 0 1 34 ${19 + dy}a7.5 7.5 0 0 1-1 15z"/>`;

function icon(kind, day) {
  const sun = day
    ? `<circle class="sun" cx="24" cy="24" r="8"/><path class="sun" d="${rays(24, 24, 13, 18)}"/>`
    : '<path class="moon" d="M30 9a15 15 0 1 0 9 26A15 15 0 0 1 30 9z"/>';
  switch (kind) {
    case "sun": return sun;
    case "part": return (day
      ? `<circle class="sun" cx="16" cy="15" r="5.5"/><path class="sun" d="${rays(16, 15, 9, 12.5)}"/>`
      : '<path class="moon" d="M19 5a9 9 0 1 0 6 16A9 9 0 0 1 19 5z"/>') +
      '<path class="cloud" d="M15 40a7 7 0 0 1 1.3-13.9A9 9 0 0 1 34 27a6.5 6.5 0 0 1-1 13z"/>';
    case "cloud": return cloud(2);
    case "fog": return '<path class="cloud" d="M10 16h28M6 24h36M10 32h28M16 40h16"/>';
    case "rain": return cloud(-6) + '<path class="rain" d="M15 36l-2 6M24 36l-2 6M33 36l-2 6"/>';
    case "snow": return cloud(-6) + '<path class="snow" d="M15 37v.1M24 41v.1M33 37v.1M19.5 43v.1M28.5 43v.1"/>';
    case "storm": return cloud(-6) + '<path class="bolt" d="M25 30l-5 7h6l-3 8"/>';
  }
  return "";
}

let last = null; // last good render model
let loadedKey = null;
const keyOf = () => `${String(umbra.options.city || "").trim()}|${umbra.options.units}`;

async function locate(city) {
  const cache = await umbra.store.get("geo", null);
  if (cache && cache.query === city) return cache;
  const g = await umbra.fetchJson(`${GEO}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  const r = g.results && g.results[0];
  if (!r) return null;
  const geo = { query: city, name: r.name, country: r.country_code || "", lat: r.latitude, lon: r.longitude };
  await umbra.store.set("geo", geo);
  return geo;
}

function message(text) {
  $("msg").textContent = text;
  $("msg").hidden = false;
  $("app").hidden = true;
}

function render(m, stale) {
  const t = (v) => `${Math.round(v)}°`;
  const [label, kind] = describe(m.code);
  $("city").textContent = m.place;
  $("stale").hidden = !stale;
  $("temp").textContent = t(m.temp);
  $("cond").textContent = label;
  $("icon").innerHTML = icon(kind, m.day);
  $("hl").textContent = `H ${t(m.hi)}  L ${t(m.lo)}`;
  $("feels").textContent = umbra.options.feelsLike ? `Feels like ${t(m.feels)}` : "";
  $("msg").hidden = true;
  $("app").hidden = false;
}

async function load() {
  const o = umbra.options;
  const city = String(o.city || "").trim();
  const key = keyOf();
  loadedKey = key;
  if (!city) { message("Set a city in the widget options"); return umbra.rendered(); }
  try {
    const geo = await locate(city);
    if (!geo) { message(`No city found for "${city}"`); return umbra.rendered(); }
    const q = `latitude=${geo.lat}&longitude=${geo.lon}` +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day" +
      "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto" +
      (o.units === "f" ? "&temperature_unit=fahrenheit" : "");
    const w = await umbra.fetchJson(`${FORECAST}?${q}`);
    last = {
      key,
      place: geo.country ? `${geo.name}, ${geo.country}` : geo.name,
      temp: w.current.temperature_2m, feels: w.current.apparent_temperature,
      code: w.current.weather_code, day: !!w.current.is_day,
      hi: w.daily.temperature_2m_max[0], lo: w.daily.temperature_2m_min[0],
    };
    render(last, false);
  } catch (e) {
    if (last && last.key === key) render(last, true);
    else message("Can't reach the weather service");
  }
  umbra.rendered();
}

umbra.every(load);
umbra.onSettings(() => {
  if (loadedKey !== null && keyOf() !== loadedKey) load();
  else if (last) render(last, false);
});
