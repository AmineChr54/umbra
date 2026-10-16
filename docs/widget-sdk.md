# Umbra widget SDK

An Umbra widget is a small web page (HTML, CSS, JS) in its own folder. Umbra opens it in a borderless,
true-black, desktop-pinned window (WebView2, the Edge engine) and gives it a tiny JavaScript SDK.
This file is the complete reference, for both people and AI agents. It ships with Umbra, and the MCP
tool `widget_authoring_guide` returns it.

## Folder layout

```
my-widget/            folder name = widget id (lowercase letters, digits, dashes; 2-40 chars)
  widget.json         manifest (required)
  index.html          entry page (required, or whatever "entry" names)
  preview.png         screenshot for the Browse page (recommended: 2x, black background)
  ...                 .js .mjs .css .svg .png .jpg .webp .gif .woff .woff2 .ttf .otf .json .txt .md (5 MB total)
```

Built-in widgets live in the app folder. Community and locally created widgets live in
`%APPDATA%\Umbra\widgets\<id>` and are served from `https://community.umbra.local/<id>/`.

## widget.json

```json
{
  "$schema": "https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/widget.schema.json",
  "id": "weather",
  "name": "Weather",
  "description": "Current temperature and conditions for one city.",
  "author": "your-github-name",
  "version": "1.0.0",
  "entry": "index.html",
  "preview": "preview.png",
  "width": 300,
  "height": 160,
  "defaultPosition": { "x": 24, "y": 420 },
  "permissions": { "hosts": ["api.open-meteo.com"] },
  "options": {
    "city":    { "label": "City", "type": "text", "default": "Berlin", "hint": "Shown under the field" },
    "units":   { "label": "Units", "type": "select", "default": "c",
                 "choices": [{ "value": "c", "label": "Celsius" }, { "value": "f", "label": "Fahrenheit" }] },
    "decimals":{ "label": "Decimals", "type": "number", "default": 0, "min": 0, "max": 2, "step": 1 },
    "compact": { "label": "Compact mode", "type": "toggle", "default": false }
  }
}
```

| Field | Rules |
|---|---|
| `id` | Equals the folder name. `^[a-z0-9][a-z0-9-]{1,39}$` |
| `name`, `description`, `author` | Required, non-empty |
| `version` | Required, `1.2.3`. Bump it on every change (users get an Update button) |
| `entry` | Default `index.html` |
| `width`, `height` | Integers 80-1200, **logical** pixels (Umbra scales for the display's DPI and the user's size setting) |
| `defaultPosition` | `{x, y}` from the top-left of the primary work area, logical pixels. Omit to start top right |
| `permissions.hosts` | Every HTTPS hostname the widget may reach. **All other requests are blocked** (fetch, XHR, images, scripts, fonts). `[]` for offline widgets |
| `options` | Settings form shown in **My widgets**, in this order. Types: `text`, `number` (`min`/`max`/`step`), `select` (needs `choices`), `toggle` |

The JSON Schema is in [`schemas/widget.schema.json`](../schemas/widget.schema.json).

## The page

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

