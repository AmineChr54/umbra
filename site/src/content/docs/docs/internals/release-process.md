---
title: Release process
description: How a version is cut - bump, tag, the release workflow, code signing and the winget manifests.
sidebar: { order: 9 }
---

For maintainers. The repo also has a `release` skill and a `release-manager` agent under `.claude/` that walk through this.

## Cutting a release

1. **Bump the version** in `Directory.Build.props` (one version for `Umbra.exe`, `umbractl.exe` and the installer).
2. **Write the notes** from the merged pull requests.
3. **Tag `vX.Y.Z` and push the tag.**
4. `.github/workflows/release.yml` builds and attaches `UmbraSetup-<version>.exe` (and the portable zip) to the GitHub release.
5. **Verify** the release assets: the installer's name must be `UmbraSetup-<release version>.exe`, because that's what the self-updater requires.

There's also a `release-checklist` skill that builds a filled checklist (build, install tests, human checks gathered from merged PRs, ship steps).

## Signing

`release.yml` signs the installer with `signtool` **only if** the repo secrets `SIGN_CERT_BASE64` (a code-signing `.pfx`, base64) and `SIGN_CERT_PASSWORD` exist. Otherwise it publishes it unsigned. One-time setup:

1. Get a code-signing certificate (an OV/EV certificate from a CA, or Azure Trusted Signing / SignPath if you qualify) and export it as a `.pfx`.
2. Encode it with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` and add the two repo secrets.
3. The next tagged release is signed. SmartScreen reputation still builds up over time.

## winget

The release workflow also fills the manifests in [`winget/`](https://github.com/AmineChr54/umbra/tree/main/winget) with the version and SHA256 (`scripts/winget.ps1`) and attaches them to the workflow run as `winget-manifests-<version>`.

First submission (needs a person, not CI):

1. After a release, download the `winget-manifests-<version>` artifact, or run `powershell -File scripts/winget.ps1 -Installer dist/UmbraSetup-<version>.exe`.
2. Run `wingetcreate submit <folder>`, or fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) and copy the three files to `manifests/a/AmineChr54/Umbra/<version>/`.
3. Validate with `winget validate <folder>` and `winget install --manifest <folder>` in a clean VM, then open the pull request. Moderators must approve the first one.

Later releases repeat step 2 for each version (or use `wingetcreate update AmineChr54.Umbra` / winget-releaser once the package exists).

## Catalog and site

Widgets and themes are published by merging their pull requests; there's no release step. The website (this site) is built from `main` by `.github/workflows/pages.yml`.

## Related

[Updates and installer](/umbra/docs/internals/updates-installer/) · [Dev setup](/umbra/docs/internals/dev-setup/)
