---
title: Automation overview
description: The three ways to automate Umbra - the umbractl command line, the MCP server for AI agents, and the raw control protocol - and how they relate.
sidebar: { order: 1 }
---

Everything Umbra does can be driven from outside the app. There is exactly one definition of what automation can do, and three ways to reach it:

| | For | Entry point |
|---|---|---|
| **`umbractl`** | Scripts, terminals, CI | `umbractl <command>` prints JSON |
| **MCP server** | AI agents (Claude Code, Claude Desktop, any MCP client) | `umbractl mcp` over stdio |
| **Control protocol** | Anything else | a JSON line over a per-user named pipe |

All three talk to the running app through the same control commands, so they can never drift apart. If Umbra isn't running, `umbractl` starts it in the background first.

## Quick taste

```powershell
umbractl list                          # widgets, their settings, option schema and window bounds
umbractl install weather               # install from the community catalog
umbractl set sp500 symbol ^IXIC        # change an option; it applies instantly
umbractl configure sp500 --scale 1.5   # 150 % size and zoom
umbractl layouts save Work             # then: umbractl layouts apply Work
umbractl capture sp500 shot.png        # PNG of just that widget
```

```powershell
claude mcp add umbra -- umbractl mcp   # let an agent see and drive your widgets
```

## What automation cannot do

Some things are deliberately human-only:

- **Approve widget commands.** `umbractl approvals` and the MCP `list_command_approvals` are read-only. A person approves in a host-drawn prompt or in Settings.
- **Accept new permissions on an update.** The MCP server strips `--accept-permissions`; `update --all` skips widgets whose update adds access.
- **Install an Umbra update.** Control commands may check for updates but never install one.
- **Reach it from the network.** The pipe is current-user only and there is no network listener.

## What it can do

Place, size, lock and hide widgets; change any option or app setting; manage layouts, tab groups, hotkeys and themes; install, update and remove catalog widgets; write new widgets from files; read and set a widget's saved data; take screenshots of a widget or Settings page; read logs, privacy reports and diagnostics; back up and restore.

## Next

- [Command reference](/umbra/docs/automate/cli/): every `umbractl` command.
- [MCP server](/umbra/docs/automate/mcp/): tools, resources and prompts for agents.
- [Control protocol](/umbra/docs/automate/control-protocol/): the wire format.