```js
// main.js
umbra.every(async () => {                       // now, then every refreshSeconds (user setting, 30-600 s)
  const { city, units } = umbra.options;
  const geo = await umbra.fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m`);
  document.getElementById("app").textContent = `${city}: ${geo.current.temperature_2m}°`;
  umbra.rendered();
});
umbra.onSettings(() => { /* options changed: re-render without refetching if you can */ });
```

## JavaScript API (`window.umbra`)

| API | Description |
|---|---|
| `umbra.ready` | Promise, resolves when the host has sent this widget's settings |
| `umbra.options` | This widget's option values, e.g. `{ city: "Berlin", units: "c" }` |
| `umbra.settings` | `{ refreshSeconds, animations, locked, scale, editMode, options }`. `scale` is the user's size (0.5-3), `editMode` is true while the user arranges widgets |
| `umbra.widget` | `{ id, name }` |
| `umbra.every(fn)` | Calls `fn` once ready, then every `refreshSeconds`. Rescheduled when the user changes the interval, also run on "Refresh all". Errors are caught and logged |
| `umbra.onSettings(fn)` | Called with the new settings whenever the user changes anything |
| `umbra.fetchJson(url)` | `GET` JSON through the host: no CORS issues, 25 s timeout. Rejects unless the URL is HTTPS and its host is in `permissions.hosts` |
| `umbra.fetchText(url)` | Like `fetchJson`, but resolves with the response body as a string (up to 2 MB), for Markdown, CSV or HTML |
| `umbra.store.get(key, fallback?)` | Promise of this widget's saved value for `key` (any JSON), or `fallback` when it was never set |
| `umbra.store.set(key, value)` | Saves a JSON value. Rejects when the widget's data would pass 1 MB |
| `umbra.store.remove(key)`, `umbra.store.keys()` | Delete one key; list the keys |
| `umbra.store.onChange(fn)` | `fn(key)` runs when the data was changed from outside the widget (`umbractl data`, MCP). `key` is `null` when everything was cleared |
| `umbra.requestFocus()` | Ask for the keyboard, e.g. before focusing an input you create on double-click. Only honoured right after the user pressed the mouse on the widget (inputs and textareas ask automatically) |
| `umbra.openUrl(url)` | Opens an http(s) link in the user's browser (links never navigate the widget) |
| `umbra.rendered()` | Call once the first real frame is drawn; screenshots wait for it |
| `umbra.tween(from, to, ms, onFrame)` | Ease-out-cubic number animation; jumps straight to `to` when motion is off or the window is hidden |
| `umbra.fmt(n, decimals = 2)` | `7744.06` to `"7,744.06"` |

Plain `fetch()` also works for declared hosts if the server allows CORS; `umbra.fetchJson` always works.

**Saving data.** Options are for settings the user picks in **My widgets**. Anything the widget itself creates
(a task list, events, "already seen" ids) goes in `umbra.store`. It is private to the widget, survives restarts
and widget updates, and is deleted when a community widget is removed. It lives in
`%APPDATA%\Umbra\data\<id>.json`. Don't use `localStorage`: every widget shares one origin, so other widgets could read it.

```js
const tasks = await umbra.store.get("tasks", []);
tasks.push({ title: "Read chapter 3" });
await umbra.store.set("tasks", tasks);
umbra.store.onChange(async () => render(await umbra.store.get("tasks", [])));
```

**Dragging** is built in: holding the mouse button and moving more than 4 px moves the window (unless the
user locked it). Put `data-no-drag` on buttons or links that need normal clicks; inputs, textareas, selects and
`contenteditable` elements never start a drag.

**Zoom and edit mode.** Users can resize any widget from 50 % to 300 %. Umbra makes the window bigger and zooms the
page by the same factor (like browser zoom), so your page always lays out at the `width` x `height` from
`widget.json` and renders sharply. Don't scale it yourself:
- Use CSS pixels and layout as usual. `window.innerWidth` stays at the manifest width.
- `devicePixelRatio` includes the zoom. Canvas code that sizes its backing store by `devicePixelRatio` stays crisp;
  redraw on `umbra.onSettings` when `umbra.settings.scale` changes.
- In **edit mode** (`umbra.settings.editMode`, switched from the tray or Settings), an unlocked widget is covered by
  Umbra's overlay with an outline and a corner handle: presses move the widget, the handle resizes it and Ctrl+wheel
  zooms it. Your page gets no clicks then, so don't rely on interaction. Locked widgets are left alone. A page can't
  resize or zoom itself: in edit mode, the host resizes only during a real mouse press on the handle and zooms only
  while Ctrl is physically held over the widget.

**Typing.** Widgets never steal focus from the app you're using. Pressing the mouse on a text field hands the
widget the keyboard. Umbra checks that a mouse button is physically down over the widget, so a widget can't take
focus on its own. If you create an input in code (say, rename on double-click), call `umbra.requestFocus()` first.
See `widgets/todo` for an example.

**Motion**: `<html data-motion="on|off">` reflects the user's Animations setting and Windows' reduced-motion
preference. `umbra.css` turns off CSS animations when it is `off`.

## umbra.css tokens

`--text`, `--text-2` (secondary), `--text-3`, `--accent`, `--up` (green), `--down` (red), `--flat`, the
Segoe UI Variable font stack, and `.num` for `font-variant-numeric: tabular-nums`. Read
[`shared/umbra.css`](../shared/umbra.css) for the full list.

## Design rules

- **True black background (`#000`)**, no transparency. Umbra is built for OLED, where black pixels are off,
  and the window has DWM rounded corners and a hairline border.
- Text 11 px or larger; tabular numbers for values that change.
- Calm by default: no constant animation, no network calls faster than `umbra.every`.
- Fit the declared `width` x `height` exactly; the window does not scroll or reflow. When the user resizes it,
  Umbra zooms the whole page instead.

## Sandbox (what a widget can and cannot do)

- Pages load only from Umbra's virtual hosts (`umbra.local`, `community.umbra.local`), `data:` and `blob:`.
- Any other request gets HTTP 403 unless its host is listed in `permissions.hosts` and it uses HTTPS.
- No navigation away, no new windows, no context menu or devtools. Browser zoom keys are off; only the host sets
  the zoom (the user's size setting).
- No file system or native access; the bridge only offers the calls above. `umbra.store` reaches only the
  widget's own data file.

## Develop with umbractl (or an AI agent)

```powershell
umbractl new weather                 # scaffold into %APPDATA%\Umbra\widgets\weather and show it
umbractl reload                      # after editing files there
umbractl create .\widgets\weather    # load a folder you are editing elsewhere (e.g. in the repo)
umbractl set weather city Paris      # change an option, typed by the schema
umbractl capture weather shot.png    # PNG of just the widget
umbractl configure weather --scale 2 # check how it looks at 200 % (back with --scale 1)
umbractl data weather                # what the widget saved with umbra.store (set: data <id> <key> <json>)
umbractl logs                        # load errors and blocked requests
```

Through MCP (`claude mcp add umbra -- umbractl mcp`) an agent does the same with `create_widget`,
`configure_widget`, `widget_data`, `capture` and `read_logs`.

## Publish

Open a pull request that adds only `widgets/<id>/` to https://github.com/AmineChr54/umbra. CI validates it
(`node scripts/catalog.mjs`), and the catalog is rebuilt on merge, so it appears in everyone's Browse page.
See [CONTRIBUTING.md](../CONTRIBUTING.md).
