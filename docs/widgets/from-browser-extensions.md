# Umbra widgets for browser-extension developers

If you have written a Chrome or Firefox extension you already know the shape: a folder of web files, one manifest, a
permission review, zip it, load it unpacked while developing. Umbra works the same way, with a desktop instead of a browser.

| Browser extension | Umbra widget |
|---|---|
| `manifest.json` | `widget.json` (`manifestVersion` 1; schema in `schemas/widget.schema.json`) |
| `.crx` / `.xpi` package | `.umbrawidget`, a zip with `widget.json` at its root (`umbractl pack`) |
| "Load unpacked" and reload | `umbractl dev <folder>` (loads and reloads on save) |
| `web-ext lint` | `umbractl validate` |
| Web store | Browse (the `widgets/` catalog in the repo), plus sharing the file or an https link |
| `host_permissions` | `permissions.hosts`: HTTPS host names; everything else is blocked with a 403 |
| `permissions` (`notifications`, ...) | `permissions.notifications`, `system`, `media`, `camera`, `commands`; shown in a review before install |
| Content Security Policy | Fixed by the host: only `umbra.local`, `community.umbra.local`, `data:`, `blob:` and your declared hosts load |
| Background / service worker | None. The page is the program; `umbra.every` re-runs your code on a schedule |
| `chrome.storage.local` | `umbra.store` (per widget copy, 1 MB, JSON). Do not use `localStorage` |
| `chrome.alarms` | `umbra.every(fn)` (also runs after sleep, when the network returns, and on "Refresh all") |
| `chrome.notifications` | `umbra.notify({ title, body, tag, actions })` (needs `permissions.notifications` and the user's switch) |
| `fetch` with `host_permissions` | `umbra.fetchJson` / `umbra.fetchText` (no CORS issues), or plain `fetch` to a declared host |
| `chrome.runtime.sendMessage` | Not needed: one page per widget. The page talks to the host only through `window.umbra` |
| `chrome.tabs`, `chrome.windows` | None. `umbra.openUrl(url)` opens a link in the user's browser |
| Native messaging | `permissions.commands`: an exact argument array the user approves once; no shell |
| Options page | `options` in `widget.json`; Umbra draws the form in Settings (`umbra.options`) |
| Manifest V2 to V3 | `manifestVersion`; a newer number than the app understands is refused with "Update Umbra" |
| `minimum_chrome_version` | `minUmbraVersion` |

## What is different

- **No page you do not own.** There is no content script into other sites. A widget is its own small window pinned to the desktop.
- **Always on screen.** A widget that burns CPU is felt by everyone: use `umbra.every`, stop timers when `umbra.settings.paused`, and respect `data-motion`.
- **The permission review is the user's.** No tool, MCP agent or `umbractl` flag can approve a command for them, and an update that adds access asks again.
- **Design rules.** True black `#000`, Segoe UI Variable, tabular numbers and the `umbra.css` tokens, so themes and the user's accent apply.

## Manifest field index

"Since" is the first Umbra release that understands the field. Fields marked *next* are in the version after 1.8.0.

| Field | Type | Since | Notes |
|---|---|---|---|
| `id`, `name`, `version`, `entry`, `preview`, `width`, `height`, `defaultPosition`, `permissions.hosts`, `options` | | 1.1.0 (schema) | `id` equals the folder name; `version` is `1.2.3` |
| `commands` (`permissions.commands`) | array | 1.3.0 | exact argv; user-approved |
| `themeable` | bool | 1.3.0 | `false` opts out of themes |
| `permissions.system`, `permissions.notifications`, `permissions.media` | | 1.4.0 | |
| `changelog` | string | 1.5.0 | shown when an update asks for access |
| `icon` | png file name | 1.7.1 | tab icon |
| `options.*.group`, `options.*.advanced` | | next | folds options into sections |
| `permissions.camera` | bool | next | webcam timelapse |
| `private` | bool | next | not publishable in the catalog |
| `manifestVersion` | integer | next | missing means 1 |
| `minUmbraVersion` | `1.9.0` | next | older apps refuse the widget |

Earlier releases ignore unknown keys, but `umbractl validate` and the catalog reject keys they do not know, which catches typos.
