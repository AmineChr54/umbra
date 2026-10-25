---
title: "Walkthrough: the S&P 500 widget"
description: A guided tour of a real widget - manifest, fetching, the change math, an SVG chart, motion and hover - using widgets/sp500.
sidebar: { order: 12 }
---

`widgets/sp500` is a good model for a data widget: it declares one host, fetches, computes, draws an SVG chart, animates only when it's visible and shows freshness. Read the full source in the [repository](https://github.com/AmineChr54/umbra/tree/main/widgets/sp500); this page explains the parts.

## Files

```
widgets/sp500/
  widget.json   manifest, one host, three options
  index.html    the card markup
  sp500.css     styles (tokens, trend colors)
  sp500.js      fetch, compute, render, hover
  chart.js      pure chart math: samples, denoise, scale, smooth path, nearest
  preview.png   the Browse screenshot
  icon.png      the tab icon
```

## The manifest

```json
{
  "id": "sp500", "name": "S&P 500", "version": "1.1.1",
  "width": 340, "height": 196,
  "permissions": { "hosts": ["query1.finance.yahoo.com"] },
  "options": {
    "symbol": { "label": "Symbol", "type": "text", "default": "^GSPC", "hint": "Any Yahoo Finance symbol, e.g. ^IXIC, ^DJI, AAPL" },
    "label":  { "label": "Display name", "type": "text", "default": "" },
    "range":  { "label": "Chart range", "type": "select", "default": "1d",
                "choices": [{ "value": "1d", "label": "1 day" }, { "value": "5d", "label": "5 days" }] }
  }
}
```

One host is all it needs. Any other request would be blocked. Three options give you a different index per copy: add a second copy with `symbol` set to `^IXIC` and you have the Nasdaq next to it.

## 1. Fetch

```js
function url({ symbol, range }) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${RANGES[range].interval}`;
}

const json = await umbra.fetchJson(url(o));
```

`1d` uses 5-minute samples, `5d` uses 15-minute samples. The response is real JSON: `regularMarketPrice`, `chartPreviousClose`, the closes and timestamps, and the trading period for the open/closed dot. `null` gaps are dropped. A failure calls `umbra.status?.failed(err)`, so the status dot dims the numbers, and the widget only prints an error message when it has no data to show.

## 2. Compute

```js
const change = d.price - d.prev;
const pct = d.prev !== 0 ? (change / d.prev) * 100 : 0;
const trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
```

The sign picks the color (green, red or grey through `--up`, `--down`, `--flat`) and toggles `trend-up` / `trend-down` classes, so a Windows contrast theme gets an arrow instead of relying on color.

## 3. Draw the chart

The pure math lives in `chart.js`, so it's easy to reason about:

1. **Denoise:** a 3-point moving average on interior samples. The endpoints stay exact, so the live dot sits on the real last price.
2. **Scale:** the y-range always includes the previous close, so the dashed reference line stays inside the chart.
3. **Smooth curve:** a Catmull-Rom spline converted to cubic Béziers, with control points `C1 = P1 + (P2 - P0)/6` and `C2 = P2 - (P3 - P1)/6`. It passes through every sample with no corners.

The chart is SVG sized from the element (`clientWidth`/`clientHeight`) and redrawn by a `ResizeObserver`, so it stays crisp when the user resizes the widget.

## 4. Motion, only when it helps

```js
umbra.tween(shownPrice, d.price, 700, (v) => (el.price.textContent = umbra.fmt(v)));
```

The price counts to its new value with ease-out-cubic (`1 - (1 - t)^3`), and the line draws in via `stroke-dashoffset`. Both are skipped when the window is covered or animations are off: the code checks `document.visibilityState` and `data-motion`, and `umbra.tween` jumps to the end value by itself.

## 5. Hover

A binary-search-style `Chart.nearest` finds the sample closest to the pointer for the crosshair and tooltip. The time is formatted with `umbra.locale` and `umbra.hour12`, and the number with `umbra.fmt`, so a German Windows shows `7.744,06`.

## 6. Lifecycle

```js
new ResizeObserver(() => current && drawChart()).observe(el.chart);
umbra.onSettings(() => load());
umbra.every(load);
```

`umbra.every(load)` runs now and every refresh interval; `onSettings` reloads when an option changes. Double-clicking the card calls `umbra.openUrl` to open the symbol on Yahoo Finance.

:::note
Market data comes from Yahoo's unofficial endpoint. It may be delayed or change without notice, so don't use it for trading.
:::
