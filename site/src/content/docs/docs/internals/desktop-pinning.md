---
title: Desktop pinning
description: How widget windows stay under every app, survive Win+D and Explorer restarts, and never take focus.
sidebar: { order: 2 }
---

The core trick of Umbra is a window that behaves like part of the desktop. It lives in `DesktopPin.cs` and `Native.cs`.

## Owned by Progman

Each widget window is **owned by `Progman`**, the desktop shell window. An owned window is shown and hidden with its owner and stays above it, which keeps widgets visible when you press <kbd>Win</kbd>+<kbd>D</kbd> (which minimizes ordinary windows but leaves the desktop). The ownership is re-applied when the window is shown and **when Explorer restarts**, so a crashed shell doesn't strand your widgets.

## Kept at the bottom

The window is a **tool window** (not in the taskbar or Alt-Tab) and every `WM_WINDOWPOSCHANGING` message is rewritten to `HWND_BOTTOM`, so apps always cover it, whatever they or Windows try to do to the z-order. [Peek](/umbra/docs/using/hotkeys-peek-layouts/#peek) temporarily lifts them, then puts them back.

## Never activates

Widget windows have no activation: clicking one doesn't change which app is foreground. They get keyboard focus only **right after a physical mouse press on them** (`WidgetWindow.TakeKeyboardFocus`), so a widget can't pull focus while you type elsewhere. The page's `umbra.requestFocus()` is honoured only in that situation.

## Why it's sharp

Rainmeter-style skins draw on translucent layered windows, where Windows disables ClearType. Umbra's windows are **opaque true black**, with DWM-rounded corners and a hairline border drawn by DWM, so text renders with full DirectWrite quality. On OLED, black pixels are off, so the card seems to float on the wallpaper.

## The edit-mode pill

`EditPill.cs` draws the "Editing widgets · Snap · Done" pill as its own non-activating, Progman-owned window just above the widgets. It's not a WebView, so it never appears in a capture.

## Edit mode overlay

In edit mode, unlocked widgets are covered by Umbra's overlay with an outline and a corner handle. The host moves, resizes and zooms only during a physical mouse press (move, resize) or while <kbd>Ctrl</kbd> is physically held (zoom), never because a page asked. See the [security model](/umbra/docs/internals/security/).

## Related

[WebView2 host](/umbra/docs/internals/webview-host/) · [Architecture](/umbra/docs/internals/architecture/)
