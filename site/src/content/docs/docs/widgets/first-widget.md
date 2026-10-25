---
title: Your first widget
description: Scaffold, run, edit and screenshot a working widget in a few minutes, then see where to go next.
sidebar: { order: 1 }
---

A widget is a folder with a `widget.json` and a web page. This walks through creating one, changing it and looking at the result. You need Umbra installed and a text editor; no build tools.

## 1. Scaffold it

```powershell
umbractl new my-widget
```

This writes a working widget into `%APPDATA%\Umbra\widgets\my-widget` and shows it on your desktop straight away. (Use `--name "My widget"` for a display name, or `--dir <folder>` to scaffold somewhere else; widgets outside the community folder aren't picked up until you load them with `umbractl create <folder>`.)

You now have:

```
my-widget/
  widget.json     the manifest
  index.html      the page
  style.css       styles
  main.js         the code
```

## 2. Read the manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/widget.schema.json",
  "id": "my-widget",
  "name": "my-widget",
  "description": "Describe in one sentence why people want this widget.",
  "author": "your-github-name",
  "version": "0.1.0",
  "entry": "index.html",
  "width": 260,
  "height": 120,
  "permissions": { "hosts": [] },
  "options": {
    "greeting": { "label": "Greeting", "type": "text", "default": "Hello" }
  }
}
```

`id` must equal the folder name. `width` and `height` are the widget's size in logical pixels. `permissions.hosts` is empty, so this widget can't reach the internet. `options` becomes a settings form on the widget's card in **My widgets**. The [manifest reference](/umbra/docs/widgets/manifest/) covers every field.

## 3. Read the page

`index.html` loads Umbra's stylesheet and SDK from the virtual host `umbra.local`, then your files:

```html
<link rel="stylesheet" href="https://umbra.local/shared/umbra.css">
<link rel="stylesheet" href="style.css">
...
<script src="https://umbra.local/shared/umbra.js"></script>
<script src="main.js"></script>
```

`umbra.css` gives you design tokens (colors, fonts, radii), and `umbra.js` gives you the global `umbra` object: options, refresh, data fetching, saved data and more. See [Page and lifecycle](/umbra/docs/widgets/page-and-lifecycle/).

## 4. Change it

Edit `main.js` or `style.css`, then tell Umbra to re-scan:

```powershell
umbractl reload
```

Change the option live without editing any file:

```powershell
umbractl set my-widget greeting "Good morning"
```

## 5. Fetch real data

To call an API, declare its host in `widget.json`, then use `umbra.fetchJson` inside `umbra.every`:

```json
"permissions": { "hosts": ["api.open-meteo.com"] }
```

```js
umbra.every(async () => {
  const data = await umbra.fetchJson("https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m");
  document.getElementById("app").textContent = `${data.current.temperature_2m}°`;
  umbra.rendered();
});
```

Requests to any host you didn't declare are blocked, and `fetchJson` rejects. See the [JavaScript API](/umbra/docs/widgets/javascript-api/).

## 6. Look at it

```powershell
umbractl capture my-widget shot.png
```

This saves a PNG of just that widget and nothing else on screen. Check it at other sizes with `umbractl configure my-widget --scale 2`. [Testing with capture](/umbra/docs/widgets/testing/) has the full loop.

## 7. Make it good, then publish

Follow the [design guidelines](/umbra/docs/widgets/design-guidelines/) (true black background, tokens instead of hard-coded colors, tabular numbers), add a `preview.png`, and [publish it](/umbra/docs/widgets/publishing/) by pull request so it shows up in everyone's Browse page.

:::tip[Prefer to describe it?]
Connect an AI agent with `claude mcp add umbra -- umbractl mcp` and ask for the widget you want. The agent reads this documentation, writes the files, captures a screenshot and iterates. See [MCP server](/umbra/docs/automate/mcp/).
:::
