---
name: release
description: Ship a new Umbra version - bump Directory.Build.props, write notes, tag vX.Y.Z, let release.yml build and attach UmbraSetup-X.Y.Z.exe, verify. Use for "release", "publish a new version", "cut vX.Y.Z".
---

# Release Umbra

1. **Pick the version** (semver):
   - patch: fixes only
   - minor: features
   - major: breaking changes to the widget SDK or the protocol

   Find the current version with `grep Version Directory.Build.props` and `gh release list -L 3`.
2. **Bump** `<Version>` in `Directory.Build.props`. It's the only place: `build.ps1` and the installer read it.
3. **Check** `dotnet build Umbra.slnx -warnaserror`, `dotnet test Umbra.slnx` and `node scripts/catalog.mjs --check`.
4. **Notes:** run `gh pr list --state merged --search "merged:>YYYY-MM-DD"` (the date of the last release), or use `git log vPREV..HEAD --oneline`. Group the changes as Added / Changed / Fixed in user language, and save them to `dist/notes.md`.
5. **Commit and tag:**
   `git commit -am "Release vX.Y.Z"`, then `git tag vX.Y.Z`, then `git push origin main vX.Y.Z`.
   The user is the commit author, with no co-author trailer.
6. **Watch** the workflow with `gh run watch $(gh run list -w release.yml -L 1 --json databaseId -q ".[0].databaseId")`.
   `release.yml` builds on windows-latest, creates the release and attaches `UmbraSetup-X.Y.Z.exe`.
7. **Notes on the release:** `gh release edit vX.Y.Z --notes-file dist/notes.md`.
8. **Verify** with `gh release view vX.Y.Z --json assets -q ".assets[].name"`. It should list the installer, around 35 MB.

Fallback if CI is down: run `powershell -File build.ps1` locally, then
`gh release create vX.Y.Z dist/UmbraSetup-X.Y.Z.exe --title "Umbra X.Y.Z" --notes-file dist/notes.md`.
