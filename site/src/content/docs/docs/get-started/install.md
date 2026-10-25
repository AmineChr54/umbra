---
title: Install
description: Install Umbra with the per-user installer or as a portable copy, build it from source, and uninstall it.
sidebar: { order: 2 }
---

## Installer (recommended)

1. Download **`UmbraSetup.exe`** from the [latest release](https://github.com/AmineChr54/umbra/releases/latest).
2. Run it. It installs for your user only, so there's no admin prompt, and asks whether Umbra should start with Windows.
3. Umbra starts in the **tray** (the notification area next to the clock). Click the tray icon, or open Umbra from the Start menu, to open **Settings**.
4. Go to **Browse** and install your first widgets.

The installer puts the app in `%LOCALAPPDATA%\Programs\Umbra` and adds `umbractl` to your `PATH`. Your data lives in `%APPDATA%\Umbra`:

| Path | What's in it |
|---|---|
| `settings.json` | All settings: general options, each widget's options, position and size |
| `widgets\` | Widgets you installed from Browse or wrote with an agent |
| `data\<id>.json` | Data each widget saved with `umbra.store` (1 MB cap per widget) |
| `themes\` | Installed themes |
| `trash\` | Widgets you removed in Settings, kept 7 days for **Undo** |
| `umbra.log` | The log (Settings → Data & privacy → Open log) |

Umbra checks GitHub once a day for a new version and downloads it in the background. A dot on the tray icon means an update is ready; see [Updates](/umbra/docs/using/updates/).

:::note[SmartScreen]
If Windows shows "Windows protected your PC", click **More info** → **Run anyway**. New releases build up SmartScreen reputation over time.
:::

## Portable copy

Download `Umbra-<version>-portable.zip` from the [releases page](https://github.com/AmineChr54/umbra/releases), unzip it anywhere and run `Umbra.exe`.

The `portable.txt` file next to `Umbra.exe` keeps all data (settings, widgets, logs and the WebView2 cache) in a `data` folder beside the exe. Portable copies:

- don't start with Windows and don't update themselves (Settings → About shows a download link instead),
- run alongside an installed copy without sharing anything,
- work with the `umbractl.exe` next to them, which finds the same copy.

To make any folder portable, create an empty `portable.txt` next to `Umbra.exe`. See [Portable mode](/umbra/docs/internals/portable-mode/) for how it works.

## winget

A winget package (`AmineChr54.Umbra`) is prepared with every release but not yet published to the winget repository. Until then, use the installer.

## Build from source

You need the .NET 10 SDK, Node.js and Inno Setup 6.

```powershell
git clone https://github.com/AmineChr54/umbra
cd umbra
powershell -File build.ps1          # both exes + installer -> dist/UmbraSetup-<version>.exe
dotnet run --project src/Umbra      # or run from source (quit the installed Umbra first)
```

See [Dev setup and tests](/umbra/docs/internals/dev-setup/) for the full workflow.

## Uninstall

Open **Settings → Apps → Installed apps** in Windows, find **Umbra** and choose **Uninstall**. Your data in `%APPDATA%\Umbra` stays, so a reinstall picks up where you left off. Delete that folder to remove everything. For a portable copy, quit Umbra from the tray and delete its folder.
