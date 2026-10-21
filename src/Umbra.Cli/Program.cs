using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Umbra;
using Umbra.Cli;

// umbractl: drive a running Umbra from a terminal, a script or an AI agent.
// Every command prints JSON on stdout; errors go to stderr with exit code 1.

Console.OutputEncoding = new UTF8Encoding(false);
var pretty = new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

if (args.Length == 0 || args[0] is "help" or "-h" or "--help")
{
    PrintHelp();
    return 0;
}

try
{
    switch (args[0])
    {
        case "--version" or "version":
            Console.WriteLine(typeof(UmbraClient).Assembly.GetName().Version?.ToString(3));
            return 0;

        case "mcp":
            Console.InputEncoding = new UTF8Encoding(false);
            using (var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)))
            using (var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)))
                await new McpServer((cmd, a) => UmbraClient.SendAsync(cmd, a)).RunAsync(stdin, stdout);
            return 0;

        case "new":
        {
            var id = Arg(1, "widget id");
            var dir = Flag("--dir") ?? UmbraClient.CommunityDir;
            var folder = Scaffold.Create(id, Flag("--name") ?? id, dir);
            var result = new JsonObject { ["path"] = folder };
            // Only widgets in the community folder are picked up by the running app.
            if (Flag("--dir") is null)
                result["reload"] = (await UmbraClient.SendAsync("reload", autoStart: false))["ok"]?.GetValue<bool>() == true;
            Console.WriteLine(result.ToJsonString(pretty));
            return 0;
        }
    }

    var (cmd, cmdArgs) = await CommandLine.TranslateAsync(args, (c, a) => UmbraClient.SendAsync(c, a));
    var reply = await UmbraClient.SendAsync(cmd, cmdArgs);
    if (reply["ok"]?.GetValue<bool>() != true)
    {
        Console.Error.WriteLine($"umbractl: {reply["error"]?.GetValue<string>() ?? "error"}");
        return 1;
    }
    // A text result (diagnostics) is printed as it is so it can be piped to the clipboard or pasted.
    Console.WriteLine(reply["result"] is JsonValue { } v && v.TryGetValue<string>(out var text) ? text : reply["result"]?.ToJsonString(pretty) ?? "ok");
    return 0;
}
catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IOException or TimeoutException or JsonException or FormatException)
{
    Console.Error.WriteLine($"umbractl: {ex.Message}");
    return 1;
}

string Arg(int i, string what) => CommandLine.Arg(args, i, what);

string? Flag(string name) => CommandLine.Flag(args, name);

static void PrintHelp()
{
    Console.WriteLine("""
        umbractl - control Umbra from a terminal, script or AI agent (prints JSON)

          status                         version, paths, open widgets
          list                           widgets with settings, option schema and bounds
          enable|disable <id>            show or hide a widget (<id> is a widget id or a copy like sp500#2)
          lock|unlock <id>               lock or unlock moving, resizing and zooming
          move <id> <x> <y>              position in physical pixels
          configure <id> [--scale 0.5-3|150%] [--enabled on|off] [--locked on|off] [--x N] [--y N] [--monitor N|primary] [--refresh 30-600|default] [--opacity 0.2-1|opaque]
                                         change several widget settings at once (scale = size and zoom)
          peek [seconds]                 raise widgets above other windows for a few seconds (never takes focus)
          safe-mode [on|off]             community widgets off (not saved); no argument = show the state
          layouts [list|save|apply|delete <name>|rename <name> <new>]  saved arrangements of positions, sizes and enabled widgets
          groups [list|create <id> [name]|join|activate <group> <id>|leave <id>|next|previous|delete <group>|reorder <group> <id> <i>|cycle <group> <s|off>|rename <group> <name>]
                                         tab groups: widgets sharing one spot, one visible at a time
          edit-mode [on|off]            move/resize/zoom widgets by hand; no argument = show the state
          set <id> <option> <value>      change a widget option (typed by its schema)
          general [--refresh 30-600] [--animations on|off] [--startup on|off] [--updates on|off] [--hide-fullscreen on|off] [--energy-saver on|off] [--peek-seconds 1-60]
                  [--corner-radius default|sharp|round] [--animation-speed normal|calm|off] [--default-scale 0.5-3]
                  [--log-level errors|normal|verbose] [--developer-mode on|off] [--hardware-acceleration on|off]
                  [--startup-delay 0-300] [--proxy system|none|https://host:port]
                  [--snap on|off] [--snap-grid 0-200] [--snap-edges on|off] [--snap-gap 0-100]
          check-update                   look for a newer Umbra on GitHub (install it from the tray or Settings > About)
          reset-position <id>            back to the default position
          add-instance <id>              run another copy of a widget (own options, position, data); ids look like sp500#2
          remove-instance <id#N>         remove an extra copy and its data
          refresh [id]                   fetch fresh data now
          reload                         re-scan widget folders
          catalog                        community widgets on GitHub
          install <id> [--accept-permissions]  install/update a community widget; an update that adds permissions needs the flag
          remove <id>                    uninstall a community widget
          update --all                   update every installed community widget that has a newer version (failures are listed, the rest still update; updates that add permissions are skipped and listed)
          theme [id]                     show the active theme, or switch to an installed one (live)
          themes                         installed themes and the community theme catalog
          hotkeys [action keys|off|reset]  global hotkeys (edit-mode, refresh-all, toggle-widgets, peek, open-settings), e.g. hotkeys edit-mode Ctrl+Alt+E
          install-theme|remove-theme <id>  install/update or uninstall a community theme
          new <id> [--name N] [--dir D]  scaffold a widget (default: the community folder, loaded at once)
          create <folder>                load a widget folder from disk (e.g. widgets/my-widget in the repo)
          capture <id|settings:<page>> [file.png]
                                         PNG of a widget or Settings page (general|widgets|layouts|browse|themes|hotkeys|privacy|about)
          data <id> [key] [json]         a widget's saved data (umbra.store): all, one key, or set a key
          data <id> --remove <key>|--clear
          settings [page]                open the Settings window
          approvals [id]                 local commands widgets declare and whether you approved them (read-only)
          privacy [id]                  hosts, commands, saved data and blocked requests per widget (read-only)
          backup <file>                 save settings, layout, theme and widget data (no approvals)
          restore <file>                restore from a backup (validated; approvals are not restored)
          logs [n]                      last n log lines
          diagnostics                   Markdown block for bug reports (versions, monitors, widgets, log; no settings values)
          quit                           exit Umbra
          send <command> [json]          raw control-protocol command
          mcp                            run as an MCP server on stdio:  claude mcp add umbra -- umbractl mcp

        If Umbra is not running it is started in the background first.
        """);
}
