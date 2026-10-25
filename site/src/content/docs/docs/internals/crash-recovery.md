---
title: Crash recovery
description: What Umbra does when a widget's renderer or the WebView2 browser process fails, and where you can see it.
sidebar: { order: 5 }
---

WebView2 runs each widget's page in a separate renderer process. `CrashRecovery.cs` and `shared/crashed.html` implement Umbra's policy for `CoreWebView2.ProcessFailed`.

## Policy

| Failure | Umbra's response |
|---|---|
| A widget's **renderer exits** | Reload the widget. At most **3 reloads per 10 minutes** |
| Still failing after that | Show the host-owned **"This widget stopped working"** page, with a **Reload** button |
| A **hung** renderer | Only logged; Umbra doesn't kill it |
| The **browser process** exits | Recreate the WebView2 environment and the view |

The host-owned page comes from the virtual host `umbra.local` (`shared/crashed.html`), so it keeps working even if the widget's own files are the problem.

## Visibility

**Settings → Data & privacy** shows each widget's crash count, and the log (`umbractl logs`) has the details. Together with [safe mode](/umbra/docs/using/data-privacy-backups/#safe-mode), that's how you find a misbehaving widget.

## Related

[WebView2 host](/umbra/docs/internals/webview-host/) · [Troubleshooting](/umbra/docs/using/troubleshooting/)
