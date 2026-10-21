// Dev-only: rasterizes a curated set of Lucide icons (ISC license, https://lucide.dev) into shared/tabicons/*.png
// (64x64, light grey on transparent: what the tab strip expects) plus shared/tabicons/index.json for the Settings picker.
// Not part of CI or the build; the output is committed.
//   mkdir tmp && cd tmp && npm i lucide-static@0.468.0 @resvg/resvg-js && node ../scripts/build-tabicons.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.cwd(), "noop.js"));
const { Resvg } = require("@resvg/resvg-js");
const root = dirname(require.resolve("lucide-static/package.json"));
const tags = JSON.parse(readFileSync(join(root, "tags.json"), "utf8"));
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "tabicons");
mkdirSync(out, { recursive: true });

const names = `home house building-2 briefcase folder file-text notebook book-open bookmark library graduation-cap school
calendar calendar-days clock alarm-clock timer hourglass history watch sun moon cloud cloud-rain snowflake wind thermometer umbrella zap flame droplets leaf trees mountain
star heart thumbs-up smile gift party-popper cake trophy medal target flag rocket sparkles wand-2 lightbulb
check-square list-todo list-checks clipboard-list pencil pen-line sticky-note edit-3 type quote message-square mail inbox send bell phone
music headphones play pause volume-2 mic radio tv film clapperboard camera image gamepad-2 dices puzzle palette brush
chart-line chart-bar chart-pie trending-up trending-down activity dollar-sign euro bitcoin wallet credit-card piggy-bank coins banknote shopping-cart shopping-bag store tag receipt
globe map map-pin compass navigation plane car bus train bike ship fuel
code terminal cpu database server hard-drive wifi bluetooth battery-full monitor laptop smartphone keyboard mouse printer git-branch github bug shield lock key settings wrench hammer
user users user-circle baby dog cat paw-print utensils coffee wine beer pizza apple salad dumbbell footprints bed stethoscope pill
search eye layout-grid layout-dashboard layers box package archive trash-2 download upload link rss at-sign hash infinity`.split(/\s+/).filter(Boolean);

const index = [];
for (const name of [...new Set(names)]) {
  const file = join(root, "icons", `${name}.svg`);
  if (!existsSync(file)) { console.warn("missing", name); continue; }
  const svg = readFileSync(file, "utf8").replace(/currentColor/g, "#d4d4d4");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 64 } }).render().asPng();
  writeFileSync(join(out, `${name}.png`), png);
  index.push({ name, tags: (tags[name] ?? []).slice(0, 6) });
}
index.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(out, "index.json"), JSON.stringify(index) + "\n");
writeFileSync(join(out, "LICENSE.txt"), "Icons from Lucide (https://lucide.dev), ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.\n");
console.log(index.length, "icons");
