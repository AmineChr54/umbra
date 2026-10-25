---
title: Updates and installer
description: How the per-user installer is built, how self-update downloads and runs it, and the update window.
sidebar: { order: 6 }
---

## The installer

`installer/Umbra.iss` is an [Inno Setup](https://jrsoftware.org/isinfo.php) 6 script that installs **per user** (no admin prompt) to `%LOCALAPPDATA%\Programs\Umbra`, adds `umbractl` to your `PATH`, creates the Start menu shortcut (whose AppUserModelID `AmineChr54.Umbra` gives toasts their identity), and asks whether Umbra should start with Windows ("Start with Windows" is the `HKCU\...\Run\Umbra` value, which the installer and the Settings toggle both read and write).

The version comes from `Directory.Build.props`, which `build.ps1` reads. One version covers `Umbra.exe`, `umbractl.exe` and the installer.

```powershell
powershell -File build.ps1     # publishes both exes + installer -> dist/UmbraSetup-<ver>.exe
```

## Self-update

`Updates.cs` has two halves:

- **`Updates`**: pure logic. Version comparison, release parsing and URL validation.
- **`UpdateService`**: checks GitHub daily, downloads and **verifies** the installer in the background, then runs it silently with `/UPDATE=1`. `Umbra.iss` then starts `Umbra.exe --updated`. Release notes are shown once after an update, tracked through `General.LastSeenVersion`.

The installer must be an **HTTPS** download from `github.com/AmineChr54/umbra/releases/download/` and named `UmbraSetup-<release version>.exe`. Control commands (`check-update`) may look for updates but never install one: installing is left to the user (tray menu or Settings → About).

## The update window

`src/Umbra.Updater/` builds `Umbra.Updater.exe`, a small dark window that shows the update's progress: closing Umbra, installing (with progress derived from the installer's log), and starting the new version. `UpdateService.InstallAsync` copies it to a temp folder and runs it, and it runs the silent installer. Without it, the installer runs invisibly. `UpdaterArgs` (shared source) is its command-line contract.

## The tray badge

`Tray.cs` draws the "update ready" dot on the tray icon. Its `--restart` flag makes the new process wait for the old one's single-instance mutex, so a restart doesn't race.

## Portable copies

Portable copies neither self-update nor self-install; Settings shows a download link. See [Portable mode](/umbra/docs/internals/portable-mode/).

## Related

[Updates (user guide)](/umbra/docs/using/updates/) · [Release process](/umbra/docs/internals/release-process/) · [Security model](/umbra/docs/internals/security/)
