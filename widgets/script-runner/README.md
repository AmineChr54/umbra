# Script Runner

Runs your own PowerShell, Python or Bash scripts from the desktop and shows the exit code, duration, last run time and output.

## How to add a script

Umbra only lets a widget start programs that are written in its `widget.json`, and it refuses an interpreter
(`powershell`, `python`, `bash`, `wsl`, `cmd`, `node`...) that would take free text from the page. So this widget
**cannot run text you type into it**. Instead, each script is a fixed command that you declare:

1. Open `widget.json` (installed copies live in `%APPDATA%\Umbra\widgets\script-runner`).
2. Add an entry to `permissions.commands`. The `id` is the name shown in the list.

```json
{ "id": "backup", "run": ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Scripts\\backup.ps1"],
  "description": "Nightly backup", "timeoutSeconds": 120 }
{ "id": "report", "run": ["python", "C:\\Scripts\\report.py"] }
{ "id": "sync",   "run": ["bash", "-c", "~/bin/sync.sh"] }
```

3. Reload the widget (**My widgets**, or `umbractl reload`) and press **Run**. Umbra shows the exact command line
   and asks you to approve it. Changing the command later (or the program it resolves to) needs a new approval.

Notes:

- Editing the script file itself does not need a new approval; editing the command in `widget.json` does.
- Use absolute paths for your scripts. The working folder is `%APPDATA%\Umbra\data\run\script-runner`.
- Timeout is 60 s by default (`timeoutSeconds`, max 120). Output over 1 MB is cut and flagged.
- Updating the widget from Browse replaces `widget.json`, so keep a copy of your own commands.
- The three shipped scripts are examples; delete or replace them.

## Options

Automatic runs: set **Script to run automatically** to a command id and **Run it every (minutes)**; optionally
**run it when the widget starts**. A background run can never show the approval prompt, so automatic runs only
repeat a script you already ran with the button. **Show the last output line big** turns the last stdout line
into a headline for one-number dashboards.

## Differences from the original idea (#26)

- Scripts can't be chosen or typed in the UI (host rule above); they are declared in `widget.json`.
- Interpreters are not searched or configured by option: write the executable in the command (`pwsh`, `python`, `bash`, or an absolute path).
