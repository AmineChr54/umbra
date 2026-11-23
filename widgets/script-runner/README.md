# Script Runner

Runs your own PowerShell, Python or Bash scripts (or any program) from the desktop. Scripts that finish show their exit
code, duration and output; scripts that keep running (an SSH tunnel, a dev server, a file watcher) get Start and Stop and
live output.

## Add a script

1. Open **Settings > My widgets > Script Runner** (or right-click the widget > Options).
2. Under **Your scripts**, press **Add script** and fill in:
   - **Example** (optional): start from *System info*, *Free disk space*, *Python version* or *Ping every 5 seconds*.
     It only fills the form; once saved it is your script, and you can edit or delete it like any other.
   - **Name**: what the widget shows, e.g. *Backup photos*.
   - **Type**: PowerShell, Python, Bash or Program.
   - **How it runs**: *Runs and finishes* (a report, a backup) or *Keeps running* (a tunnel, a server).
   - **Run**: a **script file** (type the full path or press **Browse...**; a Windows shortcut `.lnk` works too and fills in
     its file, arguments and Start in) or **Write code** right there (PowerShell and Python: as many lines as you like;
     Bash: one line, run with `bash -c`).
   - **Arguments** (optional): separated by spaces, `"quotes"` around one with spaces.
   - **Start in** (optional): the folder it runs in. Picking a file fills in its folder.
   - For a script that finishes: a **time limit** (1-120 s, default 60) and **Run as administrator** (see below). For one
     that keeps running: **Start automatically** (whenever the widget is on, so also after you sign in) and **Restart if it stops**.
   - **Description** (optional, shown under the name).
3. Press **Add script**. It appears in the widget right away.

Saving is your approval of exactly that command (the row shows the command line Umbra runs). If its program isn't
installed yet (say Python isn't on `PATH`), the script is saved as *Not approved*; install the program, then press **Approve**.

## Run as administrator

Some scripts need admin rights (restarting a service, editing the hosts file, `winget upgrade --all`). Switch on **Run as
administrator** for the script in Settings, then:

- Each time you press **Run**, Windows shows its own administrator prompt (UAC). Say No and nothing runs.
- It only ever starts from a click on Run: never on a timer, at widget start, or from `umbractl`/MCP.
- Its output shows in the widget, live, like any other script. The Windows prompt names *Windows PowerShell* for every
  kind of script: Umbra runs a small fixed PowerShell helper as administrator, which runs your script and sends its output back.
- Stop and the time limit work as usual: they end the script and anything it started.
- It can't also be a script that keeps running. Changing the switch is a change to the command, and saving approves it.

## Use it

- **Run** a script; while it runs the output appears live and the button becomes **Stop**.
- **Resize the output**: drag the handle between the scripts and the output panel (it shows when you hover the widget) to see more scripts or more output; double-click it to go back to the default. With the handle focused, the arrow keys move it too.
- A script that keeps running gets an on/off switch, a green *Running · 2 h 14 m*, and its newest output lines.
  Turn it off here, on its row in Settings, or from the tray menu (*1 script running > Stop ...*). It also stops when you turn
  the widget off, edit or delete the script, or quit Umbra.
- Links (http and https) in the output are clickable and open in your browser; the small icon after each one copies it. The copy icon at the top right copies the whole output, and the eraser next to it clears it: for a script that keeps running (or a run in progress) only what it prints from then on shows, and a finished run keeps its place in the history. **Earlier runs** lists the last runs of the selected script (when, exit code, duration).
- **Notify me** (options): a Windows toast when a script fails or a running one stops on its own (default), on every
  finish, or never. The first click on Run asks whether Script Runner may notify; you can also switch on *Allow
  notifications* for this widget in Settings.

## Switches (a VPN, a tunnel)

A script that keeps running always gets an on/off switch. For any other script, put its name in **Show as a switch**
(options; several names separated by commas) and its row gets an on/off switch instead of Run.

- **A script that flips something** (VPN on or off): clicking the switch runs it. The switch shows the first on/off word
  on the last line the script printed, so end it with `VPN ON` or `VPN OFF` (also understood: true/false, up/down,
  connected/disconnected, enabled/disabled, active/inactive, yes/no, running/stopped). Text after it stays visible,
  e.g. `VPN ON - Darmstadt, DE`.
- **Keep it right**: add a second script named after the first plus ` status` (for `VPN`, a script called `VPN status`)
  that only checks and prints `ON` or `OFF`. The widget runs it when it starts, every minute (**Check switches every**),
  and when it comes back on screen, and hides it from the list. Without it, the switch shows the last run's answer, which
  can be stale if you change the VPN in its own app.
- **A script that keeps running** (a tunnel): always a switch, no option needed. It is on while the script runs; clicking
  starts or stops it.

A status script for a Tailscale exit node, for example:

```powershell
$ts = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = "$env:ProgramFiles\Tailscale\tailscale.exe" }
$st = (& $ts status --json | Out-String) | ConvertFrom-Json
$exit = @($st.Peer.PSObject.Properties.Value | Where-Object { $_.ExitNode })
if ($st.BackendState -eq 'Running' -and $exit.Count) { "VPN ON - $($exit[0].HostName)" } else { 'VPN OFF' }
```

Notes:

- What runs: `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script> <args>`, `python <script> <args>`,
  `bash <script> <args>` or `<program> <args>`. Never a shell line, and with no console window: a script that asks for
  input (a password prompt) waits forever, so use key-based logins for tunnels.
- Code you write in Settings is saved by Umbra in `%APPDATA%\Umbra\scripts\script-runner\` and run as a file.
- Without Start in, scripts run in `%APPDATA%\Umbra\data\run\script-runner`. Output of a script that finishes is cut at
  1 MB (flagged); a script that keeps running keeps its last 64 KB.
- Your scripts are stored apart from the widget (`%APPDATA%\Umbra\scripts.json`), so updating Script Runner keeps them.
- Live output, Stop and scripts that keep running need Umbra 1.12 or later; on an older Umbra the widget works as before.
- Run as administrator needs an Umbra that has the switch in Settings; without it the widget works as before.

## Options

Automatic runs: set **Script to run automatically** to a script's name and **Run it every (minutes)**; optionally **run it
when the widget starts**. A script that keeps running uses its own *Start automatically* switch instead. **Show the last
output line big** turns the last stdout line into a headline for one-number dashboards.

## For widget authors

This widget sets `permissions.userScripts` and lists what it can run with `umbra.commands()`; it uses `umbra.stop()` and
`umbra.commandOutput()` for Stop and live output. See "The user's own scripts" in `docs/widget-sdk.md`.
