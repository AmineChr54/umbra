# Umbra

**Desktop widgets that live on your wallpaper.** Umbra pins small, crisp, true-black widgets to the Windows desktop. They sit under your apps, stay visible with Win+D and start with Windows. Browse has about 20 widgets, such as S&P 500, clock, weather, pomodoro, to-do, habits and an application tracker, and anyone can publish more through a pull request.

![S&P 500 widget](docs/demo-umbra.png)

## Install

Download `UmbraSetup-<version>.exe` from [Releases](https://github.com/AmineChr54/umbra/releases) and run it. It installs per-user with no admin prompt, and lets you choose whether Umbra starts with Windows. Umbra lives in the tray. Double-click the tray icon, or open Umbra from the Start menu, for **Settings**.

**Portable:** download `Umbra-<version>-portable.zip`, unzip it anywhere and run `Umbra.exe`. The `portable.txt` file next to it keeps all data (settings, widgets, logs, WebView2 cache) in a `data` folder beside the exe. Portable copies don't start with Windows and don't self-update (Settings shows a download link), and they run alongside an installed copy. To make any folder portable, create an empty `portable.txt` next to `Umbra.exe`.

Build it yourself: `powershell -File build.ps1` (needs the .NET 10 SDK, Node and Inno Setup 6). For development: `dotnet build Umbra.slnx`, `dotnet test Umbra.slnx` and `dotnet run --project src/Umbra`.

## Features

- **Settings panel:** start with Windows, refresh interval, animations, appearance (corner radius, border, accent color or match the Windows accent live, interface font and size, light text, reduce transparency) and advanced options (log level, developer mode, GPU, startup delay, proxy). Each widget can be turned on or off, run more than once (**Add another copy**, e.g. S&P 500 and Nasdaq side by side), configured, resized (50-300 %), locked, dimmed, given its own refresh interval, started hidden, shown only in a time range or on AC power, or reset to its default position. Changes apply live.
- **Edit mode:** turn it on from the tray menu or **My widgets** to arrange your desktop. Unlocked widgets get an outline and a corner handle: drag to move, drag the corner or Ctrl+scroll to resize. Click a widget to select it (stronger outline), then nudge it with the arrow keys: 1 px, or 10 px (one grid step when snapping is on) with Shift. Widgets zoom like a web page, so text stays sharp at any size. A small "Editing widgets" pill at the top of each monitor with widgets has a snap switch (hold Shift to skip snapping) and **Done**; Esc on a clicked widget also leaves edit mode. Locked widgets don't move, resize or zoom, and edit mode is off again after a restart.
- **Hotkeys, peek and layouts:** global hotkeys for edit mode, refresh, show/hide widgets, peek and Settings. Peek raises widgets for a few seconds. Save named layouts and switch between them. Widgets can hide during fullscreen apps and games. They also stop fetching while the PC is locked or the display is off (one refresh when you are back) and slow down 4x on Windows Energy Saver.
- **Notifications and media:** with permission, a widget can show a Windows notification (`umbra.notify`) or read and control the current media session (`umbra.media`).
- **Data and privacy:** the **Data & privacy** page shows what each widget can reach and store, and offers backup, restore, reset and a safe mode that turns community widgets off.
- **Community widgets:** the **Browse** page lists every widget in this repo's `widgets/` folder, and installs, updates or removes them in one click. The catalog is also published as a static site (`node scripts/site.mjs`). See [CONTRIBUTING.md](CONTRIBUTING.md) to build one.
- **Themes:** the **Themes** page installs community themes (colors and corner radius for every widget) and switches between them live. Themes are plain data with no code, and "Umbra Black" is the built-in default. Writing one takes a single `theme.json`, see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Sandboxed:** a widget can only reach the HTTPS hosts declared in its `widget.json`, and every other request is blocked by the host app. A widget can start a local program only if it declared that exact command in `widget.json` and you approved it.
- **OLED-first:** opaque true-black windows with DWM-rounded corners, so text renders with full DirectWrite quality.
- **Scriptable and agent-ready:** the `umbractl` command line and a built-in MCP server let scripts and AI agents configure widgets, take screenshots and build new widgets.

## Settings

| | |
|---|---|
| ![General settings](docs/settings-general.png) | ![My widgets](docs/settings-widgets.png) |
| **General:** start with Windows, refresh interval, animations, appearance and advanced options. | **My widgets:** edit mode, turn widgets on or off, edit their options and size, lock them or reset their position. |
| ![Browse community widgets](docs/settings-browse.png) | ![About](docs/settings-about.png) |
| **Browse:** install, update or remove community widgets in one click. | **About:** version, updates, source code and links to report issues or build a widget. |

Settings works from the keyboard: **Esc** closes it, **Ctrl+F** or **/** jumps to the Browse search, **Ctrl+1** to **Ctrl+7** switch pages, and the arrow keys move through the sidebar and the refresh interval. Switches and buttons have names for screen readers.

## Automate Umbra (CLI, scripts and AI agents)

The installer puts `umbractl` on your PATH. Every command prints JSON and starts Umbra in the background if it isn't running.

```powershell
umbractl list                         # widgets, their settings, option schema and window bounds
umbractl set sp500 symbol ^IXIC       # change an option; it applies instantly
umbractl move sp500 100 100           # position in physical pixels; also enable/disable, lock/unlock
umbractl configure sp500 --scale 1.5  # 150 % size and zoom (0.5-3, or 150%); also --locked, --enabled, --x, --y, --monitor 2 (a monitor number from status, or primary; the widget keeps its offset and survives monitor changes)
umbractl add-instance sp500           # a second copy (sp500#2) with its own options, position and data; remove-instance sp500#2
umbractl hotkeys edit-mode Ctrl+Alt+E # global hotkeys (edit-mode, refresh-all, toggle-widgets, peek, open-settings); off to clear
umbractl peek [seconds]               # raise widgets above other windows for a few seconds (never takes focus), then back to the bottom
umbractl safe-mode on                 # community widgets off, nothing deleted (also `Umbra.exe --safe`; not saved, next normal start restores)
umbractl layouts save Work            # save positions, sizes and enabled widgets; then `layouts apply Work`, `layouts delete Work`, `layouts`
umbractl general --snap-grid 20       # edit-mode snapping grid in px (0 = off; --snap-edges off; --snap-gap 12 = px kept between neighbouring widgets, 0 = touch; edges, centers and the gap show guide lines; --snap off = master switch, also on the edit-mode pill); hold Shift while dragging to skip snapping
umbractl edit-mode on                 # move/resize/zoom by hand; off, or no argument to read it
umbractl general --refresh 120        # app-wide settings (also --updates off to stop the daily update check; --hide-fullscreen on hides widgets during fullscreen apps and games; --peek-seconds 1-60; --energy-saver off stops widgets slowing down 4x on Windows Energy Saver)
umbractl general --corner-radius round --animation-speed calm --log-level verbose --proxy none   # appearance and advanced settings (also --default-scale, --developer-mode, --hardware-acceleration, --startup-delay; proxy and GPU need a restart)
umbractl configure sp500 --refresh 300 --opacity 0.8   # per-widget refresh interval (or default) and opacity (or opaque)
umbractl configure sp500 --start-hidden on --show-from 08:00 --show-to 18:00 --show-on-ac on   # start hidden; show only in a time range / on AC (--show-from always clears)
umbractl set-general --accent "#ff7a59" --light-text on --ui-font Consolas --font-scale 1.1 --border off --reduce-transparency on
umbractl check-update                 # is a newer Umbra on GitHub? (install it from the tray menu or Settings > About)
umbractl install clock                # community catalog: catalog, install, remove (an update that adds hosts, media, notifications or commands is refused until you repeat it with --accept-permissions)
umbractl themes                       # installed and community themes; theme <id> switches live
umbractl install-theme ember          # also remove-theme; then: umbractl theme ember
umbractl new my-widget                # scaffold a working widget and show it
umbractl capture sp500 shot.png       # PNG of just that widget (or settings:browse, settings:privacy, ...)
umbractl data todo                    # a widget's saved data (umbra.store); data <id> <key> <json> to set
umbractl approvals                    # local commands widgets declare and whether you approved them (read-only)
umbractl help                         # everything else
```

**AI agents (MCP).** `umbractl mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an agent can see and drive your widgets:

```powershell
claude mcp add umbra -- umbractl mcp
```

Then ask Claude, for example, "add a widget that shows the weather in Berlin under my S&P widget". The agent reads `widget_authoring_guide`, writes the widget with `create_widget`, looks at it with `capture` and fixes what it sees. Its tools are `list_widgets`, `configure_widget` (including `scale`), `edit_mode`, `set_general`, `check_update`, `create_widget`, `widget_data`, `add_widget_instance`, `remove_widget_instance`, `capture`, `install_widget`, `remove_widget`, `browse_catalog`, `list_themes`, `theme`, `install_theme`, `remove_theme`, `read_logs`, `privacy_report`, `backup_settings`, `restore_settings`, `list_command_approvals` (read-only: you approve widget commands yourself) and a few more. Any MCP client works: point it at `umbractl mcp` over stdio.

The Settings window has a **Data & privacy** page: per widget it shows the hosts it can reach, its commands, how much it has saved and recent blocked requests (with a Delete data button), plus Export/Import backup, Open data folder / log and Reset everything. Backups never include command approvals.

The server also exposes every installed widget's files as read-only **resources** (`umbra://widgets/<id>/<file>`, same path and extension rules as agent-written files, 5 MB cap) so an agent can read a widget before editing it, and three **prompts**, `new_widget`, `fix_widget` and `restyle_widget`, that walk it through `widget_authoring_guide`, `create_widget` and `capture`.

Under the hood, both talk to the running app over a per-user named pipe with one JSON line per request (`src/Umbra/Protocol.cs`). Other users on the PC can't connect, and agent-made widgets get the same sandbox as community widgets.

## How it works

**Host app (C#, .NET 10 WinForms + WebView2).** It discovers widgets in `widgets/*/widget.json` (the catalog source, installed from Browse) and `%APPDATA%\Umbra\widgets` (installed widgets), and opens one borderless window per enabled widget.

- **Desktop pinning** (`DesktopPin.cs`): the window is owned by `Progman`, the desktop shell window, which keeps it visible on Win+D. It's a tool window that never takes focus on its own (it gets the keyboard only when you click into one of its text fields), and every `WM_WINDOWPOSCHANGING` is rewritten to `HWND_BOTTOM`, so apps always cover it.
- **Why it's sharp:** Rainmeter-style skins draw on translucent layered windows, where Windows disables ClearType. Umbra's windows are opaque black, with rounded corners and a hairline border drawn by DWM. On OLED, black pixels are off, so the card still looks like it floats on your wallpaper.
- **Bridge** (`WidgetWindow.cs`, `shared/umbra.js`): pages talk to the host with `postMessage`. `fetchJson` goes through C#, which avoids CORS and checks the host allowlist. `WebResourceRequested` returns 403 for any request to an undeclared host.
- **Portable mode:** with `portable.txt` next to `Umbra.exe`, data goes to `<app>\data` (`UMBRA_DATA_DIR` still wins); the pipe and mutex names get a hash of that folder, and `umbractl` next to the exe finds the same copy.
- **Single instance + startup:** a mutex plus a named pipe means a second launch opens Settings in the running copy. "Start with Windows" is the `HKCU\...\Run\Umbra` value, which the installer and the Settings toggle both read and write.
- **Community catalog** (`scripts/catalog.mjs`, `.github/workflows/widgets.yml`): pull requests are validated in CI, and merges regenerate `widgets/index.json`. The app downloads files into a temp folder, checks paths, file types, size and id, and only then installs them.

### Example: S&P 500 algorithms (`widgets/sp500`)

1. **Data:** Yahoo Finance chart API (`range=1d&interval=5m`, or `5d/15m`), parsed as real JSON: `regularMarketPrice`, `chartPreviousClose`, the closes and timestamps, and the trading period for the open/closed dot. `null` gaps are dropped.
2. **Math:** `change = price - prevClose` and `percent = change / prevClose * 100`. The sign picks the theme: green, red or grey.
3. **Denoise:** a 3-point moving average on interior samples. The endpoints stay exact, so the live dot sits on the real last price.
4. **Scale:** the y-range always includes the previous close, so the dashed reference line stays inside the chart.
5. **Smooth curve:** a Catmull-Rom spline converted to cubic Beziers, with control points `C1 = P1 + (P2 - P0)/6` and `C2 = P2 - (P3 - P1)/6`. It passes through every sample with no corners.
6. **Motion:** the price counts with ease-out-cubic, `1 - (1 - t)^3`, and the line draws in via `stroke-dashoffset`. Both are skipped when the window is covered or animations are off.
7. **Hover:** a binary search on x finds the nearest sample for the crosshair tooltip.

## Contributing and roadmap

Umbra is community-built. The [roadmap board](https://github.com/users/AmineChr54/projects/5) tracks what's next, from Backlog to Done, and every new issue lands there automatically.

- **Build a widget:** [CONTRIBUTING.md](CONTRIBUTING.md) and the [widget SDK](docs/widget-sdk.md).
- **Work on the app:** pick a `good first issue`, and read [CLAUDE.md](CLAUDE.md) for the architecture and security rules (AI coding agents read it too).
- **Found a bug?** [Open an issue](https://github.com/AmineChr54/umbra/issues/new/choose). For security problems, see [SECURITY.md](SECURITY.md).

## Rainmeter edition

The original lightweight Rainmeter skin is still in [`extras/rainmeter`](extras/rainmeter/SP500).

![Rainmeter skin](docs/demo-rainmeter.png)

## Limitations

Market data comes from Yahoo's unofficial endpoint. It may be delayed or change without notice, so don't use it for trading. Umbra is Windows 10 1809+ / Windows 11 only (it targets `net10.0-windows10.0.19041.0`).

## License

MIT, see [LICENSE](LICENSE).
