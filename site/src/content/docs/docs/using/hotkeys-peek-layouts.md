---
title: Hotkeys, peek and layouts
description: Global hotkeys, the peek gesture, and named layouts that follow your monitor setup.
sidebar: { order: 3 }
---

## Hotkeys

Global hotkeys work from any app. None are set by default. Assign them in **Settings → Hotkeys** or from the command line.

| Action | What it does |
|---|---|
| `edit-mode` | Turns [edit mode](/umbra/docs/using/arranging-widgets/) on or off |
| `refresh-all` | Asks every widget to fetch fresh data now |
| `toggle-widgets` | Shows or hides all widgets |
| `peek` | Raises widgets above other windows for a few seconds |
| `open-settings` | Opens Settings |

```powershell
umbractl hotkeys                          # read the current hotkeys and their status
umbractl hotkeys edit-mode Ctrl+Alt+E     # set one
umbractl hotkeys edit-mode off            # clear one
umbractl hotkeys reset                    # clear all
```

Each hotkey reports a status: `active`, `off`, or `failed` with the reason, for example when another app already uses that combination.

## Peek

Peek raises your widgets above every other window for a few seconds, then puts them back at the bottom, without moving or focusing anything. It's the quick way to glance at your widgets without closing your apps. The duration is 5 seconds by default; change it with `umbractl general --peek-seconds 1-60`, or run it directly:

```powershell
umbractl peek          # default duration
umbractl peek 10       # ten seconds
```

Peek does nothing while widgets are hidden.

## Layouts

A layout is a saved arrangement: the position, size and enabled state of every widget. Options and saved data are never touched by a layout.

```powershell
umbractl layouts                      # list
umbractl layouts save Work            # store the current arrangement
umbractl layouts apply Work           # switch to it, live
umbractl layouts rename Work Docked
umbractl layouts delete Docked
```

Saving pins the layout to the monitor setup you saved it on. An opt-in setting makes Umbra apply the matching layout automatically when you dock or undock. Layouts are managed on the **Layouts** page of Settings, where you can also rename and delete them.

## Hide during fullscreen

**General → Hide widgets during fullscreen apps and games** (`umbractl general --hide-fullscreen on`) keeps widgets out of the way while a fullscreen window is in the foreground.
