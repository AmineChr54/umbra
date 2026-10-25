---
title: Updates
description: How Umbra updates itself, how widget and theme updates work, and why an update can wait for your approval.
sidebar: { order: 8 }
---

## Updating Umbra

Umbra checks GitHub once a day for a new release. When one is found it downloads the installer in the background and verifies it, then shows a **dot on the tray icon**. Install it from the tray menu or **Settings → About**.

Installing closes Umbra, runs the installer silently with a small dark progress window, and starts the new version. After an update, **About** shows the release notes once.

```powershell
umbractl check-update       # is a newer version out? (it never installs one)
umbractl general --updates off    # stop the daily check
```

What Umbra will install is restricted: the installer must be an HTTPS download from this project's GitHub releases and named `UmbraSetup-<version>.exe`. Automation can check for updates but can never install one. See [Updates and installer](/umbra/docs/internals/updates-installer/).

:::note
Portable copies don't update themselves. **About** shows a download link instead.
:::

## Updating widgets and themes

Installed community widgets show an **Update** button on **Browse** when the catalog has a newer version. To update everything:

```powershell
umbractl update --all
```

A failure doesn't stop the rest; failures are listed in the result.

### Updates that ask for more

An update never grants new access silently. Umbra compares the new `widget.json` with the installed one and, if the update adds **hosts, system readings, media, notifications or commands**, it waits:

- **Settings** shows a box listing exactly what's new, and you accept or decline.
- `umbractl install <id>` refuses until you repeat it with `--accept-permissions`.
- `umbractl update --all` skips such widgets and lists them, so you accept them one by one.
- The MCP server strips `--accept-permissions`, so an agent can't approve for you.

The widget's `changelog` (if it has one) is shown with the request.

## Version numbers

Umbra and its tools share one version, from `Directory.Build.props`. Widgets and themes have their own `version`, bumped on every change; that's how Browse knows to offer an update.
