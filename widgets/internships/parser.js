// Parser and filters for speedyapply's INTERN_INTL.md. Pure functions: no DOM, no umbra, so Node can test them
// (tests/widgets/internships.test.mjs).
//
// Table rows look like (HTML inside Markdown):
// | <a href="https://co.com"><strong>Company</strong></a> | Role | City, Country +1 | <a href="https://apply"><img ...></a> | 3d |
(function (root) {
  "use strict";

  const EUROPE = [
    "albania", "andorra", "austria", "belarus", "belgium", "bosnia and herzegovina", "bulgaria", "croatia", "cyprus",
    "czechia", "czech republic", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "iceland",
    "ireland", "italy", "kosovo", "latvia", "liechtenstein", "lithuania", "luxembourg", "malta", "moldova", "monaco",
    "montenegro", "the netherlands", "netherlands", "north macedonia", "norway", "poland", "portugal", "romania",
    "russia", "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland", "turkey", "turkiye", "ukraine",
    "united kingdom", "uk", "england", "scotland", "wales",
  ];
  const MEA = [
    "israel", "saudi arabia", "united arab emirates", "uae", "qatar", "kuwait", "bahrain", "oman", "jordan", "lebanon",
    "iraq", "egypt", "morocco", "tunisia", "algeria", "nigeria", "kenya", "south africa", "ghana", "ethiopia", "rwanda",
    "tanzania", "uganda", "botswana", "angola", "senegal", "namibia", "mauritius", "zambia", "zimbabwe", "cameroon",
    "ivory coast", "cote d'ivoire", "mozambique", "tunisia",
  ];
  const REGIONS = { emea: [...EUROPE, ...MEA], europe: EUROPE, mea: MEA, all: null };

  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m]);
  const text = (html) => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  const href = (html) => {
    const m = /href="([^"]+)"/i.exec(html);
    const u = m ? decode(m[1]) : "";
    return /^https?:\/\//i.test(u) ? u : "";
  };

  /** Short stable id for a posting URL (FNV-1a, 32 bit, hex). Kept short so the "seen" list stays small. */
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  /**
   * Parse the Markdown. Returns { items, rows, skipped }:
   *  items   [{ id, company, role, loc, country, remote, age (days), url }]
   *  rows    table rows seen (lines starting with "| <a")
   *  skipped rows that did not match the expected 5-column shape
   */
  function parse(md) {
    const items = [];
    const seen = new Set();
    let rows = 0, skipped = 0;
    for (const line of String(md).split(/\r?\n/)) {
      if (!line.startsWith("|") || /^\|\s*(-|Company)/.test(line)) continue;
      rows++;
      const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split(/\s\|\s/);
      if (cells.length !== 5) { skipped++; continue; }
      const company = text(cells[0]);
      const role = text(cells[1]);
      const loc = text(cells[2]);
      const url = href(cells[3]);
      const age = /^(\d+)\s*d$/i.exec(text(cells[4]));
      if (!company || !role || !url || !age) { skipped++; continue; }
      const id = hash(url);
      if (seen.has(id)) continue;
      seen.add(id);
      const { country, remote } = place(loc);
      items.push({ id, company, role, loc: loc.replace(/\s*\+\d+$/, ""), more: +(/\+(\d+)$/.exec(loc)?.[1] || 0), country, remote, age: +age[1], url });
    }
    return { items, rows, skipped };
  }

  /** "Zürich, Switzerland +1" -> { country: "switzerland", remote: false }; "Remote - Poland" -> poland, remote. */
  function place(loc) {
    let s = loc.replace(/\s*\+\d+$/, "").trim();
    let remote = false;
    const m = /^remote\b\s*[-–:]?\s*(.*)$/i.exec(s);
    if (m) { remote = true; s = m[1].trim(); }
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    return { country: (parts[parts.length - 1] || "").toLowerCase(), remote };
  }

  const list = (v) => String(v || "").split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  /**
   * Apply the user's options. opts: { region, include, exclude, keywords, remote }
   * include/exclude: comma lists matched against the location text (country or city).
   */
  function filter(items, opts) {
    const region = REGIONS[opts.region] === undefined ? REGIONS.emea : REGIONS[opts.region];
    const include = list(opts.include), exclude = list(opts.exclude), words = list(opts.keywords);
    return items.filter((it) => {
      const where = it.loc.toLowerCase();
      if (exclude.some((x) => where.includes(x))) return false;
      let ok;
      if (it.remote && !it.country) ok = !!opts.remote; // plain "Remote": no way to know the region
      else ok = region === null || region.includes(it.country);
      if (!ok && include.some((x) => where.includes(x))) ok = true;
      if (!ok) return false;
      if (words.length) {
        const hay = `${it.company} ${it.role}`.toLowerCase();
        if (!words.some((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  const api = { parse, filter, hash, place };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InternParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
