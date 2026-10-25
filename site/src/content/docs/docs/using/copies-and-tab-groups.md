---
title: Copies and tab groups
description: Run a widget more than once with separate options, and stack several widgets in one spot with tab groups.
sidebar: { order: 4 }
---

## Copies

**My widgets → Add another copy** (or `umbractl add-instance <id>`) runs the same widget a second time. A copy has an id like `sp500#2`, and that id works anywhere a widget id does.

Each copy is a separate window with its own:

- options (follow the S&P 500 in one and the Nasdaq in the other),
- enabled and locked state, position and size,
- saved data (`umbra.store`).

```powershell
umbractl add-instance sp500                 # creates sp500#2
umbractl set sp500#2 symbol ^IXIC
umbractl remove-instance sp500#2            # removes the copy and its data
```

The first copy can't be removed, only disabled. Removing an extra copy from the right-click menu offers **Undo** in the tray menu for a short while.

## Tab groups

A tab group lets several widgets share one spot on the screen with only one visible at a time. A hover tab strip switches between them, and the visible tab takes over the group's shared position and size.

```powershell
umbractl groups                              # list groups
umbractl groups create todo "Work"           # a new group, starting from the widget copy "todo"
umbractl groups join <group> clock           # add a widget copy to a group
umbractl groups activate <group> clock       # show one
umbractl groups next <group>                 # also: previous
umbractl groups cycle <group> 30             # rotate every 30 s (5-3600; off to stop)
umbractl groups rename <group> "Focus"
umbractl groups icon clock rocket            # tab icon: a bundled name, or `default`
umbractl groups reorder <group> clock 0
umbractl groups leave clock                  # remove a widget from its group
umbractl groups delete <group>               # ungroup; the widgets stay
```

`<group>` is the group id that `umbractl groups` prints.

Tab icons come from the widget's own `icon.png` (64×64, light grey on transparent) or from the bundled icon set, which you pick in Settings or with `umbractl groups icon`. Your choice wins over the widget's icon.
