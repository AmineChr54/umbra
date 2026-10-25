---
title: Publishing to the catalog
description: Get your widget into everyone's Browse page with one pull request, and what review and CI check.
sidebar: { order: 11 }
---

The catalog is this repository's `widgets/` folder. Publishing a widget is one pull request.

## Steps

1. **Fork and clone** the repository (`gh repo fork AmineChr54/umbra --clone`) and create a branch.
2. **Add `widgets/<id>/`** with your files: `widget.json`, the entry page, code and styles, and a 2× `preview.png` (`umbractl capture <id> preview.png`). Add `icon.png` if you want a tab icon.
3. **Run the catalog tool** and commit the result:
   ```powershell
   node scripts/catalog.mjs
   ```
   This validates your widget and regenerates `widgets/index.json` (and `themes/index.json`). **Never edit the index by hand.**
4. **Open a pull request** that adds only `widgets/<id>/` and the regenerated index.

If another widget PR lands first and your index conflicts, rebase on `main` and run `node scripts/catalog.mjs` again.

## What CI checks

CI runs `node scripts/catalog.mjs --check`, which fails the PR if the committed index is stale (nothing regenerates or commits it after the merge). Validation covers the id, the required fields, the semantic version, the hostnames, the option types, the command rules, the file types and the 5 MB limit.

## What reviewers check

- The widget only uses the hosts it declares, and the permissions match its purpose.
- It looks at home next to the others: see the [design guidelines](/umbra/docs/widgets/design-guidelines/).
- It's honest: description, preview and behavior match.
- Widgets with `permissions.commands` get extra scrutiny.

## After it's merged

It appears in everyone's **Browse** page. To ship a change, **bump `version`** in `widget.json` (users get an Update button), add a short `changelog` if useful, and open another PR. If the update adds hosts, notifications, media, system readings or commands, users are asked to accept the new access before it applies.

## Authors and contributors

You don't need write access: contributors work from a fork, and the maintainer merges. A first-time contributor's CI run waits for the maintainer to approve it. Read [CONTRIBUTING.md](https://github.com/AmineChr54/umbra/blob/main/CONTRIBUTING.md) for the contribution flow, and [Dev setup](/umbra/docs/internals/dev-setup/) if you'd like to work on the app itself.
