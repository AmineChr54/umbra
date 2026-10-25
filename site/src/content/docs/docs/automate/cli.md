---
title: umbractl command reference
description: Every umbractl command with its arguments and flags, grouped by task.
sidebar: { order: 2 }
---

`umbractl` is the command-line client. The installer puts it on your `PATH`; a portable copy has `umbractl.exe` next to `Umbra.exe` and talks to that copy. Every command **prints JSON** (a text result such as `diagnostics` prints as plain text), exits `0` on success and `1` with `umbractl: <error>` on stderr on failure. If Umbra isn't running, it's started in the background first. `umbractl help` prints this list.

`<id>` is a widget id, or a copy like `sp500#2`. Square brackets are optional.

## Inspect

| Command | What it does |
|---|---|
| `status` | Version, paths, open widgets, monitors and general settings |
| `list` | Widgets with their settings, option schema and window bounds |
| `logs [n]` | The last *n* log lines |
| `diagnostics` | Markdown block for bug reports: versions, monitors, enabled widgets, last 30 log lines. No option values, proxy address or widget data |
| `privacy [id]` | Hosts, commands, saved data and blocked requests per widget (read-only) |
| `approvals [id]` | Local commands widgets declare and whether you approved them (read-only) |
| `check-update` | Is a newer Umbra on GitHub? (it never installs) |

## Place and configure widgets

| Command | What it does |
|---|---|
| `enable <id>` / `disable <id>` | Show or hide a widget |
| `lock <id>` / `unlock <id>` | Lock or unlock moving, resizing and zooming |
| `move <id> <x> <y>` | Position in physical pixels |
| `reset-position <id>` | Back to the default position |
| `configure <id> [flags]` | Change several settings at once (below) |
| `set <id> <option> <value>` | Change a widget option, typed by its schema |
| `add-instance <id>` | Run another copy (own options, position, data); ids look like `sp500#2` |
| `remove-instance <id#N>` | Remove an extra copy and its data |
| `refresh [id]` | Fetch fresh data now |
| `reload` | Re-scan widget folders |

`configure` flags:

| Flag | Values |
|---|---|
| `--scale` | `0.5`–`3`, or a percent like `150%` (size and zoom) |
| `--enabled`, `--locked` | `on` or `off` |
| `--x`, `--y` | Position in physical pixels |
| `--monitor` | A monitor number from `status`, or `primary` (the widget keeps its offset and survives monitor changes) |
| `--refresh` | `30`–`600` seconds, or `default` |
| `--opacity` | `0.2`–`1`, or `opaque` |
| `--start-hidden` | `on` or `off` |
| `--show-from`, `--show-to` | `HH:MM` daily range; `--show-from always` clears it |
| `--show-on-ac` | `on` or `off` |

## Arrange

| Command | What it does |
|---|---|
| `edit-mode [on\|off]` | Move, resize and zoom by hand; no argument reads the state |
| `peek [seconds]` | Raise widgets above other windows for a few seconds (never takes focus) |
| `safe-mode [on\|off]` | Community widgets off, not saved; no argument shows the state |
| `layouts [list\|save\|apply\|delete <name>\|rename <name> <new>]` | Saved arrangements of positions, sizes and enabled widgets |
| `groups [list\|create <id> [name]\|join\|activate <group> <id>\|leave <id>\|next\|previous\|delete <group>\|reorder <group> <id> <i>\|cycle <group> <s\|off>\|rename <group> <name>\|icon <id> <name\|default>]` | Tab groups: widgets sharing one spot, one visible at a time |
| `hotkeys [action keys\|off\|reset]` | Global hotkeys: `edit-mode`, `refresh-all`, `toggle-widgets`, `peek`, `open-settings`, e.g. `hotkeys edit-mode Ctrl+Alt+E` |

## App settings

`general` (alias of the protocol's `set-general`) changes app-wide settings:

| Flag | Values |
|---|---|
| `--refresh` | `30`–`600` seconds |
| `--animations`, `--startup`, `--updates`, `--hide-fullscreen`, `--energy-saver` | `on` or `off` |
| `--peek-seconds` | `1`–`60` |
| `--corner-radius` | `default`, `sharp`, `round` |
| `--animation-speed` | `normal`, `calm`, `off` |
| `--default-scale` | `0.5`–`3` |
| `--log-level` | `errors`, `normal`, `verbose` |
| `--developer-mode`, `--hardware-acceleration` | `on` or `off` (GPU needs a restart) |
| `--startup-delay` | `0`–`300` seconds |
| `--proxy` | `system`, `none` or `https://host:port` (needs a restart) |
| `--snap` | `on` or `off` (master switch) |
| `--snap-grid` | `0`–`200` px (`0` = off) |
| `--snap-edges` | `on` or `off` |
| `--snap-gap` | `0`–`100` px kept between neighbours (`0` = touch) |

Appearance flags: `--accent "#ff7a59"` (or `windows`, or empty for the theme), `--light-text`, `--ui-font`, `--font-scale` (`0.8`–`1.4`), `--border`, `--reduce-transparency`:

```powershell
umbractl general --refresh 120 --snap-grid 20
umbractl general --corner-radius round --animation-speed calm --log-level verbose --proxy none
umbractl set-general --accent "#ff7a59" --light-text on --ui-font Consolas --font-scale 1.1 --border off --reduce-transparency on
```

## Catalog and themes

| Command | What it does |
|---|---|
| `catalog` | Community widgets on GitHub, with installed and update flags |
| `install <id> [--accept-permissions]` | Install or update a catalog widget. An update that adds hosts, media, notifications or commands is refused until you repeat it with the flag |
| `remove <id>` | Uninstall a catalog widget and delete its data for good |
| `update --all` | Update every installed catalog widget that has a newer version. Failures are listed and the rest still update; updates that add permissions are skipped and listed |
| `themes` | Installed themes and the community theme catalog |
| `theme [id]` | Show the active theme, or switch to an installed one (live; `default` is Umbra Black) |
| `install-theme <id>` / `remove-theme <id>` | Install, update or uninstall a community theme |

## Build and test widgets

| Command | What it does |
|---|---|
| `new <id> [--name N] [--dir D]` | Scaffold a working widget (default: the community folder, loaded at once) |
| `create <folder>` | Load a widget folder from disk, e.g. `widgets/my-widget` in the repo |
| `capture <id\|settings:<page>> [file.png]` | PNG of a widget or Settings page (`general`, `widgets`, `layouts`, `browse`, `themes`, `hotkeys`, `privacy`, `about`) |
| `data <id> [key] [json]` | A widget's saved data (`umbra.store`): all, one key, or set a key |
| `data <id> --remove <key>` / `--clear` | Delete a key, or everything |
| `settings [page]` | Open the Settings window |

## Back up

| Command | What it does |
|---|---|
| `backup <file>` | Settings, layout, theme, hotkeys and widget data (never approvals) |
| `restore <file>` | Restore from a backup; validated first, approvals are not restored |

## Other

| Command | What it does |
|---|---|
| `quit` | Exit Umbra |
| `send <command> [json]` | A raw [control-protocol](/umbra/docs/automate/control-protocol/) command, e.g. `umbractl send install-theme '{"id":"ember"}'` |
| `mcp` | Run as an [MCP server](/umbra/docs/automate/mcp/) on stdio |
| `help` | The built-in help |

:::note
`umbractl remove` and the MCP `remove_widget` delete for good. Only **Settings → Remove** keeps a widget in the trash for 7 days with Undo.
:::
