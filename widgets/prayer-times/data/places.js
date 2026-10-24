// Place data for the prayer-times widget: countries (ISO codes, English names from Intl), the regional calculation
// method per country, and Tunisia's 24 governorates so Tunisia works without the geocoder. Pure, no DOM, no network.
// Browser: window.PrayerPlaces. Node: module.exports (tests/widgets/prayer-times.test.mjs).
(function (root) {
  "use strict";

  // ISO 3166-1 alpha-2 codes of inhabited countries and territories (plus XK, Kosovo).
  const CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE " +
    "KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU " +
    "RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA " +
    "UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

  /**
   * Aladhan method per country, following the method each country's religious authority publishes (Aladhan's own
   * guidance). Everything else uses 3, Muslim World League. The user can always override it.
   */
  const METHOD_BY_COUNTRY = {
    TN: 18, DZ: 19, MA: 21, PT: 22, JO: 23, TR: 13, FR: 12, SG: 11, BN: 11, MY: 17, ID: 20, RU: 14, QA: 10, KW: 9,
    AE: 16, BH: 8, OM: 8, SA: 4, YE: 4, EG: 5, SD: 5, LY: 5, SY: 5, LB: 5, PS: 5, IR: 7, PK: 1, IN: 1, BD: 1, AF: 1,
    US: 2, CA: 2, GB: 15,
  };
  const DEFAULT_METHOD = 3;

  /** Common names Intl does not give (English short forms, local names). Keys are normalized. */
  const ALIASES = {
    uk: "GB", england: "GB", scotland: "GB", wales: "GB", "great britain": "GB", "united kingdom": "GB", britain: "GB",
    usa: "US", "united states of america": "US", america: "US", uae: "AE", emirates: "AE", turkiye: "TR",
    tunisie: "TN", "tunisian republic": "TN", deutschland: "DE", allemagne: "DE", algerie: "DZ", maroc: "MA",
    egypte: "EG", "saudi": "SA", "ksa": "SA", holland: "NL", "the netherlands": "NL", "ivory coast": "CI",
    "czech republic": "CZ", "south korea": "KR", "north korea": "KP", russia: "RU", "palestine": "PS",
    "bosnia": "BA", "bosnia and herzegovina": "BA",
  };

  /** Lowercase, no accents, no punctuation: "Béja " -> "beja". */
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’'`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  let names = null;
  function nameMap() {
    if (names) return names;
    names = new Map();
    let dn = null;
    try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* very old engine: codes only */ }
    for (const c of CODES) names.set(c, (dn && dn.of(c)) || c);
    return names;
  }

  /** English name of an ISO code ("TN" -> "Tunisia"); the code itself when unknown. */
  const countryName = (code) => nameMap().get(String(code || "").toUpperCase()) || String(code || "");

  /** [{ code, name }] sorted by name, for a country picker. */
  const countries = () => [...nameMap()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "en"));

  /** "Tunisia", "tn", "Tunisie", "United Kingdom", "UK" -> ISO code, or null. */
  function findCountry(text) {
    const n = norm(text);
    if (!n) return null;
    const up = n.toUpperCase();
    if (n.length === 2 && nameMap().has(up)) return up;
    if (ALIASES[n]) return ALIASES[n];
    for (const [code, name] of nameMap()) if (norm(name) === n) return code;
    return null;
  }

  /** Aladhan method number for a country code (3, MWL, when unknown). */
  const methodFor = (code) => METHOD_BY_COUNTRY[String(code || "").toUpperCase()] ?? DEFAULT_METHOD;

  /** Tunisia's 24 governorates: capital coordinates, so times work without a geocoder. `alt` are other spellings. */
  const TN_TZ = "Africa/Tunis";
  const TUNISIA = [
    ["Tunis", 36.8065, 10.1815], ["Ariana", 36.8625, 10.1956], ["Ben Arous", 36.7531, 10.2189],
    ["Manouba", 36.8101, 10.0956, ["La Manouba"]], ["Nabeul", 36.4561, 10.7376], ["Zaghouan", 36.4029, 10.1429],
    ["Bizerte", 37.2744, 9.8739, ["Banzart", "Binzart"]], ["Béja", 36.7256, 9.1817, ["Bajah"]],
    ["Jendouba", 36.5011, 8.7802], ["Le Kef", 36.1826, 8.7149, ["El Kef", "Kef"]], ["Siliana", 36.0849, 9.3708],
    ["Sousse", 35.8256, 10.6084, ["Susah"]], ["Monastir", 35.7643, 10.8113], ["Mahdia", 35.5047, 11.0622],
    ["Sfax", 34.7406, 10.7603, ["Safaqis"]], ["Kairouan", 35.6781, 10.0963, ["Kairwan", "Al Qayrawan"]],
    ["Kasserine", 35.1676, 8.8365], ["Sidi Bouzid", 35.0382, 9.4849], ["Gabès", 33.8815, 10.0982, ["Qabis"]],
    ["Medenine", 33.3549, 10.5055, ["Médenine"]], ["Tataouine", 32.9297, 10.4518], ["Gafsa", 34.425, 8.7842],
    ["Tozeur", 33.9197, 8.1335], ["Kebili", 33.7044, 8.969, ["Kébili"]],
  ].map(([name, lat, lon, alt = []]) => ({ name, lat, lon, tz: TN_TZ, cc: "TN", alt }));

  /** Bundled places for a country ([] when none). */
  const presets = (code) => (String(code || "").toUpperCase() === "TN" ? TUNISIA : []);

  /** The bundled place for `city` in `code` ("Gabes", "Gouvernorat de Sfax", "el kef" all match), or null. */
  function findPreset(code, city) {
    const n = norm(city).replace(/\b(governorate|gouvernorat|wilayat|de|of)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!n) return null;
    for (const p of presets(code)) if ([p.name, ...p.alt].some((x) => norm(x) === n)) return { name: p.name, lat: p.lat, lon: p.lon, tz: p.tz, cc: p.cc };
    return null;
  }

  const api = { CODES, METHOD_BY_COUNTRY, DEFAULT_METHOD, TUNISIA, norm, countryName, countries, findCountry, methodFor, presets, findPreset };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PrayerPlaces = api;
})(typeof window !== "undefined" ? window : globalThis);
