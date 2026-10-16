// Run with: node --test tests/widgets
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const P = require("../../widgets/internships/parser.js");
const md = readFileSync(join(fileURLToPath(import.meta.url), "..", "fixtures", "intern_intl.md"), "utf8");

test("parses every well-formed row and skips the broken one", () => {
  const r = P.parse(md);
  assert.equal(r.rows, 9);
  assert.equal(r.skipped, 1);
  assert.equal(r.items.length, 7); // 9 rows - 1 broken - 1 duplicate url
  const nv = r.items[0];
  assert.deepEqual(
    { company: nv.company, role: nv.role, loc: nv.loc, more: nv.more, country: nv.country, age: nv.age },
    { company: "NVIDIA", role: "Developer Technology Intern & Research", loc: "Zürich, Switzerland", more: 1, country: "switzerland", age: 1 },
  );
  assert.match(nv.url, /^https:\/\/nvidia\.example\//);
});

test("ids are stable and unique", () => {
  const ids = P.parse(md).items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, P.parse(md).items.map((i) => i.id));
});

test("remote locations", () => {
  const items = P.parse(md).items;
  const poland = items.find((i) => i.company === "Wikimedia");
  assert.equal(poland.remote, true);
  assert.equal(poland.country, "poland");
  const plain = items.find((i) => i.company === "Acme");
  assert.equal(plain.remote, true);
  assert.equal(plain.country, "");
});

test("EMEA filter keeps Europe, Middle East and Africa only", () => {
  const items = P.parse(md).items;
  const got = P.filter(items, { region: "emea" }).map((i) => i.company);
  assert.deepEqual(got, ["NVIDIA", "Amazon", "Wikimedia", "Airbus"]);
  assert.deepEqual(P.filter(items, { region: "emea", remote: true }).map((i) => i.company), ["NVIDIA", "Amazon", "Wikimedia", "Airbus", "Acme"]);
  assert.deepEqual(P.filter(items, { region: "mea" }).map((i) => i.company), ["Amazon"]);
  assert.equal(P.filter(items, { region: "all", remote: true }).length, items.length);
});

test("include, exclude and keywords", () => {
  const items = P.parse(md).items;
  assert.deepEqual(P.filter(items, { region: "emea", exclude: "poland" }).map((i) => i.company), ["NVIDIA", "Amazon"]);
  assert.ok(P.filter(items, { region: "emea", include: "singapore" }).some((i) => i.company === "Grab"));
  assert.deepEqual(P.filter(items, { region: "emea", keywords: "airbus, amazon" }).map((i) => i.company), ["Amazon", "Airbus"]);
});

test("a changed table yields no rows (the widget shows its format error)", () => {
  const r = P.parse("| Company | Role |\n|---|---|\n| a | b |\n| c | d |\n");
  assert.equal(r.items.length, 0);
});
