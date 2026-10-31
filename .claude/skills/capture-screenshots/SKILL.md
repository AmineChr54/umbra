---
name: capture-screenshots
description: Regenerate Umbra's README/docs screenshots (Settings pages, widget demos, widget preview.png) with umbractl capture, and inspect them before committing. Use when UI changed or docs images are stale.
---

# Capture screenshots

Screenshots come from WebView2 itself (`CapturePreviewAsync`), so they never include other windows. Never use desktop screen capture.

```powershell
umbractl status                                   # Umbra running? It starts if needed
foreach ($p in "home","widgets","browse","about") { umbractl capture "settings:$p" "docs/settings-$p.png" }
umbractl install sp500   # S&P 500 is a catalog widget, install it first
umbractl capture sp500 docs/demo-umbra.png        # widget demo for the README
umbractl capture <id> widgets/<id>/preview.png    # catalog preview for a widget
```

- Captures are physical pixels (2x on a 200% display). Take them on a 200% display, or note the scale.
- **Read every PNG before committing.** Check for personal data (local paths, account names, custom symbols) and for half-loaded states (empty Browse, spinners). Re-capture if needed.
- The `browse` capture waits for the live catalog from GitHub. If it's empty, check your network or `umbractl catalog`.
- A capture opens the Settings window and closes it again if it wasn't open before.
