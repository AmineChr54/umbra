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
const KNOWN_KEYS = new Set(["$schema", "id", "name", "description", "author", "version", "entry", "preview", "width", "height", "defaultPosition", "permissions", "options"]);

const errors = [];
const fail = (id, msg) => errors.push(`widgets/${id}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// permissions.commands: the same rules as CommandSpec.Validate in the host (src/Umbra/WidgetCommands.cs).
const CMD_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLACEHOLDER = /^\$\{([a-z][A-Za-z0-9]{0,31})\}$/;
const BARE_EXE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const ABS_EXE = /^[A-Za-z]:[\\/][^\0*?"<>|]{1,250}$/;
const PARAM_NAME = /^[a-z][A-Za-z0-9]{0,31}$/;
const CMD_KEYS = new Set(["id", "run", "description", "params", "timeoutSeconds"]);
const hasControl = (s) => /[\u0000-\u0008\u000a-\u001f\u007f]/.test(s);

/** Returns [{id, run (display string), description}] for the index; reports problems through fail(). */
function validateCommands(wid, commands) {
  if (commands === undefined) return [];
  if (!Array.isArray(commands)) { fail(wid, `"permissions.commands" must be an array`); return []; }
  if (commands.length > 16) fail(wid, "at most 16 commands per widget");
  const out = [];
  const seen = new Set();
  for (const c of commands) {
    const name = `command "${c?.id}"`;
    if (typeof c !== "object" || c === null || Array.isArray(c)) { fail(wid, "each command must be an object"); continue; }
    for (const k of Object.keys(c)) if (!CMD_KEYS.has(k)) fail(wid, `${name}: unknown key "${k}"`);
    if (typeof c.id !== "string" || !CMD_ID.test(c.id)) fail(wid, `${name}: id must be 1-40 lowercase letters, digits and dashes`);
    else if (seen.has(c.id)) fail(wid, `duplicate command id "${c.id}"`);
    else seen.add(c.id);
    if (c.description !== undefined && (typeof c.description !== "string" || c.description.length > 200)) fail(wid, `${name}: description must be a string of at most 200 characters`);
    if (c.timeoutSeconds !== undefined && (!Number.isInteger(c.timeoutSeconds) || c.timeoutSeconds < 1 || c.timeoutSeconds > 120)) fail(wid, `${name}: timeoutSeconds must be an integer from 1 to 120`);
    const run = c.run;
    if (!Array.isArray(run) || run.length < 1 || run.length > 32 || run.some((a) => typeof a !== "string" || a.length > 1024 || hasControl(a))) {
      fail(wid, `${name}: "run" must be an array of 1-32 strings (executable first, then arguments)`);
      continue;
    }
    if (!BARE_EXE.test(run[0]) && !ABS_EXE.test(run[0])) fail(wid, `${name}: executable "${run[0]}" must be a plain program name or an absolute path like C:\\Tools\\app.exe`);
    if (/[\\/]$/.test(run[0]) || run[0].includes("..")) fail(wid, `${name}: executable path is invalid`);
    const params = c.params ?? {};
    const used = new Set();
    for (const a of run.slice(1)) {
      const p = PLACEHOLDER.exec(a);
      if (a.includes("${") && !p) fail(wid, `${name}: "${a}": a parameter must be a whole argument written exactly as \${name}`);
      if (p) { used.add(p[1]); if (!(p[1] in params)) fail(wid, `${name}: \${${p[1]}} is not declared in "params"`); }
    }
    for (const [pn, spec] of Object.entries(params)) {
      if (!PARAM_NAME.test(pn)) fail(wid, `${name}: invalid parameter name "${pn}"`);
      if (!used.has(pn)) fail(wid, `${name}: parameter "${pn}" is declared but never used`);
      if (typeof spec !== "object" || spec === null) { fail(wid, `${name}: parameter "${pn}" must be an object`); continue; }
      for (const k of Object.keys(spec)) if (k !== "maxLength" && k !== "choices") fail(wid, `${name}: parameter "${pn}" may only have maxLength and choices`);
      const max = spec.maxLength ?? 200;
      if (!Number.isInteger(max) || max < 1 || max > 1000) fail(wid, `${name}: parameter "${pn}" maxLength must be 1-1000`);
      if (spec.choices !== undefined && (!Array.isArray(spec.choices) || spec.choices.length < 1 || spec.choices.length > 64
        || spec.choices.some((x) => typeof x !== "string" || !x.length || x.length > max)))
        fail(wid, `${name}: parameter "${pn}" choices must be 1-64 non-empty strings within maxLength`);
    }
    out.push({ id: c.id, run: run.map((a) => (/[\s"]/.test(a) || a === "" ? JSON.stringify(a) : a)).join(" "), description: c.description ?? "" });
  }
  return out;
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

  const commands = validateCommands(id, m.permissions?.commands);

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
    // Only present for widgets that can start programs; Browse flags them so users see it before installing.
    ...(commands.length ? { commands } : {}),
    files,
  });
}

if (errors.length) {
  console.error(`Widget validation failed:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}

const json = JSON.stringify({ schema: 1, widgets: entries }, null, 2) + "\n";
if (check) {
  const current = existsSync(indexPath) ? readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== json) {
    console.error("widgets/index.json is out of date. Run: node scripts/catalog.mjs");
    process.exit(1);
  }
  console.log(`OK: ${entries.length} widget(s) valid, index up to date`);
} else {
  writeFileSync(indexPath, json);
  console.log(`Wrote widgets/index.json with ${entries.length} widget(s)`);
}
