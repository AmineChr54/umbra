// Fails the build when a page links to a docs page, anchor or asset that doesn't exist. Run after `astro build`: node scripts/check-links.mjs
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const base = "/umbra";
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && files.push(p); } })(dist);

const ids = new Map();   // html file -> set of element ids
const idsOf = f => ids.get(f) ?? ids.set(f, new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))).get(f);
const resolve = path => {
  const p = join(dist, path.slice(base.length));
  if (existsSync(p) && statSync(p).isFile()) return p;
  const idx = join(p, "index.html");
  return existsSync(idx) ? idx : null;
};

const bad = [];
for (const file of files) {
  const html = readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (!href.startsWith(base) && !href.startsWith("#")) continue;   // external or relative-by-design
    const [path, hash] = href.split("#");
    const target = path ? resolve(path.replace(/\/$/, "") || base) : file;
    if (!target) { bad.push(`${relative(dist, file)} -> ${href} (missing page or file)`); continue; }
    if (hash && target.endsWith(".html") && !idsOf(target).has(decodeURIComponent(hash))) bad.push(`${relative(dist, file)} -> ${href} (missing anchor)`);
  }
}
if (bad.length) { console.error([...new Set(bad)].join("\n")); console.error(`\n${new Set(bad).size} broken link(s)`); process.exit(1); }
console.log(`links ok: ${files.length} pages checked`);
