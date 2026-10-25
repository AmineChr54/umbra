---
title: Linux port
description: Status and direction of the Linux version of Umbra (epic #172).
sidebar: { order: 10 }
---

Umbra is Windows 10 1809+ / Windows 11 only today. A Linux version is in progress, tracked in the epic [#172](https://github.com/AmineChr54/umbra/issues/172). Follow that issue for the current state: the plan and its sub-issues are the source of truth, and this page only explains the shape of the problem.

## What carries over

- **Widgets are web pages.** HTML, CSS and JavaScript don't need porting, and the widget and theme catalogs stay shared.
- **The widget SDK is one JavaScript API** (`window.umbra`), so the same page can run on any web view the host provides.
- **Automation is a protocol.** The control commands, `umbractl` and the MCP server describe what Umbra can do independently of how a given platform does it.

## What is Windows-specific (and must be reimplemented)

- [Desktop pinning](/umbra/docs/internals/desktop-pinning/): Progman ownership, `HWND_BOTTOM`, DWM corners.
- The [WebView2 host](/umbra/docs/internals/webview-host/) and its sandbox enforcement through `WebResourceRequested`.
- Tray, toasts, global hotkeys, media sessions, system metrics and fullscreen detection.
- The installer and the self-updater.

## Contributing

Pick a step from the epic, comment that you're on it, and follow the [dev setup](/umbra/docs/internals/dev-setup/) and [architecture](/umbra/docs/internals/architecture/) pages. Security rules apply to every platform: the [security model](/umbra/docs/internals/security/) lists the invariants a port must keep.

:::note
This page describes direction, not a release promise. Until a Linux build is published, the supported platforms are Windows 10 1809+ and Windows 11.
:::
