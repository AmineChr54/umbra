---
title: Dev setup and tests
description: Build, test and run Umbra from source, how to verify UI changes, and the contribution workflow.
sidebar: { order: 8 }
---

## Prerequisites

Windows 10 1809+ or Windows 11, the **.NET 10 SDK**, **Node.js** (for `scripts/catalog.mjs`) and **Inno Setup 6** (only for building the installer).

## Commands

```powershell
dotnet build Umbra.slnx -warnaserror      # must stay at 0 warnings
dotnet test Umbra.slnx                    # unit tests (xUnit), no app or network needed
node scripts/catalog.mjs                  # validate widgets/ + themes/ and regenerate both index.json files (commit them)
powershell -File build.ps1                # publish both exes + installer -> dist/UmbraSetup-<ver>.exe
dotnet run --project src/Umbra            # run from source (exit the installed Umbra first: one instance per user)
```

The installed app is at `%LOCALAPPDATA%\Programs\Umbra`, and user data at `%APPDATA%\Umbra`. `UMBRA_DATA_DIR` overrides the data folder; the tests use a temporary one.

## Verifying UI changes

Use `umbractl capture <widget-id|settings:<page>> out.png`, then **look at the PNG**. It captures only that WebView.

:::caution
**Never take desktop or full-screen screenshots.** They capture your other windows. Drag behavior needs a human check; note that in the PR.
:::

## Conventions

- **C#:** file-scoped namespaces, `sealed` classes, short `///` summaries on types and non-obvious members. No new NuGet dependencies without a reason (the MCP server and JSON-RPC are hand-rolled on purpose).
- **JS:** no build step or frameworks in `shared/`, `settings/` or built-in widgets.
- **Widgets:** true black `#000`, Segoe UI Variable via `umbra.css`, tabular numbers, respect `data-motion`.
- **Versions:** bump `version` in a widget's `widget.json` on every change; bump `Directory.Build.props` for app releases.
- **Catalog index:** never hand-edit `widgets/index.json` or `themes/index.json`. Run `node scripts/catalog.mjs` and commit the result: nothing regenerates them after merge, and CI (`catalog.mjs --check`) fails the PR if they're stale.

## Adding a capability

New automation goes through the [control protocol](/umbra/docs/automate/control-protocol/#adding-a-capability) so the CLI, MCP and tests stay in sync.

## Workflow

- Work is tracked on the [Umbra Roadmap](https://github.com/users/AmineChr54/projects/5) board (Backlog, Ready, In progress, In review, Done). New issues are added automatically and labelled `status: triage`.
- Labels: `type: bug|feature|docs|widget|chore`, `area: host|widgets|settings|sdk|ai|installer|ci|docs`, `priority: p0|p1|p2`, plus `good first issue` and `help wanted`.
- **One issue per PR** when possible, with `Closes #N` in the body. CI (`.github/workflows/ci.yml`) must pass.
- Before starting an issue, skip it if it has an assignee; otherwise comment "I'm taking this".
- Contributors without write access work from a fork (`gh repo fork AmineChr54/umbra --clone`, then `gh pr create --repo AmineChr54/umbra`). They can't set labels, assignees or the board, and never merge; the maintainer does. A first-time contributor's CI waits for the maintainer to approve the run.

## Working with AI agents

[`CLAUDE.md`](https://github.com/AmineChr54/umbra/blob/main/CLAUDE.md) at the repo root holds the architecture, commands and security invariants that coding agents read. Project agents live in `.claude/agents/` and repeatable procedures (new widget, release, test the app, capture screenshots) in `.claude/skills/`.

## Related

[Architecture](/umbra/docs/internals/architecture/) · [Security model](/umbra/docs/internals/security/) · [Release process](/umbra/docs/internals/release-process/)
