# Building a widget for Umbra

Umbra widgets are small web pages (HTML, CSS, JS) that Umbra pins to the desktop. Anything in this repo's `widgets/` folder shows up in Umbra's **Browse** page once it's merged, so publishing a widget is just a pull request.

## 1. Create the folder

```
widgets/
  my-widget/            folder name = widget id: lowercase letters, digits, dashes
    widget.json         manifest (required)
    index.html          entry page (required)
    preview.png         screenshot shown in Browse (recommended, 2x, black background)
    ...                 any .js .css .svg .png .woff2 etc. (5 MB max)
```

## 2. Write `widget.json`

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "description": "One sentence that tells people why they want it.",
  "author": "your-github-name",
  "version": "1.0.0",
  "entry": "index.html",
  "preview": "preview.png",
  "width": 300,
  "height": 160,
  "permissions": { "hosts": ["api.example.com"] },
  "options": {
    "city": { "label": "City", "type": "text", "default": "Berlin", "hint": "Shown under the field" },
    "units": { "label": "Units", "type": "select", "default": "c",
               "choices": [ { "value": "c", "label": "Celsius" }, { "value": "f", "label": "Fahrenheit" } ] },
    "compact": { "label": "Compact mode", "type": "toggle", "default": false }
  }
}
```

- `width` and `height` are logical pixels. Umbra scales them for the user's display, so a 300x160 widget is crisp on a 4K screen.
- `permissions.hosts` lists every HTTPS hostname your widget may contact. **Everything else is blocked**, including `fetch`, images and scripts, so list exactly what you need. Use `[]` if the widget works offline.
- `options` become a settings form in Umbra's **My widgets** page, in the order you write them. Option types are `text`, `number`, `select` and `toggle`.
- Bump `version` whenever you change the widget. Users then see an **Update** button.

## 3. Use the SDK

```html
<link rel="stylesheet" href="https://umbra.local/shared/umbra.css">
<script src="https://umbra.local/shared/umbra.js"></script>
<script>
  umbra.every(async () => {                 // runs now, then every N seconds (user setting)
    const o = umbra.options;                // { city, units, compact }
    const data = await umbra.fetchJson(`https://api.example.com/now?city=${encodeURIComponent(o.city)}`);
    document.body.textContent = data.temp;
  });
  umbra.onSettings(() => { /* options changed, re-render */ });
</script>
```

| API | What it does |
|---|---|
| `umbra.ready` | Promise that resolves once settings have arrived |
| `umbra.options` | This widget's option values |
| `umbra.settings` | `{ refreshSeconds, animations, locked, options }` |
| `umbra.every(fn)` | Call `fn` now and on the user's refresh interval |
| `umbra.onSettings(fn)` | Called when the user changes anything in Settings |
| `umbra.fetchJson(url)` | Fetch JSON through Umbra, with no CORS problems (host must be in `permissions.hosts`) |
| `umbra.openUrl(url)` | Open a link in the user's browser |
| `umbra.tween(from, to, ms, fn)` | Ease-out number animation (skipped when motion is off) |
| `umbra.fmt(n, decimals)` | `7744.06` to `"7,744.06"` |

`umbra.css` gives you the design tokens, such as `--text`, `--text-2`, `--accent`, `--up` and `--down`, plus the Segoe UI Variable fonts. Dragging is handled for you. Mark interactive elements with `data-no-drag` if they need clicks to stay clicks.

## 4. Design guidelines

- **True black background** (`#000`). Umbra is built for OLED, and black pixels are off there.
- Keep text at 11px or larger, and use `font-variant-numeric: tabular-nums` (the `.num` class) for numbers that change.
- Respect `html[data-motion="off"]`. `umbra.css` already disables CSS animations there.
- Make no network calls faster than `umbra.every` schedules them.

## 5. Test locally

The fastest loop uses `umbractl` (installed with Umbra):

```powershell
umbractl new my-widget                 # scaffold a working widget and show it on the desktop
umbractl create .\widgets\my-widget    # (re)load the folder you are editing in the repo
umbractl capture my-widget preview.png # pixel-exact 2x screenshot, ready to commit as preview.png
umbractl logs                          # load errors and requests blocked by the sandbox
```

Or copy your folder to `%APPDATA%\Umbra\widgets\my-widget\` and run `umbractl reload`. It appears in **My widgets**. The complete API reference is [docs/widget-sdk.md](docs/widget-sdk.md), and editors validate `widget.json` against [schemas/widget.schema.json](schemas/widget.schema.json) when it starts with the `$schema` line.

To test the Browse catalog end to end, point Umbra at your local repo:

```powershell
$env:UMBRA_CATALOG_BASE = "file:///C:/path/to/umbra/widgets"
node scripts/catalog.mjs          # validates and rebuilds widgets/index.json
& "$env:LOCALAPPDATA\Programs\Umbra\Umbra.exe"
```

## Working on the app itself

Pick an issue from the [roadmap board](https://github.com/users/AmineChr54/projects/5) (labels `good first issue` and `help wanted` are a good start), comment that you're on it, and open a PR that says `Closes #N`. Build and test with `dotnet build Umbra.slnx` and `dotnet test Umbra.slnx`; CI runs the same on Windows. [CLAUDE.md](CLAUDE.md) explains the architecture and the security rules, and AI coding agents read it too.

## 6. Open a pull request

Only add your `widgets/<id>/` folder. You don't need to edit `widgets/index.json`, because CI validates your widget on the PR and regenerates the catalog when it's merged. Validation checks the id, the required fields, the semantic version, the hostnames, the option types, the file types and the 5 MB limit.

Reviewers will check that the widget only uses the hosts it declares and looks at home next to the others.
