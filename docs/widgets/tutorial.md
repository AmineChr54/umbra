# Your first widget in 10 minutes

You will make a widget, see it on your desktop, change it live, check it, pack it into one shareable file, and install
that file the way a friend would. You need Umbra installed (it puts `umbractl` on your PATH if you ticked that task) and a
text editor. No build tools, no frameworks.

Other pages: [reference](../widget-sdk.md) · [cookbook](cookbook.md) · [coming from browser extensions](from-browser-extensions.md)

## 1. Scaffold (1 minute)

```powershell
umbractl new hello --name "Hello"
```

This writes `%APPDATA%\Umbra\widgets\hello\` and shows the widget on your desktop at once (Umbra starts in the background
if it is not running). The folder holds:

| File | What it is |
|---|---|
| `widget.json` | The manifest: name, size, the websites it may contact, the options users can change |
| `index.html` | The page Umbra shows (an ordinary web page) |
| `style.css`, `main.js` | Yours to edit |

The folder name is the widget id. It is lowercase letters, digits and dashes, 2 to 40 characters.

## 2. Edit with live reload (3 minutes)

Work in a folder you control, not in `%APPDATA%`. Copy the scaffold somewhere (or scaffold with
`umbractl new hello --dir C:\code`), then start the dev loop:

```powershell
cd C:\code\hello
umbractl dev
```

`dev` loads the folder, and reloads the widget about half a second after every save. While it runs it prints the widget's
sandbox-blocked requests and errors from Umbra's log, so a typo in a host name shows up in your terminal and not as a blank
widget. Try it: open `main.js`, change the greeting, save, and watch the desktop.

Things worth trying, all in the [reference](../widget-sdk.md):

- Change `"width"` and `"height"` in `widget.json`, in logical pixels.
- Add a website the widget may read: put its host name in `permissions.hosts` (`"api.open-meteo.com"`, no `https://`)
  and call `umbra.fetchJson("https://api.open-meteo.com/...")`. Anything not listed is blocked, and `dev` tells you so. A
  widget that declares access needs `umbractl dev --accept-permissions` once, the same way an install asks the user.
- Add an option in `widget.json` (`text`, `number`, `select` or `toggle`). It appears under **My widgets** in Settings
  and arrives as `umbra.options`.
- Keep numbers steady with `font-variant-numeric: tabular-nums` (the `num` class in `umbra.css` does it).
- Real examples to copy from are in the [cookbook](cookbook.md).

## 3. Look at it (1 minute)

```powershell
umbractl capture hello preview.png
```

You get a PNG of just that widget, never the rest of your screen. Open it and check the layout. A `preview.png` next to
`widget.json` (set `"preview": "preview.png"`) is what Browse shows; capture at 2x for a sharp one with
`umbractl configure hello --scale 2`, then back with `--scale 1`.

## 4. Validate (30 seconds)

```powershell
umbractl validate
```

This checks everything an install checks (file types, 5 MB, safe paths, the id equals the folder name, the entry file
exists, permissions, options, `manifestVersion`) plus lints for common mistakes. It prints errors, which block packing and
exit with code 1, and warnings, which do not: no preview, `chrome.webview` in your code, a font under 11px, an `http://`
resource, an option without a label or default.

## 5. Pack (30 seconds)

```powershell
umbractl pack
```

This validates again and writes `hello.umbrawidget` next to the folder (`-o` picks another place, `--force` replaces an
existing file). The file is a zip with `widget.json` at its root. It is deterministic: packing the same files again gives the
same bytes.

## 6. Install it like a stranger (3 minutes)

The best test is a second Windows user profile (or a friend's PC), so nothing from your dev setup helps. Copy the
`.umbrawidget` over and either:

- double-click it (the installer registers the file type), or
- open Settings, **Browse**, **Install from file...** (or **From URL...** for a link), or
- run `umbractl install-local hello.umbrawidget` (or `install-url https://...`).

Umbra checks the file again and shows a review box with the widget's name, author and any access it asks for (websites,
system info, media, notifications, commands). Nothing is written until you click Yes. A package that fails a check writes nothing.

## 7. Share

- Send the `.umbrawidget` file. A GitHub release asset works with **From URL...** and `umbractl install-url`; only
  `https://` links are accepted.
- Or add it to the public catalog: copy the folder to `widgets/<id>/` in a pull request to
  [AmineChr54/umbra](https://github.com/AmineChr54/umbra), run `node scripts/catalog.mjs` and commit the regenerated
  `widgets/index.json`. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
- Bump `"version"` on every change, so people see an Update button.

## When something is wrong

| You see | Look at |
|---|---|
| A blank widget | `umbractl logs`, or the `dev` output |
| "blocked" lines | The host is missing from `permissions.hosts` |
| Install says "Update Umbra" | `manifestVersion` or `minUmbraVersion` is newer than the installed app |
| Options do not show | `umbractl validate` reports option type or `choices` problems |

Using an AI agent instead? Connect it with `claude mcp add umbra -- umbractl mcp`; it gets `widget_authoring_guide`,
`create_widget`, `validate_widget`, `capture` and `read_logs`, and the same rules apply. It cannot install a file or accept access for you.
