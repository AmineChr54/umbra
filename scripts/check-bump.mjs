// Fails when a widget or theme folder changed versus a base ref but its manifest "version" did not.
//   node scripts/check-bump.mjs [baseRef]   (default origin/main; in CI pass origin/${{ github.base_ref }})
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const base = process.argv[2] ?? "origin/main";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const mergeBase = git("merge-base", base, "HEAD").trim();
const changed = git("diff", "--name-only", mergeBase, "HEAD", "--", "widgets", "themes").split("\n").filter(Boolean);

const dirs = new Map(); // "widgets/clock" -> manifest file name
for (const f of changed) {
  const [kind, id, ...rest] = f.split("/");
  if (!id || rest.length === 0) continue; // skips index.json
  dirs.set(`${kind}/${id}`, kind === "widgets" ? "widget.json" : "theme.json");
}

const errors = [];
for (const [dir, manifest] of dirs) {
  const path = `${dir}/${manifest}`;
  if (!existsSync(path)) continue; // folder deleted
  let before;
  try { before = JSON.parse(git("show", `${mergeBase}:${path}`)).version; } catch { continue; } // new folder
  const after = JSON.parse(readFileSync(path, "utf8")).version;
  if (before === after) errors.push(`${dir} changed but ${manifest} version is still ${after}`);
}
if (errors.length) { console.error("Bump the version:\n  " + errors.join("\n  ")); process.exit(1); }
console.log(`Version bumps OK (${dirs.size} changed folder(s) vs ${base})`);
