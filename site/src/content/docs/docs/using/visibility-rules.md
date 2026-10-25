---
title: Visibility and refresh rules
description: Control when each widget is shown, how opaque it is, and how often it updates, including what Umbra does while the PC is locked or on battery saver.
sidebar: { order: 5 }
---

Everything here is per widget (and per copy) unless noted, in **Settings → My widgets**, from the right-click menu, or with `umbractl configure`.

## When a widget is shown

| Setting | What it does | `umbractl configure` flag |
|---|---|---|
| Enabled | Show or hide the widget | `--enabled on\|off` (or `enable`/`disable <id>`) |
| Start hidden | Opens hidden until you show it | `--start-hidden on\|off` |
| Show only between | A daily time range | `--show-from 08:00 --show-to 18:00` (`--show-from always` clears it) |
| Show only on AC power | Hide on battery | `--show-on-ac on` |
| Opacity | Dim a widget, `0.2` to `1` | `--opacity 0.8` (or `opaque`) |

```powershell
umbractl configure clock --show-from 08:00 --show-to 18:00 --show-on-ac on
umbractl configure clock --opacity 0.6
```

**All widgets at once:** the `toggle-widgets` [hotkey](/umbra/docs/using/hotkeys-peek-layouts/) shows or hides every widget, and **General → Hide widgets during fullscreen apps and games** (`umbractl general --hide-fullscreen on`) hides them while a fullscreen app is in the foreground.

## How often a widget updates

Widgets that fetch data refresh on an interval. The default is set in **General** (30 to 600 seconds), and each widget can have its own:

```powershell
umbractl general --refresh 120                 # default for all widgets
umbractl configure sp500 --refresh 300         # this widget only (or `default`)
umbractl refresh                               # fetch fresh data now, for all (or one id)
```

Umbra also refreshes widgets after the PC resumes from sleep, when the network comes back and after a long lock, at most once every 10 seconds.

## Automatic slowing and pausing

- **Locked or display off:** widgets are paused. They get one refresh when the PC is unlocked or the display is back on.
- **Windows Energy Saver:** refresh intervals are stretched 4x while it's on. Turn this off with `umbractl general --energy-saver off`.
- **Animations:** off in **General**, or follow the Windows reduced-motion preference. Calm animation speed doubles animation durations.

Widget authors read these from `umbra.settings` (`paused`, `energySaver`, `refreshSeconds`), see the [JavaScript API](/umbra/docs/widgets/javascript-api/).
