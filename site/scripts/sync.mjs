// Prebuild step: pulls repo data the site shows into site/ (all outputs are gitignored).
// - docs/widget-sdk.md stays the one source of the SDK reference (umbractl ships it), copied in as a docs page
// - widget previews into public/previews, catalog + themes + app version into src/data/site.json
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const readJson = p => JSON.parse(readFileSync(join(repo, p), "utf8"));

/** Width and height of a PNG from its IHDR chunk, so images reserve their space before loading. */
const pngSize = file => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const widgets = readJson("widgets/index.json").widgets.map(w => {
  const src = w.preview && join(repo, "widgets", w.id, w.preview);
  return { ...w, files: undefined, previewSize: src && existsSync(src) ? pngSize(src) : null };
});
const themes = readJson("themes/index.json").themes;
const version = readFileSync(join(repo, "Directory.Build.props"), "utf8").match(/<Version>([^<]+)<\/Version>/)?.[1] ?? "";

const previews = join(site, "public", "previews");
rmSync(previews, { recursive: true, force: true });
mkdirSync(previews, { recursive: true });
for (const w of widgets) if (w.previewSize) copyFileSync(join(repo, "widgets", w.id, w.preview), join(previews, `${w.id}.png`));
copyFileSync(join(repo, "assets", "umbra-256.png"), join(site, "public", "favicon.png"));
mkdirSync(join(site, "src", "assets"), { recursive: true });
copyFileSync(join(repo, "assets", "umbra-256.png"), join(site, "src", "assets", "umbra.png"));

mkdirSync(join(site, "src", "data"), { recursive: true });
writeFileSync(join(site, "src", "data", "site.json"), JSON.stringify({ version, widgets, themes }, null, 2));

// The SDK reference: drop the H1 (Starlight renders the title), point repo-relative links at GitHub, add frontmatter.
const blob = "https://github.com/AmineChr54/umbra/blob/main/";
mkdirSync(join(site, "public", "img"), { recursive: true });
const sdk = readFileSync(join(repo, "docs", "widget-sdk.md"), "utf8")
  .replace(/^# .*\r?\n/, "")
  .replace(/^\*\*Time changes\.\*\* /m, "### Time changes\n\n")   // the SDK links to #time-changes, but it's only bold text there
  .replace(/\]\(\.\.\/([^)#]+)\)/g, (_, p) => `](${blob}${p})`)
  .replace(/\]\(([\w-]+\.png)\)/g, (_, f) => { copyFileSync(join(repo, "docs", f), join(site, "public", "img", f)); return `](/umbra/img/${f})`; });
mkdirSync(join(site, "src", "content", "docs", "docs", "widgets"), { recursive: true });
writeFileSync(join(site, "src", "content", "docs", "docs", "widgets", "sdk-reference.md"),
  `---\ntitle: SDK reference\ndescription: "The complete widget reference in one page: manifest, JavaScript API, tokens, commands, sandbox and publishing."\nsidebar: { order: 99 }\neditUrl: https://github.com/AmineChr54/umbra/edit/main/docs/widget-sdk.md\n---\n\n` +
  `:::note\nThis page is generated from [\`docs/widget-sdk.md\`](https://github.com/AmineChr54/umbra/blob/main/docs/widget-sdk.md), the same file \`umbractl\` gives AI agents as \`widget_authoring_guide\`.\n:::\n\n${sdk}`);

// Schema reference pages: the JSON Schemas shipped in schemas/, so they can't drift from what validates widgets and themes.
const refDir = join(site, "src", "content", "docs", "docs", "reference");
mkdirSync(refDir, { recursive: true });
const schemaPage = (file, title, order, intro) => {
  const schema = readFileSync(join(repo, "schemas", file), "utf8").trim();
  writeFileSync(join(refDir, file.replace(".schema.json", "-schema.md")),
    `---\ntitle: ${title}\ndescription: "${intro}"\nsidebar: { order: ${order} }\neditUrl: https://github.com/AmineChr54/umbra/edit/main/schemas/${file}\n---\n\n` +
    `${intro} Add the schema URL as \`$schema\` and your editor validates and completes the file as you type:\n\n` +
    `\`\`\`json\n"$schema": "https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/${file}"\n\`\`\`\n\n` +
    `:::note\nThis page is generated from [\`schemas/${file}\`](${blob}schemas/${file}).\n:::\n\n` +
    `\`\`\`json\n${schema}\n\`\`\`\n`);
};
schemaPage("widget.schema.json", "widget.json schema", 1, "The JSON Schema for widget manifests.");
schemaPage("theme.schema.json", "theme.json schema", 2, "The JSON Schema for theme files.");

console.log(`sync: v${version}, ${widgets.length} widgets, ${themes.length} themes, SDK reference, 2 schemas`);
