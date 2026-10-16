# Umbra

**Desktop widgets that live on your wallpaper.** Umbra pins small, crisp, true-black widgets to the Windows desktop. They sit under your apps, stay visible with Win+D and start with Windows. The first widget is a live **S&P 500** card, and anyone can publish more through a pull request.

![S&P 500 widget](docs/demo-umbra.png)

## Install

Download `UmbraSetup-<version>.exe` from [Releases](https://github.com/AmineChr54/umbra/releases) and run it. It installs per-user with no admin prompt, and lets you choose whether Umbra starts with Windows. Umbra lives in the tray. Double-click the tray icon, or open Umbra from the Start menu, for **Settings**.

Build it yourself: `powershell -File build.ps1` (needs the .NET 10 SDK, Node and Inno Setup 6). For development: `dotnet run --project src/Umbra`.

## Features

- **Settings panel:** start with Windows, refresh interval and animations. Each widget can be turned on or off, configured, locked in place or reset to its default position. Changes apply live.
- **Community widgets:** the **Browse** page lists every widget in this repo's `widgets/` folder, and installs, updates or removes them in one click. See [CONTRIBUTING.md](CONTRIBUTING.md) to build one.
- **Sandboxed:** a widget can only reach the HTTPS hosts declared in its `widget.json`, and every other request is blocked by the host app.
- **OLED-first:** opaque true-black windows with DWM-rounded corners, so text renders with full DirectWrite quality.

## How it works

**Host app (C#, .NET 10 WinForms + WebView2).** It discovers widgets in `widgets/*/widget.json` (built-in) and `%APPDATA%\Umbra\widgets` (community), and opens one borderless window per enabled widget.

- **Desktop pinning** (`DesktopPin.cs`): the window is owned by `Progman`, the desktop shell window, which keeps it visible on Win+D. It's a tool window that never takes focus, and every `WM_WINDOWPOSCHANGING` is rewritten to `HWND_BOTTOM`, so apps always cover it.
- **Why it's sharp:** Rainmeter-style skins draw on translucent layered windows, where Windows disables ClearType. Umbra's windows are opaque black, with rounded corners and a hairline border drawn by DWM. On OLED, black pixels are off, so the card still looks like it floats on your wallpaper.
- **Bridge** (`WidgetWindow.cs`, `shared/umbra.js`): pages talk to the host with `postMessage`. `fetchJson` goes through C#, which avoids CORS and checks the host allowlist. `WebResourceRequested` returns 403 for any request to an undeclared host.
- **Single instance + startup:** a mutex plus a named pipe means a second launch opens Settings in the running copy. "Start with Windows" is the `HKCU\...\Run\Umbra` value, which the installer and the Settings toggle both read and write.
- **Community catalog** (`scripts/catalog.mjs`, `.github/workflows/widgets.yml`): pull requests are validated in CI, and merges regenerate `widgets/index.json`. The app downloads files into a temp folder, checks paths, file types, size and id, and only then installs them.

### S&P 500 algorithms (`widgets/sp500`)

1. **Data:** Yahoo Finance chart API (`range=1d&interval=5m`, or `5d/15m`), parsed as real JSON: `regularMarketPrice`, `chartPreviousClose`, the closes and timestamps, and the trading period for the open/closed dot. `null` gaps are dropped.
2. **Math:** `change = price - prevClose` and `percent = change / prevClose * 100`. The sign picks the theme: green, red or grey.
3. **Denoise:** a 3-point moving average on interior samples. The endpoints stay exact, so the live dot sits on the real last price.
4. **Scale:** the y-range always includes the previous close, so the dashed reference line stays inside the chart.
5. **Smooth curve:** a Catmull-Rom spline converted to cubic Beziers, with control points `C1 = P1 + (P2 - P0)/6` and `C2 = P2 - (P3 - P1)/6`. It passes through every sample with no corners.
6. **Motion:** the price counts with ease-out-cubic, `1 - (1 - t)^3`, and the line draws in via `stroke-dashoffset`. Both are skipped when the window is covered or animations are off.
7. **Hover:** a binary search on x finds the nearest sample for the crosshair tooltip.

## Rainmeter edition

The original lightweight Rainmeter skin is still in [`extras/rainmeter`](extras/rainmeter/SP500).

![Rainmeter skin](docs/demo-rainmeter.png)

## Limitations

Market data comes from Yahoo's unofficial endpoint. It may be delayed or change without notice, so don't use it for trading. Umbra is Windows 10 1809+ / Windows 11 only.

## License

MIT, see [LICENSE](LICENSE).
