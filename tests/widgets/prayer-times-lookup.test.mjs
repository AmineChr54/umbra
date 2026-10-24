// Prayer Times lookup: country -> method table, Tunisia presets, request builders and error classes (#227).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../../widgets/prayer-times/times.js");
const P = require("../../widgets/prayer-times/data/places.js");

test("findCountry accepts names, ISO codes and common aliases", () => {
  assert.equal(P.findCountry("Tunisia"), "TN");
  assert.equal(P.findCountry(" tn "), "TN");
  assert.equal(P.findCountry("Tunisie"), "TN");
  assert.equal(P.findCountry("Germany"), "DE");
  assert.equal(P.findCountry("UK"), "GB");
  assert.equal(P.findCountry("United Kingdom"), "GB");
  assert.equal(P.findCountry("Türkiye"), "TR");
  assert.equal(P.findCountry("Atlantis"), null);
  assert.equal(P.findCountry(""), null);
  assert.equal(P.countryName("TN"), "Tunisia");
  assert.ok(P.countries().length > 200);
});

test("methodFor picks the country's regional method, MWL elsewhere", () => {
  assert.equal(P.methodFor("TN"), 18);
  assert.equal(P.methodFor("tn"), 18);
  assert.equal(P.methodFor("DZ"), 19);
  assert.equal(P.methodFor("MA"), 21);
  assert.equal(P.methodFor("TR"), 13);
  assert.equal(P.methodFor("FR"), 12);
  assert.equal(P.methodFor("US"), 2);
  assert.equal(P.methodFor("DE"), 3);
  assert.equal(P.methodFor(null), 3);
  for (const [cc, m] of Object.entries(P.METHOD_BY_COUNTRY)) {
    assert.ok(P.CODES.includes(cc), `${cc} is a known country`);
    assert.ok(Number.isInteger(m) && m >= 0 && m <= 23, `${cc} has a real Aladhan method`);
  }
});

test("Tunisia has 24 governorate presets that match loose spellings", () => {
  assert.equal(P.TUNISIA.length, 24);
  for (const g of P.TUNISIA) {
    assert.ok(g.lat > 30 && g.lat < 38 && g.lon > 7 && g.lon < 12, `${g.name} is inside Tunisia`);
    assert.equal(g.tz, "Africa/Tunis");
  }
  assert.equal(P.findPreset("TN", "sfax").name, "Sfax");
  assert.equal(P.findPreset("TN", "Gabes").name, "Gabès");
  assert.equal(P.findPreset("TN", "El Kef").name, "Le Kef");
  assert.equal(P.findPreset("TN", "Gouvernorat de Sousse").name, "Sousse");
  assert.equal(P.findPreset("TN", "Hammamet"), null);
  assert.equal(P.findPreset("DE", "Tunis"), null);
});

test("calendarUrl requests by coordinates with method, school and zone", () => {
  const u = new URL(T.calendarUrl(2026, 10, { lat: 34.74056, lon: 10.76028, tz: "Africa/Tunis" }, 18, 0));
  assert.equal(u.origin + u.pathname, "https://api.aladhan.com/v1/calendar/2026/10");
  assert.equal(u.searchParams.get("latitude"), "34.7406");
  assert.equal(u.searchParams.get("longitude"), "10.7603");
  assert.equal(u.searchParams.get("method"), "18");
  assert.equal(u.searchParams.get("school"), "0");
  assert.equal(u.searchParams.get("timezonestring"), "Africa/Tunis");
  const v = new URL(T.calendarUrl(2026, 1, { lat: -33.9, lon: 18.4, tz: "Not/AZone" }, "x", 7));
  assert.equal(v.searchParams.get("method"), "3");
  assert.equal(v.searchParams.get("school"), "1");
  assert.equal(v.searchParams.has("timezonestring"), false);
});

