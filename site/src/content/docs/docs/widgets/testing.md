---
title: Testing with capture
description: The develop-capture-fix loop with umbractl, including pixel-exact screenshots, sizes, simulated offline, logs and testing the catalog locally.
sidebar: { order: 10 }
---

The fastest way to build a widget is a tight loop: change a file, reload, **look at the result**, repeat. `umbractl` (installed with Umbra) makes that loop scriptable, and it's the same loop an AI agent uses over MCP.

## The loop

```powershell
umbractl new my-widget                  # scaffold a working widget and show it
umbractl create .\widgets\my-widget     # (re)load a folder you are editing elsewhere, e.g. in the repo
umbractl reload                         # re-scan widget folders after editing files in place
umbractl capture my-widget shot.png     # PNG of just that widget
umbractl logs                           # load errors and requests blocked by the sandbox
```

If your widget lives in `%APPDATA%\Umbra\widgets\my-widget`, run `umbractl reload` after each edit. If you're editing in a repo checkout, load it with `umbractl create <folder>`.

## Capture

`umbractl capture <id|settings:page> [file.png]` writes a pixel-exact PNG of one surface: a widget (by id, or `sp500#2` for a copy) or a Settings page (`settings:general`, `widgets`, `layouts`, `browse`, `themes`, `hotkeys`, `privacy`, `about`). It captures only that WebView, never the rest of your screen, and waits for your widget to call `umbra.rendered()`. A 2× capture on black is exactly what Browse wants as `preview.png`.

:::tip
Look at the PNG. Don't assume a change worked because the code ran.
:::

## Try states and sizes

```powershell
umbractl set my-widget city Paris            # an option value, typed by the schema
umbractl configure my-widget --scale 2       # how it looks at 200 % (back with --scale 1)
umbractl configure my-widget --scale 0.5     # and at 50 %
umbractl general --animation-speed off       # motion off
umbractl data my-widget                      # what the widget saved with umbra.store
umbractl data my-widget tasks '[{"title":"x"}]'   # set a key to test restore paths
umbractl privacy my-widget                   # hosts, commands, saved data, blocked requests
```

For the offline state, start Umbra from a shell with `UMBRA_SIMULATE_OFFLINE=1`: every host fetch fails, so you can check what your widget shows when data is old.

## Check the sandbox

`umbractl logs` lists blocked requests. If your widget calls a host it didn't declare, you'll see the 403 there and in **Data & privacy**; add the host to `permissions.hosts` only if the widget really needs it.

## Test the catalog end to end

To test the Browse page with your local repo, point Umbra at it:

```powershell
$env:UMBRA_CATALOG_BASE = "file:///C:/path/to/umbra/widgets"
node scripts/catalog.mjs          # validates and rebuilds widgets/index.json and themes/index.json
& "$env:LOCALAPPDATA\Programs\Umbra\Umbra.exe"
```

## Through an AI agent

An MCP client does the same with `create_widget`, `configure_widget`, `widget_data`, `read_logs` and `capture`; see [MCP server](/umbra/docs/automate/mcp/).
