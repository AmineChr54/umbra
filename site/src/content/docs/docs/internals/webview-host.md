---
title: WebView2 host and the bridge
description: How Umbra creates WebView2 environments, serves widgets from virtual hosts, enforces the sandbox with WebResourceRequested and bridges the page to C#.
sidebar: { order: 3 }
---

## The environment

`WebHost.cs` creates the WebView2 environment. In [portable mode](/umbra/docs/internals/portable-mode/) the WebView2 cache lives in the portable `data` folder too. Hardware acceleration and the proxy are settings (`umbractl general --hardware-acceleration`, `--proxy`) that apply on restart.

## Virtual hosts

Widgets aren't served from disk paths or `file://`. WebView2 virtual host mappings expose:

| Host | Serves |
|---|---|
| `umbra.local` | `shared/` (`umbra.js`, `umbra.css`, tab icons) and the host-owned pages such as the crash page |
| `community.umbra.local` | `%APPDATA%\Umbra\widgets\<id>\`, as `https://community.umbra.local/<id>/` |

## The sandbox

`WebHost.InitAsync` registers a **`WebResourceRequested`** filter for every request the page makes. The decision:

1. `umbra.local`, `community.umbra.local`, `data:` and `blob:` → allowed.
2. An **HTTPS** request whose host is in the widget's `permissions.hosts` → allowed.
3. Anything else → **403**, and the blocked request is recorded (shown on Data & privacy and in `umbra.log`).

Top-level navigation off the virtual hosts is cancelled, and links open in the user's browser. New windows are denied, and devtools and the browser context menu are off.

`umbra.fetchJson` and `fetchText` go through the host (so CORS doesn't apply) and are checked by `WidgetManifest.AllowsUrl` (HTTPS plus a declared host).

## The bridge

Pages talk to the host with `postMessage`. `shared/umbra.js` exposes the `umbra` object; `WidgetWindow.cs` handles the messages (`fetchJson`, `drag`, `rendered`, `resize`, `zoom`, and the calls behind `umbra.store`, `umbra.notify`, `umbra.media` and `umbra.run`). The host answers with settings pushes (options, scale, locale, `paused`, theme CSS) that arrive as `umbra.onSettings`. Security-relevant messages are gated on **physical input**: `resize` and `zoom` need edit mode, an unlocked widget and a real mouse press or <kbd>Ctrl</kbd> over that window; `requestFocus` needs a recent mouse press; `media.control` needs a click within the last 2 seconds; a command approval prompt needs a click.

## Screenshots

`WidgetWindow.CaptureAsync` and `SettingsWindow.CaptureAsync` take a PNG of just that WebView, after the page calls `umbra.rendered()`. `umbractl capture` uses them, which is why a capture never includes anything else on screen.

## Settings is a WebView too

The Settings window is an HTML app in `settings/` served from the host, with its own message protocol to `SettingsWindow.cs`. Catalog theme tokens are re-validated before Settings draws them. Host-drawn boxes (such as `ConfirmNewAccess`) are used for security decisions, never a page.

## Related

[Security model](/umbra/docs/internals/security/) · [Crash recovery](/umbra/docs/internals/crash-recovery/) · [Architecture](/umbra/docs/internals/architecture/)
