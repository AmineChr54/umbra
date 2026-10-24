// Prayer Times setup screen helpers and the one-time migration from widget options (#228).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../../widgets/prayer-times/data/places.js");

const zero = { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };

test("legacyConfig adopts the 1.0 options of a Berlin user", () => {
  const old = {
    city: " Berlin ", country: "Germany", method: "3", school: "0", timeFormat: "auto", hijri: true,
    adjustFajr: 0, adjustDhuhr: 2, adjustAsr: 0, adjustMaghrib: -1, adjustIsha: 0,
    iqamaFajr: 20, iqamaDhuhr: 0, iqamaAsr: 0, iqamaMaghrib: 5, iqamaIsha: 0, notify: false,
  };
  assert.deepEqual(P.legacyConfig(old), {
    city: "Berlin", country: "Germany", cc: "DE", method: "auto", school: 0,
    offsets: { adjust: { ...zero, Dhuhr: 2, Maghrib: -1 }, iqama: { ...zero, Fajr: 20, Maghrib: 5 } },
  });
});

test("legacyConfig keeps a method someone picked, in 1.0 (method) or 1.1 (calcMethod)", () => {
  assert.equal(P.legacyConfig({ city: "Tunis", country: "TN", method: "3" }).method, "auto");
  assert.equal(P.legacyConfig({ city: "Ankara", country: "Turkey", method: "13" }).method, "13");
  assert.equal(P.legacyConfig({ city: "Sfax", country: "Tunisia", method: "3", calcMethod: "auto" }).method, "auto");
  assert.equal(P.legacyConfig({ city: "Sfax", country: "Tunisia", method: "3", calcMethod: "18" }).method, "18");
  assert.equal(P.legacyConfig({ city: "Sfax", country: "Tunisia", method: "auto", calcMethod: "auto" }).method, "auto");
  assert.equal(P.legacyConfig({ city: "Sfax", country: "Tunisia", method: "junk" }).method, "auto");
  assert.equal(P.legacyConfig({ city: "Paris", country: "France", school: "1" }).school, 1);
  assert.equal(P.legacyConfig({ city: "", country: "Germany" }), null);
  assert.equal(P.legacyConfig({}), null);
  assert.equal(P.legacyConfig(null), null);
});

test("cleanOffsets clamps and fills every prayer", () => {
  assert.deepEqual(P.cleanOffsets(null), { adjust: zero, iqama: zero });
  const o = P.cleanOffsets({ adjust: { Fajr: "-45", Isha: 7.4 }, iqama: { Asr: 200, Dhuhr: -3, Maghrib: "x" } });
  assert.deepEqual(o.adjust, { ...zero, Fajr: -30, Isha: 7 });
  assert.deepEqual(o.iqama, { ...zero, Asr: 90 });
});

test("resolveMethod: auto follows the country, a number overrides it", () => {
  assert.equal(P.resolveMethod("auto", "TN"), 18);
  assert.equal(P.resolveMethod(undefined, "DE"), 3);
  assert.equal(P.resolveMethod("13", "TN"), 13);
  assert.equal(P.methodName(18), "Tunisia");
  assert.equal(new Set(P.METHODS.map(([n]) => n)).size, P.METHODS.length);
});

test("searchCountries ranks name prefixes first", () => {
  assert.equal(P.searchCountries("tun")[0].code, "TN");
  assert.equal(P.searchCountries("germ")[0].code, "DE");
  assert.ok(P.searchCountries("kingdom").some((c) => c.code === "GB"));
  assert.equal(P.searchCountries("uk")[0].code, "UA"); // "Ukraine" starts with "uk"; the alias is still offered
  assert.ok(P.searchCountries("uk").some((c) => c.code === "GB"));
  assert.ok(P.searchCountries("a").length <= 6);
  assert.deepEqual(P.searchCountries(""), []);
});

test("searchPresets lists Tunisian governorates, filtered by prefix", () => {
  assert.equal(P.searchPresets("TN", "").length, 24);
  assert.deepEqual(P.searchPresets("TN", "s").map((p) => p.name), ["Siliana", "Sousse", "Sfax", "Sidi Bouzid"]);
  assert.deepEqual(P.searchPresets("TN", "kef").map((p) => p.name), ["Le Kef"]);
  const sfax = P.searchPresets("TN", "sfa")[0];
  assert.deepEqual(sfax, { name: "Sfax", region: "", country: "Tunisia", cc: "TN", lat: 34.7406, lon: 10.7603, tz: "Africa/Tunis" });
  assert.deepEqual(P.searchPresets("DE", ""), []);
});