test("geocodeUrl and parseGeocode", () => {
  const u = new URL(T.geocodeUrl(" Berlin ", "de"));
  assert.equal(u.host, "geocoding-api.open-meteo.com");
  assert.equal(u.searchParams.get("name"), "Berlin");
  assert.equal(u.searchParams.get("countryCode"), "DE");
  assert.equal(new URL(T.geocodeUrl("Berlin", null)).searchParams.has("countryCode"), false);
  const json = { results: [
    { name: "Birmingham Airport", latitude: 52.45, longitude: -1.74, country_code: "GB", country: "United Kingdom", timezone: "Europe/London", feature_code: "AIRP" },
    { name: "Birmingham", latitude: 33.52, longitude: -86.8, country_code: "US", country: "United States", timezone: "America/Chicago", feature_code: "PPLA2" },
    { name: "Birmingham", latitude: 52.48, longitude: -1.89, country_code: "GB", country: "United Kingdom", admin1: "England", timezone: "Europe/London", feature_code: "PPLA2" },
    { name: "Broken", latitude: "x", longitude: 1 },
  ] };
  const gb = T.parseGeocode(json, "GB");
  assert.deepEqual(gb.map((r) => r.name), ["Birmingham", "Birmingham Airport"]);
  assert.deepEqual(gb[0], { name: "Birmingham", region: "England", country: "United Kingdom", cc: "GB", lat: 52.48, lon: -1.89, tz: "Europe/London" });
  assert.equal(T.parseGeocode(json, null).length, 3);
  assert.deepEqual(T.parseGeocode({ generationtime_ms: 1 }, "DE"), []);
  assert.deepEqual(T.parseGeocode(null), []);
});

test("classifyError tells each failure apart", () => {
  const E = (m) => new Error(m);
  assert.deepEqual(T.classifyError(E("Response status code does not indicate success: 429 (Too Many Requests)."), true), { kind: "rate", status: 429 });
  assert.deepEqual(T.classifyError(E("Response status code does not indicate success: 503 (Service Unavailable)."), true), { kind: "http", status: 503 });
  assert.deepEqual(T.classifyError(E("Response status code does not indicate success: 400 (Bad Request)."), true), { kind: "http", status: 400 });
  assert.deepEqual(T.classifyError(E("No such host is known. (api.aladhan.com:443)"), true), { kind: "offline" });
  assert.deepEqual(T.classifyError(E("Simulated offline"), true), { kind: "offline" });
  assert.deepEqual(T.classifyError(E("anything"), false), { kind: "offline" });
  assert.deepEqual(T.classifyError(E("The request was canceled due to the configured HttpClient.Timeout of 15 seconds elapsing."), true), { kind: "timeout" });
  assert.deepEqual(T.classifyError(E("Timed out"), true), { kind: "timeout" });
  assert.deepEqual(T.classifyError(Object.assign(E("City not found"), { code: "notfound" }), false), { kind: "notfound" });
  assert.equal(T.classifyError(E("The prayer time service sent no time zone"), true).kind, "other");
});

test("errorMessage gives a distinct, actionable sentence per failure", () => {
  const kinds = [{ kind: "offline" }, { kind: "rate", status: 429 }, { kind: "http", status: 503 }, { kind: "http", status: 400 }, { kind: "timeout" }, { kind: "notfound" }, { kind: "other" }];
  const texts = kinds.map((e) => T.errorMessage(e, { retryAt: "14:05", city: "Atlantis", country: "Germany" }));
  assert.equal(new Set(texts).size, texts.length);
  assert.equal(texts[0], "You're offline. Prayer times will load when you're back online.");
  assert.equal(texts[1], "Rate limited by the prayer time service. Retrying at 14:05.");
  assert.match(texts[2], /HTTP 503.*14:05/);
  assert.match(texts[3], /HTTP 400.*Check the widget options/);
  assert.equal(texts[5], 'City not found: "Atlantis" in Germany. Check the spelling in the widget options.');
  assert.match(T.errorMessage({ kind: "http", status: 502 }, { service: "City search" }), /^City search is having trouble \(HTTP 502\)/);
  assert.equal(T.errorLabel({ kind: "http", status: 503 }), "HTTP 503");
});
