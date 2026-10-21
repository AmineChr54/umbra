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
| `umbra.settings` | `{ refreshSeconds, animations, locked, scale, editMode, options }` (users can zoom a widget 50-300 %; lay out at your manifest size and Umbra zooms the page) |
| `umbra.every(fn)` | Call `fn` now and on the user's refresh interval |
| `umbra.onSettings(fn)` | Called when the user changes anything in Settings |
| `umbra.fetchJson(url)` | Fetch JSON through Umbra, with no CORS problems (host must be in `permissions.hosts`) |
| `umbra.store.get(key, fallback)` / `.set(key, value)` | Save the widget's own data (any JSON, 1 MB), kept across restarts |
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
node scripts/catalog.mjs          # validates and rebuilds widgets/index.json and themes/index.json
& "$env:LOCALAPPDATA\Programs\Umbra\Umbra.exe"
```

## Building a theme

A theme restyles every widget through the design tokens of `shared/umbra.css`. It is data only, so it is a single file:

```
themes/ember/
  theme.json      required
  preview.png     optional
```

```json
{
  "$schema": "https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/theme.schema.json",
  "id": "ember",
  "name": "Ember",
  "description": "Warm orange accent on deep brown-black surfaces.",
  "author": "your-github-name",
  "version": "1.0.0",
  "tokens": { "--accent": "#ff8a3d", "--accent-soft": "rgba(255, 138, 61, 0.15)", "--radius-m": "8px" }
}
```

- `id` equals the folder name (2-40 lowercase letters, digits and dashes; `default` is taken). Bump `version` on every change.
- `tokens` may only use the names in the [token table](docs/widget-sdk.md#umbracss-tokens): colors (`--bg`, `--surface-1..3`, `--line`, `--line-strong`, `--text`, `--text-2`, `--text-3`, `--accent`, `--accent-strong`, `--accent-soft`, `--up`, `--down`, `--flat`) as `#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb()`, `rgba()`, `hsl()` or `hsla()`, and radii (`--radius-s|m|l`) as `0-99px` or `rem`. Anything else (CSS, `url()`, scripts, other tokens, subfolders) fails validation. Leave out what you don't change. Keep `--bg` at the default `#000` unless the theme is about the background, and keep text readable (contrast of `--text` and `--text-2` on your surfaces).
- Try it: `umbractl send install-theme '{"id":"ember"}'` installs from the catalog; to test a local file copy the folder to `%APPDATA%\Umbra\themes\<id>\` and run `umbractl themes`, then `umbractl theme <id>` and `umbractl capture settings:themes themes.png`.
- Run `node scripts/catalog.mjs`: it validates your theme and regenerates `themes/index.json`. Open a pull request with your `themes/<id>/` folder and that regenerated index. CI runs `node scripts/catalog.mjs --check` and fails if the index is out of date (nothing is committed to `main` for you).

## Working on the app itself

Pick an issue from the [roadmap board](https://github.com/users/AmineChr54/projects/5) (labels `good first issue` and `help wanted` are a good start), comment that you're on it, and open a PR that says `Closes #N`. Build and test with `dotnet build Umbra.slnx` and `dotnet test Umbra.slnx`; CI runs the same on Windows. [CLAUDE.md](CLAUDE.md) explains the architecture and the security rules, and AI coding agents read it too.

## 6. Open a pull request

Add your `widgets/<id>/` folder and the regenerated catalog index. Run `node scripts/catalog.mjs` and commit the resulting `widgets/index.json` (and `themes/index.json`) with your widget. Never edit the index by hand. CI runs `node scripts/catalog.mjs --check` on the PR and fails if the index is out of date, because nothing regenerates or commits it after the merge. If another widget PR lands first and your index conflicts, rebase on `main` and run `node scripts/catalog.mjs` again. Validation checks the id, the required fields, the semantic version, the hostnames, the option types, the file types and the 5 MB limit.

Reviewers will check that the widget only uses the hosts it declares and looks at home next to the others.

## Releasing: signing and winget (maintainers)

`release.yml` builds `UmbraSetup-<version>.exe`, signs it with `signtool` **only if** the repo secrets `SIGN_CERT_BASE64` (a code-signing `.pfx`, base64) and `SIGN_CERT_PASSWORD` exist, and otherwise publishes it unsigned. It also fills the manifests in [`winget/`](winget) with the version and SHA256 (`scripts/winget.ps1`) and attaches them to the workflow run as `winget-manifests-<version>`.

One-time setup (needs a person, not CI):

1. **Certificate.** Get a code-signing certificate (an OV/EV certificate from a CA, or Azure Trusted Signing / SignPath if you qualify) and export it as a `.pfx`. Encode it with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` and add the repo secrets `SIGN_CERT_BASE64` and `SIGN_CERT_PASSWORD`. The next tagged release is signed; SmartScreen reputation still builds up over time.
2. **First winget submission.** After a release, download the `winget-manifests-<version>` artifact (or run `powershell -File scripts/winget.ps1 -Installer dist/UmbraSetup-<version>.exe`), then either run `wingetcreate submit <folder>` or fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) and copy the three files to `manifests/a/AmineChr54/Umbra/<version>/`. Validate with `winget validate <folder>` and `winget install --manifest <folder>` in a clean VM, then open the pull request. Moderators must approve the first one.
3. **Later releases.** Repeat step 2 for each version (or add a `wingetcreate update AmineChr54.Umbra` / [winget-releaser](https://github.com/vedantmgoyal9/winget-releaser) job once the package exists, using a PAT secret).
