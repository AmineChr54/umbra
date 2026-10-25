---
title: Page and lifecycle
description: How a widget page loads, when umbra.every runs, how settings and the paused state reach your code, and how drag, focus and zoom behave.
sidebar: { order: 3 }
---

## The page

A widget page is plain HTML. Load Umbra's stylesheet and SDK from the virtual host `umbra.local`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://umbra.local/shared/umbra.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="app"></main>
  <script src="https://umbra.local/shared/umbra.js"></script>
  <script src="main.js"></script>
</body>
</html>
```

Your own files load relative to the page from `https://community.umbra.local/<id>/`. Pages can only load from Umbra's virtual hosts, `data:` and `blob:`, plus hosts declared in the manifest.

## The lifecycle

1. **Load.** The window opens with the true-black background. `umbra.js` asks the host for this widget's settings.
2. **`umbra.ready`** resolves when the host has sent them. `umbra.options`, `umbra.settings` and `umbra.widget` are then filled in.
3. **`umbra.every(fn)`** runs `fn` once ready and then every `refreshSeconds` (the user's setting, 30 to 600 s, or the widget's own interval). Errors are caught and logged.
4. **`umbra.rendered()`** is what you call after the first real frame is drawn; screenshots wait for it.
5. **Changes.** `umbra.onSettings(fn)` runs whenever the user changes anything: options, size, accent, locale, edit mode, the paused state.

```js
umbra.every(async () => {
  const { city } = umbra.options;
  const geo = await umbra.fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m`);
  document.getElementById("app").textContent = `${city}: ${geo.current.temperature_2m}°`;
  umbra.rendered();
});
umbra.onSettings(() => { /* options changed: re-render without refetching if you can */ });
```

## When `umbra.every` runs

Besides the interval, it is also run on **Refresh all**, after the PC resumes from sleep, when the network comes back and after a long lock, at most once per 10 seconds. It does not run while `umbra.settings.paused` is true (PC locked or display off) and runs once when that ends. When Windows Energy Saver is on and the user allows slowing down, `refreshSeconds` is already 4x longer.

If you run your own timers or fetch loops, stop them while `umbra.settings.paused` is true, restart with one refresh when it turns false, and use `umbra.settings.refreshSeconds` as the interval so Energy Saver slows you down too.

## Several copies

Users can run a widget more than once. Each copy is a separate window with its own options, position, size and `umbra.store` data, so your code needs no extra work: read `umbra.options` and `umbra.store` as usual. Don't use `localStorage` for per-widget state (copies share it), and use `umbra.widget.instance` only if you must tell copies apart (`"<id>"` for the first copy, `"<id>#2"`, `"<id>#3"` for the rest).

## Time changes

When the clock or time zone changes, `new Date()` is right immediately, but anything you computed earlier (a countdown target, "today") is stale. Recompute in `umbra.onTimeChanged`, and schedule one timer for the next local midnight instead of polling:

```js
let midnight;
function scheduleMidnight() {
  clearTimeout(midnight);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnight = setTimeout(() => { render(); scheduleMidnight(); }, next - now + 50);
}
umbra.onTimeChanged(() => { render(); scheduleMidnight(); });
scheduleMidnight();
```

## Dragging

Holding the mouse button and moving more than 4 px drags the window (unless the user locked it). Put `data-no-drag` on buttons and links that need normal clicks. Inputs, textareas, selects and `contenteditable` elements never start a drag.

## Typing and focus

Widgets never take focus from the app you're using. Pressing the mouse on a text field gives the widget the keyboard; Umbra checks that a mouse button is physically down over the widget. If you create an input in code (say, rename on double-click), call `umbra.requestFocus()` first. `widgets/todo` is an example.

## Size, zoom and edit mode

Users can resize any widget from 50 % to 300 % of its manifest size. Umbra zooms the page like a browser, so layout in CSS pixels and let the page fill its window (`height: 100%`, flex, grid, `%` and `fr`) so extra room gets used. `devicePixelRatio` includes the zoom: canvas code that sizes its backing store by it stays crisp, and should redraw on `umbra.onSettings` when `umbra.settings.scale` changes. Don't scale the page yourself. In edit mode Umbra covers unlocked widgets with an overlay, so don't rely on mouse interaction then (`umbra.settings.editMode` tells you).

The full list of calls is in the [JavaScript API](/umbra/docs/widgets/javascript-api/).
