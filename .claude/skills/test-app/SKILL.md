---
name: test-app
description: Test Umbra end to end - build with warnings as errors, unit tests, catalog validation, then a live smoke test of the running app through umbractl (options, install/remove, captures, MCP). Use before PRs/releases or when asked to "test the app".
---

# Test Umbra

## Static
```powershell
dotnet build Umbra.slnx -warnaserror
dotnet test Umbra.slnx
node scripts/catalog.mjs --check
```

## Live smoke test (the installed or freshly built app)
Record `umbractl list` first, and restore the values at the end. Positions too: `move` and `reset-position` overwrite where the user dragged a widget.

| Check | Command | Expect |
|---|---|---|
| Running | `umbractl status` | version = Directory.Build.props |
| Option, live | `umbractl set sp500 symbol ^IXIC`, then `capture sp500 x.png` | the PNG shows the Nasdaq value |
| Validation | `umbractl set sp500 range 7d` | exit 1, "must be one of" |
| Catalog | `umbractl catalog` | clock + sp500 from GitHub |
| Install/remove | `umbractl install clock`, `capture clock c.png`, `remove clock` | clock drawn, then gone |
| Scaffold | `umbractl new t-widget`, `capture t-widget t.png`, `remove t-widget` | template renders |
| General | `umbractl general --refresh 10` | exit 1 (range 30-600) |
| Startup | `general --startup off`, then `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v Umbra`, then `--startup on` | value removed, then restored |
| Second launch | run `Umbra.exe` again | still one process; Settings opens |
| Settings pages | `capture settings:browse b.png` | catalog cards visible |
| MCP | `initialize`, `tools/list`, `create_widget`, `capture` over stdio (scratch node script) | image block returned |

Read every PNG you use as evidence. Manual only, so ask the user: Win+D keeps widgets visible, dragging moves and persists, multi-monitor and DPI changes.

Testing a dev build: exit the installed one first (`umbractl quit`), then `dotnet run --project src/Umbra`, and use `src/Umbra.Cli/bin/Debug/net10.0-windows/umbractl.exe`.
