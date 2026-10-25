---
title: Control protocol
description: The JSON-lines protocol over a per-user named pipe that umbractl and the MCP server use, with every command and how to add one.
sidebar: { order: 4 }
---

`umbractl` and the MCP server are thin clients. Both send **control commands** to the running Umbra over a per-user named pipe. You can speak it directly from any language that can open a Windows named pipe.

## Transport

- The pipe is named `Umbra-<UserName>`. A [portable copy](/umbra/docs/internals/portable-mode/) adds a hash of its data folder (`Umbra-<UserName>-<hash>`), so it never collides with an installed copy.
- It is opened with `PipeOptions.CurrentUserOnly`: other users on the PC can't connect. There is **no network listener**, and one must never be added.
- One request per connection. Send one JSON object on one line, read one JSON object on one line.

```
request   {"cmd":"list","args":{}}
response  {"ok":true,"result": ... }
          {"ok":false,"error":"message"}
```

A second `Umbra.exe` launch also sends the legacy plain-text line `settings`, which opens Settings in the running copy.

## Example (PowerShell)

```powershell
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new(".", "Umbra-$env:USERNAME", "InOut")
$pipe.Connect(1500)
$w = [System.IO.StreamWriter]::new($pipe); $w.AutoFlush = $true
$r = [System.IO.StreamReader]::new($pipe)
$w.WriteLine('{"cmd":"status","args":{}}')
$r.ReadLine()
$pipe.Dispose()
```

In practice, `umbractl send <command> [json]` does this for you: `umbractl send install-theme '{"id":"ember"}'`.

## Commands

The authoritative list is `Protocol.Commands` in `src/Umbra/Protocol.cs`, also used for `umbractl help`. Arguments are the JSON `args` object.

| Command | Arguments |
|---|---|
| `status` | none |
| `list` | none |
| `configure` | `id`, `enabled?`, `locked?`, `x?`, `y?`, `monitor?`, `scale?` (0.5–3), `refreshSeconds?` (30–600, null = global), `opacity?` (0.2–1, null = opaque), `options?{key:value}` |
| `add-instance`, `remove-instance` | `id` |
| `edit-mode` | `on?` |
| `safe-mode` | `on?` |
| `layouts` | `op?` (`list`, `save`, `apply`, `rename`, `delete`), `name`, `to?` |
| `groups` | `op?` (`list`, `create`, `join`, `leave`, `activate`, `next`, `previous`, `reorder`, `configure`, `icon`, `delete`), `group?`, `id?`, `name?`, `index?`, `cycleSeconds?`, `icon?` |
| `theme` | `id?` (no id reads) |
| `themes` | none |
| `install-theme`, `remove-theme` | `id` |
| `set-general` | refreshSeconds, animations, startup, checkForUpdates, hideOnFullscreen, slowOnEnergySaver, peekSeconds, cornerRadius, animationSpeed, defaultScale, logLevel, developerMode, hardwareAcceleration, startupDelaySeconds, proxy, snapGrid, snapEdges, snapGap, snap, borderEnabled, borderColor, accent, lightText, uiFont, fontScale, reduceTransparency (all optional) |
| `peek` | `seconds?` |
| `hotkeys` | `action?`, `keys?`, `reset?` |
| `check-update` | none |
| `reset-position` | `id` |
| `refresh` | `id?` |
| `reload` | none |
| `catalog` | none |
| `install` | `id`, `acceptPermissions?` |
| `update-all` | none |
| `remove` | `id` |
| `create-widget` | `id`, `files{path:content}`, `overwrite?` (binary files as base64) |
| `approvals` | `id?` (read-only) |
| `data` | `id`, `op?` (`get`, `set`, `remove`, `clear`), `key?`, `value?` |
| `privacy` | `id?` (read-only) |
| `backup`, `restore` | `path` |
| `capture` | `target` (widget id, or `settings:<page>`), `path?` |
| `open-settings` | `page?` |
| `logs` | `lines?` |
| `diagnostics` | none |
| `quit` | none |

## Adding a capability

New automation goes through the protocol, so the CLI, MCP and tests stay in sync:

1. Add the command to `Protocol.Commands` and implement it in `Control.Execute`, reusing `App` methods.
2. Map it in `umbractl`: `CommandLine.TranslateAsync` in `src/Umbra.Cli/CommandLine.cs`, plus the help text in `Program.cs`. Add an MCP tool in `McpServer.Tools`.
3. Add tests in `tests/Umbra.Tests`, then update the README "Automate Umbra" section and these docs.

`Control.cs` is the single place that defines what automation can do. A command must never approve widget commands or accept new permissions: see the [security model](/umbra/docs/internals/security/).
