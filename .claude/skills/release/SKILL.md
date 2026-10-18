---
name: release
description: Ship a new Umbra version - bump Directory.Build.props, write notes, tag vX.Y.Z, let release.yml build and attach UmbraSetup-X.Y.Z.exe, verify. Use for "release", "publish a new version", "cut vX.Y.Z".
---

# Release Umbra

Run `.claude/skills/release-checklist` first: it produces `dist/release-checklist-<ver>.md` with the build, install and human checks.

1. **Pick the version** (semver):
   - patch: fixes only
   - minor: features
   - major: breaking changes to the widget SDK or the protocol

   Find the current version with `grep Version Directory.Build.props` and `gh release list -L 3`.
2. **Bump** `<Version>` in `Directory.Build.props` and the `#define AppVersion` default in `installer/Umbra.iss`.
   `build.ps1` reads the props file, but CI's `node scripts/check-versions.mjs` fails if the two differ.
3. **Check** `dotnet build Umbra.slnx -warnaserror`, `dotnet test Umbra.slnx`, `node scripts/check-versions.mjs` and `node scripts/catalog.mjs --check`.
   If the catalog check is stale, run `node scripts/catalog.mjs` and commit the index: nothing regenerates it on `main`.
4. **Notes:** run `gh pr list --state merged --search "merged:>YYYY-MM-DD"` (the date of the last release), or use `git log vPREV..HEAD --oneline`. Group the changes as Added / Changed / Fixed in user language, and save them to `dist/notes.md`.
5. **Commit, merge and tag:** `main` is protected, so a direct push is rejected.
   Commit on a `release/vX.Y.Z` branch (`git commit -am "Release vX.Y.Z"`), push it, open a PR and wait for CI.
   After the PR is merged: `git checkout main && git pull`, `git tag vX.Y.Z`, `git push origin vX.Y.Z`.
   The user is the commit author, with no co-author trailer.
   Keep the line endings and BOM of `Directory.Build.props` when editing it (a rewrite that changes them shows up as a whole-file diff).
6. **Watch** the workflow with `gh run watch $(gh run list -w release.yml -L 1 --json databaseId -q ".[0].databaseId")`.
   `release.yml` builds on windows-latest, creates the release and attaches `UmbraSetup-X.Y.Z.exe`.
7. **Notes on the release:** `gh release edit vX.Y.Z --notes-file dist/notes.md`.
8. **Verify** with `gh release view vX.Y.Z --json assets -q ".assets[].name"`. It should list the installer, around 35 MB.

Fallback if CI is down: run `powershell -File build.ps1` locally, then
`gh release create vX.Y.Z dist/UmbraSetup-X.Y.Z.exe --title "Umbra X.Y.Z" --notes-file dist/notes.md`.
