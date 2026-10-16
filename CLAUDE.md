# Umbra: guide for AI agents and contributors

Umbra pins small web widgets (HTML/CSS/JS in WebView2) to the Windows desktop. The C# host knows nothing
about any specific widget; widgets are folders with a `widget.json`. Windows 10 1809+ / 11 only.

## Commands

```powershell
dotnet build Umbra.slnx -warnaserror      # must stay at 0 warnings
dotnet test Umbra.slnx                    # unit tests (xUnit), no app or network needed
node scripts/catalog.mjs                  # validate widgets/ and regenerate widgets/index.json
powershell -File build.ps1                # publish both exes + installer -> dist/UmbraSetup-<ver>.exe
dotnet run --project src/Umbra            # run from source (exit the installed Umbra first: one instance per user)
```

The installed app is at `%LOCALAPPDATA%\Programs\Umbra`, and user data is at `%APPDATA%\Umbra` (`settings.json`, `umbra.log`,
community widgets in `widgets\`). `UMBRA_DATA_DIR` overrides the data folder (tests use a temp dir).

## Map

| Path | Role |
|---|---|
| `src/Umbra/Program.cs` | Entry: single instance, WebView2 check, starts `App`, serves the control pipe |
| `src/Umbra/App.cs` | Owns settings, widget windows, tray menu, Settings window. `OnUi()` marshals work to the UI thread |
| `src/Umbra/WidgetWindow.cs` | One borderless desktop-pinned window per widget; JS bridge (`fetchJson`, `drag`, `rendered`...); `CaptureAsync` |
| `src/Umbra/DesktopPin.cs`, `Native.cs` | Win32: owned by Progman, kept at `HWND_BOTTOM`, no activation, DWM corners |
| `src/Umbra/WebHost.cs` | WebView2 environment, virtual hosts `umbra.local` / `community.umbra.local`, **sandbox** |
| `src/Umbra/SettingsWindow.cs` + `settings/` | Settings panel (HTML) and its message protocol; `ShowPageAsync`, `CaptureAsync` |
| `src/Umbra/Community.cs` | Catalog fetch, install/remove, `WriteLocalWidget`, path and type validation |
| `src/Umbra/Updates.cs` | Update check: pure version compare / release parsing / URL validation (`Updates`), and `UpdateService` (daily GitHub check, download + run installer) |
| `src/Umbra/WidgetStore.cs` | `umbra.store`: per-widget JSON data in `%APPDATA%\Umbra\data\<id>.json` (1 MB cap, deleted on remove) |
| `src/Umbra/WidgetManifest.cs`, `Settings.cs` | `widget.json` model and discovery; `settings.json` model |
| `src/Umbra/Protocol.cs` | Control protocol (shared source, linked into umbractl). Command list lives here |
| `src/Umbra/Control.cs` | Executes control commands: the single place that defines what automation can do |
| `src/Umbra.Cli/` | `umbractl.exe`: CLI (`Program.cs`, argument mapping in `CommandLine.cs`), MCP stdio server (`McpServer.cs`), scaffold (`Scaffold.cs`) |
| `shared/umbra.js`, `umbra.css` | Widget SDK and design tokens, served to every widget |
| `widgets/<id>/` | Built-in (`sp500`) and catalog widgets; `widgets/index.json` is generated, never hand-edited |
| `schemas/widget.schema.json`, `docs/widget-sdk.md` | Manifest schema and SDK reference (both ship next to umbractl for agents) |
| `installer/Umbra.iss`, `build.ps1` | Inno Setup per-user installer; the version comes from `Directory.Build.props` |
| `tests/Umbra.Tests/` | Unit tests for host and CLI (the CLI project is referenced with `extern alias cli`) |

## Adding a capability

New automation goes through the control protocol so the CLI, MCP and tests stay in sync:
1. Add the command to `Protocol.Commands` and implement it in `Control.Execute`, reusing `App` methods.
2. Map it in `umbractl` (`CommandLine.TranslateAsync` in `src/Umbra.Cli/CommandLine.cs`, plus the help text in
   `Program.cs`) and add an MCP tool in `McpServer.Tools`.
3. Add tests (`tests/Umbra.Tests`), then update the README "Automate Umbra" section and `docs/widget-sdk.md` if widget-facing.

## Security invariants (never weaken without an issue and review)

- A widget page can only reach `umbra.local`, `community.umbra.local`, `data:`, `blob:` and HTTPS hosts in its
  `permissions.hosts`. Everything else gets a 403 from `WebResourceRequested` in `WebHost.InitAsync`.
- `fetchJson` goes through `WidgetManifest.AllowsUrl` (HTTPS plus a declared host).
- Top-level navigation off the virtual hosts is cancelled and links open in the user's browser.
- Community and agent-written files: relative forward-slash paths only, no `..`, allowed extensions only, 5 MB,
  id equals folder, all staged in temp and validated before `Commit` (`Community.cs`).
- Widget windows never activate themselves. They get keyboard focus only right after a physical mouse press on them
  (`WidgetWindow.TakeKeyboardFocus`), so a widget can't pull focus while the user types elsewhere.
- A widget can't resize or zoom itself: the page's `resize` and `zoom` messages are honoured only in edit mode, for an
  unlocked widget, with a physical mouse press (resize) or Ctrl held (zoom) over that window.
- The control pipe uses `PipeOptions.CurrentUserOnly`. Never add a network listener.
- Built-in widgets cannot be removed or shadowed by community or agent ids.
- Self-update (`Updates.cs`) runs in the host only; the installer must be HTTPS from `github.com/AmineChr54/umbra/releases/download/` and named `UmbraSetup-<release version>.exe`. Control commands may check for updates but never install one.

## Verifying UI changes

Use `umbractl capture <widget-id|settings:<page>> out.png`, then look at the PNG. It captures only that WebView.
**Never take desktop or full-screen screenshots**: they capture the user's other windows. Drag and Win+D
behaviour need a human check, so note that in the PR.

## Conventions

- C#: file-scoped namespaces, `sealed` classes, short `///` summaries on types and non-obvious members, no new NuGet
  dependencies without a reason (MCP and JSON-RPC are hand-rolled on purpose).
- JS: no build step or frameworks in `shared/`, `settings/` or built-in widgets.
- Widgets: true black `#000`, Segoe UI Variable via `umbra.css`, tabular numbers, respect `data-motion`.
- Bump `version` in a widget's `widget.json` on every change; bump `Directory.Build.props` for app releases.
- Keep `widgets/index.json` regenerated (`node scripts/catalog.mjs`); CI fails if it is stale.

## Workflow

- Work is tracked on the GitHub Projects board [Umbra Roadmap](https://github.com/users/AmineChr54/projects/5) (Backlog, Ready, In progress, In review, Done).
  New issues are added automatically and labelled `status: triage`.
- Labels: `type: bug|feature|docs|widget|chore`, `area: host|widgets|settings|sdk|ai|installer|ci|docs`,
  `priority: p0|p1|p2`, plus `good first issue` and `help wanted`.
- One issue per PR when possible, with `Closes #N` in the body. CI (`.github/workflows/ci.yml`) must pass.
- Releases: bump the version, tag `vX.Y.Z` and push. `release.yml` builds and attaches the installer
  (see `.claude/skills/release`).

Project agents live in `.claude/agents/` and repeatable procedures in `.claude/skills/`.
