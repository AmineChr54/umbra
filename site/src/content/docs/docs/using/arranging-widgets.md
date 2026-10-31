---
title: Arranging widgets
description: Edit mode, snapping, resizing and zooming, locking, and moving widgets between monitors.
sidebar: { order: 2 }
---

## Edit mode

Turn edit mode on from the tray menu, from **My widgets**, with a [hotkey](/umbra/docs/using/hotkeys-peek-layouts/), or with `umbractl edit-mode on`. Unlocked widgets get an outline and a corner handle, and Umbra covers them with an overlay so presses move them instead of clicking inside the page.

| Action | How |
|---|---|
| Move | Drag the widget |
| Resize | Drag the right edge, bottom edge or corner handle |
| Zoom | Hold <kbd>Ctrl</kbd> and scroll over the widget |
| Select | Click it (stronger outline); it also takes the keyboard |
| Nudge | Arrow keys: 1 px, or 10 px (one grid step when snapping is on) with <kbd>Shift</kbd> |
| Snap | Hold <kbd>Shift</kbd> while dragging (default); or set `--snap-mode always` or General > Advanced > Snapping so widgets always snap and Shift skips it |
| Leave | **Done** on the pill, or <kbd>Esc</kbd> on a clicked widget |

A small **Editing widgets · Snap · Done** pill is drawn at the top of each monitor that has widgets. It has the snap switch and the **Done** button. Edit mode is off again after a restart.

## Size and zoom

Each widget has a design size from its `widget.json`. You can resize freely from **50 %** to **300 %** of it on each side. Widgets zoom like a web page, so text and charts stay sharp. A widget made only wider or taller keeps its zoom and gets more room; one made bigger on both sides is drawn larger. Set the size exactly in **My widgets**, or with `umbractl configure <id> --scale 1.5`.

## Snapping

While you drag in edit mode, widgets snap to a grid, to the edges and centers of other widgets, and to a gap you choose, and guide lines show what you're aligning to. Configure it in **General** or from the command line:

```powershell
umbractl general --snap-grid 20      # grid in px (0 = off)
umbractl general --snap-edges on     # snap to other widgets' edges and centers
umbractl general --snap-gap 12       # px kept between neighbours (0 = touch)
umbractl general --snap off          # master switch (also on the edit-mode pill)
umbractl general --snap-mode always  # shift (default) = snap only while Shift is held; always = Shift skips snapping
```

## Locking

A locked widget doesn't move, resize or zoom, even in edit mode. Lock widgets once you're happy with the layout: **My widgets → Lock**, the right-click menu, or `umbractl lock <id>`.

## Positions and monitors

Positions are screen coordinates in physical pixels. A widget remembers which monitor it was on, keeps its offset, and survives monitor changes. Move one to another monitor with `umbractl configure <id> --monitor 2` (a number from `umbractl status`, or `primary`). **Reset position** puts a widget back at its default.

## The right-click menu

Right-click a widget for **Refresh, Options** (opens Settings on its card), **Lock, Edit mode, Hide** and **Add another copy**. Extra copies can be removed from the menu, with **Undo** in the tray menu. A widget that handles right-click itself keeps its own menu; <kbd>Shift</kbd>+right-click always opens Umbra's.

## Save the arrangement

Once it looks right, [save it as a layout](/umbra/docs/using/hotkeys-peek-layouts/#layouts) so you can bring it back after a dock or undock.
