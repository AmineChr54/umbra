// Builds the static catalog site into _site/ from widgets/index.json (no dependencies).
// Usage: node scripts/site.mjs   (run `node scripts/catalog.mjs` first so the index is fresh)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");
const index = JSON.parse(readFileSync(join(root, "widgets", "index.json"), "utf8"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "previews"), { recursive: true });

const cards = index.widgets.map(w => {
  let img = "";
  if (w.preview && existsSync(join(root, "widgets", w.id, w.preview))) {
    copyFileSync(join(root, "widgets", w.id, w.preview), join(out, "previews", `${w.id}.png`));
    img = `<img src="previews/${esc(w.id)}.png" alt="${esc(w.name)} preview" loading="lazy">`;
  }
  const hosts = (w.hosts ?? []).length
    ? `<p class="meta">Connects to: ${w.hosts.map(h => `<code>${esc(h)}</code>`).join(" ")}</p>`
    : `<p class="meta">No network access</p>`;
  const cmds = (w.commands ?? []).length
    ? `<p class="meta warn">Runs commands (asks for approval): ${w.commands.map(c => `<code>${esc(c.run)}</code>`).join(" ")}</p>`
    : "";
  return `<article data-q="${esc((w.name + " " + w.description + " " + w.id).toLowerCase())}">
${img}<h2>${esc(w.name)} <small>v${esc(w.version)}</small></h2>
<p>${esc(w.description)}</p>${hosts}${cmds}
<p class="meta">by ${esc(w.author)} &middot; <a href="https://github.com/AmineChr54/umbra/tree/main/widgets/${esc(w.id)}">source</a></p>
<p class="install">Install: Umbra &rarr; Settings &rarr; Browse &rarr; <b>${esc(w.name)}</b></p>
</article>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Umbra widget catalog</title>
<meta name="description" content="Community widgets for Umbra, small web widgets pinned to the Windows desktop.">
<style>
:root{color-scheme:dark;--bg:#000;--card:#111;--line:#262626;--fg:#f2f2f2;--dim:#9a9a9a;--acc:#7aa7ff}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#fff;--card:#f6f6f6;--line:#ddd;--fg:#111;--dim:#666;--acc:#1f5fd6}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px}
h1{margin:0 0 4px}a{color:var(--acc)}.lead{color:var(--dim);margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
article[hidden]{display:none}
article img{width:100%;border-radius:8px;display:block;margin-bottom:12px}
h2{font-size:1.1rem;margin:0 0 6px}h2 small{color:var(--dim);font-weight:400}
p{margin:6px 0}.meta,.install{color:var(--dim);font-size:.85rem}.warn{color:#e6a23c}
code{font-size:.8rem;background:rgba(127,127,127,.18);padding:1px 5px;border-radius:4px;word-break:break-all}
</style></head><body><main>
<h1>Umbra widget catalog</h1>
<p class="lead">${index.widgets.length} widgets for <a href="https://github.com/AmineChr54/umbra">Umbra</a>. Install them from the Browse page in Umbra's settings.</p>
<input id="q" type="search" placeholder="Search widgets" aria-label="Search widgets">
<div class="grid" id="grid">
${cards}
</div></main>
<script>
const q=document.getElementById("q"),items=[...document.querySelectorAll("article")];
q.addEventListener("input",()=>{const v=q.value.trim().toLowerCase();for(const a of items)a.hidden=!!v&&!a.dataset.q.includes(v)});
</script></body></html>
`;
writeFileSync(join(out, "index.html"), html);
console.log(`Site built: ${index.widgets.length} widgets -> _site/`);
