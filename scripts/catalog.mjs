#!/usr/bin/env node
// Validates every widgets/<id>/ folder and (re)generates widgets/index.json,
// the catalog that Umbra's Browse page reads.
//
//   node scripts/catalog.mjs          validate + write widgets/index.json
//   node scripts/catalog.mjs --check  validate + fail if index.json is out of date (CI on pull requests)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const widgetsDir = join(root, "widgets");
const indexPath = join(widgetsDir, "index.json");
const check = process.argv.includes("--check");

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const ALLOWED = new Set([".json", ".html", ".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".md"]);
const MAX_BYTES = 5 * 1024 * 1024;
const OPTION_TYPES = new Set(["text", "number", "select", "toggle"]);
const KNOWN_KEYS = new Set(["$schema", "id", "name", "description", "author", "version", "entry", "preview", "width", "height", "themeable", "defaultPosition", "permissions", "options"]);

const errors = [];
const fail = (id, msg) => errors.push(`widgets/${id}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = [];
for (const id of readdirSync(widgetsDir).sort()) {
  const dir = join(widgetsDir, id);
  if (!statSync(dir).isDirectory()) continue;

  const manifestPath = join(dir, "widget.json");
  if (!existsSync(manifestPath)) { fail(id, "missing widget.json"); continue; }

  let m;
  try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { fail(id, `widget.json is not valid JSON (${e.message})`); continue; }

  // Same rules as schemas/widget.schema.json (kept dependency-free, so CI needs only Node).
  for (const k of Object.keys(m)) if (!KNOWN_KEYS.has(k)) fail(id, `unknown key "${k}" in widget.json (typo?)`);
  if (!ID.test(id)) fail(id, "folder name must be lowercase letters, digits and dashes (2-40 chars)");
  if (m.id !== id) fail(id, `"id" must equal the folder name ("${id}")`);
  for (const k of ["name", "description", "author", "version"])
    if (typeof m[k] !== "string" || !m[k].trim()) fail(id, `"${k}" is required`);
  if (m.version && !SEMVER.test(m.version)) fail(id, `"version" must look like 1.2.3`);
  const entry = m.entry || "index.html";
  if (!existsSync(join(dir, entry))) fail(id, `entry file "${entry}" not found`);
  if (m.preview && !existsSync(join(dir, m.preview))) fail(id, `preview "${m.preview}" not found`);
  for (const k of ["width", "height"])
    if (m[k] !== undefined && (!Number.isInteger(m[k]) || m[k] < 80 || m[k] > 1200)) fail(id, `"${k}" must be an integer between 80 and 1200`);

  const hosts = m.permissions?.hosts ?? [];
  if (!Array.isArray(hosts)) fail(id, `"permissions.hosts" must be an array`);
  else for (const h of hosts) if (typeof h !== "string" || !HOST.test(h)) fail(id, `invalid host "${h}" (hostnames only, no scheme or path)`);

  for (const [key, spec] of Object.entries(m.options ?? {})) {
    if (!OPTION_TYPES.has(spec?.type)) fail(id, `option "${key}" has unknown type "${spec?.type}"`);
    if (spec?.type === "select" && !Array.isArray(spec.choices)) fail(id, `select option "${key}" needs "choices"`);
  }

  const files = walk(dir).map((p) => relative(dir, p).split(sep).join("/")).sort();
  let total = 0;
  for (const f of files) {
    if (!ALLOWED.has(extname(f).toLowerCase())) fail(id, `file type not allowed: ${f}`);
    total += statSync(join(dir, f)).size;
  }
  if (total > MAX_BYTES) fail(id, `widget is ${(total / 1048576).toFixed(1)} MB; the limit is 5 MB`);

  entries.push({
    id,
    name: m.name,
    description: m.description,
    author: m.author,
    version: m.version,
    preview: m.preview ?? null,
    hosts,
    files,
  });
}

// ---------- themes: themes/<id>/theme.json (+ optional preview image) -> themes/index.json ----------
// Themes are data only. These rules mirror Theme.cs in the app and schemas/theme.schema.json.
const themesDir = join(root, "themes");
const themesIndexPath = join(themesDir, "index.json");
const THEME_KEYS = new Set(["$schema", "id", "name", "description", "author", "version", "preview", "tokens"]);
const THEME_FILES = new Set([".json", ".png", ".jpg", ".jpeg", ".webp"]);
const COLOR_TOKENS = ["--bg", "--surface-1", "--surface-2", "--surface-3", "--line", "--line-strong", "--text", "--text-2", "--text-3", "--accent", "--accent-strong", "--accent-soft", "--up", "--down", "--flat"];
const LENGTH_TOKENS = ["--radius-s", "--radius-m", "--radius-l"];
const COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.]+(?:%|deg)?\s*[, ]\s*[0-9.]+%?\s*[, ]\s*[0-9.]+%?\s*(?:[,/]\s*[0-9.]+%?\s*)?\)$/;
const LENGTH = /^(?:[0-9]|[1-9][0-9])(?:\.[0-9]{1,3})?(?:px|rem)$/;
const MAX_THEME_BYTES = 1024 * 1024;
const failTheme = (id, msg) => errors.push(`themes/${id}: ${msg}`);

const themeEntries = [];
for (const id of existsSync(themesDir) ? readdirSync(themesDir).sort() : []) {
  const dir = join(themesDir, id);
  if (!statSync(dir).isDirectory()) continue;
  const file = join(dir, "theme.json");
  if (!existsSync(file)) { failTheme(id, "missing theme.json"); continue; }
  let t;
  try { t = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { failTheme(id, `theme.json is not valid JSON (${e.message})`); continue; }

  for (const k of Object.keys(t)) if (!THEME_KEYS.has(k)) failTheme(id, `unknown key "${k}" in theme.json`);
  if (!ID.test(id) || id === "default") failTheme(id, 'folder name must be lowercase letters, digits and dashes (2-40 chars) and not "default"');
  if (t.id !== id) failTheme(id, `"id" must equal the folder name ("${id}")`);
  for (const k of ["name", "description", "author", "version"])
    if (typeof t[k] !== "string" || !t[k].trim() || t[k].length > 300) failTheme(id, `"${k}" is required (max 300 chars)`);
  if (t.version && !SEMVER.test(t.version)) failTheme(id, `"version" must look like 1.2.3`);
  if (t.preview !== undefined && (typeof t.preview !== "string" || t.preview.includes("/") || !THEME_FILES.has(extname(t.preview).toLowerCase()) || extname(t.preview).toLowerCase() === ".json" || !existsSync(join(dir, t.preview))))
    failTheme(id, `"preview" must be an existing .png, .jpg or .webp file next to theme.json`);

  const tokens = t.tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens) || !Object.keys(tokens).length) failTheme(id, `"tokens" must be a non-empty object`);
  else for (const [name, value] of Object.entries(tokens)) {
    if (COLOR_TOKENS.includes(name)) { if (typeof value !== "string" || value.length > 64 || !COLOR.test(value)) failTheme(id, `${name}: "${value}" is not a plain color (#rrggbb, rgb(), hsl())`); }
    else if (LENGTH_TOKENS.includes(name)) { if (typeof value !== "string" || !LENGTH.test(value)) failTheme(id, `${name}: "${value}" is not a length like 12px (0-99px or rem)`); }
    else failTheme(id, `token "${name}" is not allowed. Allowed: ${[...COLOR_TOKENS, ...LENGTH_TOKENS].join(", ")}`);
  }

  const files = walk(dir).map((p) => relative(dir, p).split(sep).join("/")).sort();
  let total = 0;
  for (const f of files) {
    if (f.includes("/") || !THEME_FILES.has(extname(f).toLowerCase())) failTheme(id, `file not allowed: ${f} (only theme.json and a preview image, no subfolders)`);
    total += statSync(join(dir, f)).size;
  }
  if (total > MAX_THEME_BYTES) failTheme(id, `theme is ${(total / 1024).toFixed(0)} KB; the limit is 1 MB`);

  themeEntries.push({ id, name: t.name, description: t.description, author: t.author, version: t.version, preview: t.preview ?? null, tokens: tokens ?? {}, files });
}

if (errors.length) {
  console.error(`Catalog validation failed:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}

const json = JSON.stringify({ schema: 1, widgets: entries }, null, 2) + "\n";
const themesJson = JSON.stringify({ schema: 1, themes: themeEntries }, null, 2) + "\n";
const norm = (p) => (existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : "");
if (check) {
  if (norm(indexPath) !== json) {
    console.error("widgets/index.json is out of date. Run: node scripts/catalog.mjs");
    process.exit(1);
  }
  if (themeEntries.length && norm(themesIndexPath) !== themesJson) {
    console.error("themes/index.json is out of date. Run: node scripts/catalog.mjs");
    process.exit(1);
  }
  console.log(`OK: ${entries.length} widget(s) and ${themeEntries.length} theme(s) valid, indexes up to date`);
} else {
  writeFileSync(indexPath, json);
  if (themeEntries.length || existsSync(themesIndexPath)) writeFileSync(themesIndexPath, themesJson);
  console.log(`Wrote widgets/index.json with ${entries.length} widget(s) and themes/index.json with ${themeEntries.length} theme(s)`);
}
