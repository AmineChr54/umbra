---
title: Freshness and offline
description: How umbra.status tracks whether your widget's data is live, stale or offline, and how to show it.
sidebar: { order: 6 }
---

A widget that fetches should tell the user when its numbers are old. The SDK does the bookkeeping, so every widget looks the same.

![Live, stale and offline states of the status dot](/umbra/img/umbra-status.png)

## How it works

- Every `umbra.fetchJson` / `umbra.fetchText` outcome is recorded; HTTP errors and timeouts are failures. There's nothing to call.
- `umbra.status.state` is:
  - `live` after a success,
  - `stale` when the data is older than 3× the refresh interval,
  - `offline` after two failures in a row, or a failure when nothing has loaded since the widget started,
  - `none` until the first fetch finishes.
- `<html data-stale>` is set while the state is `stale` or `offline`. Dim your numbers with CSS (keep it to `opacity`):

```css
html[data-stale] .price { opacity: 0.55; }
```

## The status dot

`<umbra-status></umbra-status>` is an optional element, styled by `umbra.css` with tokens: a small dot (`--up` live, `--text-3` stale, a ring when offline). Hovering it shows "Updated 3 min ago"; offline keeps "Offline · last data 10:42" visible. Put it in a footer, and use `placement="below-end"` in a top-right header so the hover text opens downwards. It's hidden while the state is `none`.

## Overriding the bookkeeping

- `umbra.status.failed(err)` for a response you can't use (a fetch's own Error is only counted once).
- `umbra.status.ok(new Date(savedAt))` to show data restored from `umbra.store` as "last data" at startup.
- `umbra.status.onChange(fn)` calls `fn(state)` when the state changes.

## Testing the offline state

Start Umbra from a shell with `UMBRA_SIMULATE_OFFLINE=1`; every host fetch then fails:

```powershell
$env:UMBRA_SIMULATE_OFFLINE = 1
dotnet run --project src/Umbra      # or start the installed Umbra.exe from this shell
```

:::tip
A widget that may run on an older Umbra than its SDK should call `umbra.status?.failed(err)`.
:::
