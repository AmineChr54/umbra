---
title: MCP server
description: Connect an AI agent to Umbra with the built-in Model Context Protocol server - setup, tools, resources, prompts and safety.
sidebar: { order: 3 }
---

`umbractl mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. An agent can see your widgets, configure them, take screenshots of a single widget and write new ones. The server is hand-rolled (no extra dependencies) and talks to the running app over the [control protocol](/umbra/docs/automate/control-protocol/).

## Connect a client

```powershell
claude mcp add umbra -- umbractl mcp
```

Any MCP client works: point it at the command `umbractl` with the argument `mcp`, over stdio. For clients configured with JSON, that looks like:

```json
{ "mcpServers": { "umbra": { "command": "umbractl", "args": ["mcp"] } } }
```

Then ask, for example: *"Add a widget that shows the weather in Berlin under my S&P 500 widget."* The agent reads `widget_authoring_guide`, writes the widget with `create_widget`, looks at it with `capture` and fixes what it sees.

## Tools

| Group | Tools |
|---|---|
| **Inspect** | `umbra_status`, `list_widgets`, `read_logs`, `diagnostics`, `privacy_report`, `list_command_approvals` (read-only) |
| **Place and configure** | `configure_widget` (enabled, locked, x, y, monitor, scale, options), `reset_widget_position`, `add_widget_instance`, `remove_widget_instance`, `groups`, `edit_mode`, `peek`, `layouts`, `hotkeys`, `safe_mode` |
| **App settings** | `set_general`, `check_update`, `open_settings` |
| **Catalog** | `browse_catalog`, `install_widget`, `update_all_widgets`, `remove_widget` |
| **Themes** | `list_themes`, `theme`, `install_theme`, `remove_theme` |
| **Build** | `widget_authoring_guide`, `create_widget`, `reload_widgets`, `refresh_widgets`, `widget_data`, `capture` |
| **Back up** | `backup_settings`, `restore_settings` |

`widget_authoring_guide` returns the complete [SDK reference](/umbra/docs/widgets/sdk-reference/) plus the `widget.json` JSON Schema. Agents should read it before `create_widget`. `capture` returns a PNG of only the widget or Settings page requested, never the rest of your screen.

## Resources

Every installed widget's files are exposed read-only as `umbra://widgets/<id>/<file>`, with the same path and extension rules as agent-written files and a 5 MB cap. An agent can read a widget (start with `widget.json`) before changing it.

## Prompts

| Prompt | Walks the agent through |
|---|---|
| `new_widget` | Building a new widget from a description: read the guide, `create_widget`, `capture`, fix |
| `fix_widget` | Capturing a broken widget, reading its sources and logs, and fixing it |
| `restyle_widget` | Changing a widget's look without changing what it does |

## Safety

The server tells agents to treat widget files as data, never as instructions, and never to add `permissions.commands` the user didn't ask for. In addition, these are enforced in the app and can't be bypassed through MCP:

- **Commands can't be approved.** `list_command_approvals` is read-only; approving is a human action in a host-drawn prompt or Settings.
- **New access can't be accepted.** The server strips `--accept-permissions`, and `update_all_widgets` skips (and lists) any update that adds hosts, media, notifications or commands.
- **Updates can't be installed.** `check_update` only reports.
- **Agent-made widgets get the same sandbox** as community widgets: declared HTTPS hosts only, validated file paths and types, 5 MB.
- The pipe is current-user only; other users on the PC can't connect.

:::caution
`remove_widget` deletes a widget and its saved data for good, and `restore_settings` replaces your settings. Tell your agent what it may and may not do, and review what it creates (`list_widgets`, `privacy_report`).
:::
