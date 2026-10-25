---
title: Portable mode
description: How a portable copy keeps everything in one folder, what it doesn't do, and how the pipe and single-instance names avoid collisions.
sidebar: { order: 7 }
---

A portable Umbra keeps its data next to the program, runs alongside an installed copy and leaves the rest of the machine alone.

## Enabling it

Put an empty **`portable.txt`** next to `Umbra.exe`. The release zip `Umbra-<version>-portable.zip` already has one; to make any folder portable, create the file yourself.

## What changes

| | Installed | Portable |
|---|---|---|
| Data (settings, widgets, themes, logs) | `%APPDATA%\Umbra` | `<AppDir>\data` |
| WebView2 cache | user profile | `<AppDir>\data` |
| Start with Windows | yes, optional | no |
| Self-update and self-install | yes | no (Settings shows a download link) |
| `umbractl` | on `PATH` | the `umbractl.exe` next to the exe finds the same copy |
| Single instance | one per user | one per data folder |

The `UMBRA_DATA_DIR` environment variable still **wins** over both. Tests use it to point at a temporary directory.

## No collisions

The control pipe and the single-instance mutex are named per user, and a portable copy adds a **hash of its data folder** to the name (`PortableMode.Hash`, in `Protocol.cs`). That's why a portable copy can run beside an installed one, and why two portable copies in different folders don't see each other.

## Toasts

Toast notifications need an AppUserModelID. The installer provides one; a portable or source run registers its own under `HKCU\Software\Classes\AppUserModelId`, the one registry write portable mode makes.

## Related

[Install](/umbra/docs/get-started/install/#portable-copy) · [Data, privacy and backups](/umbra/docs/using/data-privacy-backups/)
