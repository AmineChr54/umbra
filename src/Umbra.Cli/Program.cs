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

    var (cmd, cmdArgs) = await Translate(args);
    var reply = await UmbraClient.SendAsync(cmd, cmdArgs);
    if (reply["ok"]?.GetValue<bool>() != true)
    {
        Console.Error.WriteLine($"umbractl: {reply["error"]?.GetValue<string>() ?? "error"}");
        return 1;
    }
    Console.WriteLine(reply["result"]?.ToJsonString(pretty) ?? "ok");
    return 0;
}
catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IOException or TimeoutException or JsonException or FormatException)
{
    Console.Error.WriteLine($"umbractl: {ex.Message}");
    return 1;
}

// Maps the friendly command line onto protocol commands.
async Task<(string, JsonObject)> Translate(string[] a)
{
    JsonObject O(params (string, JsonNode?)[] kv) { var o = new JsonObject(); foreach (var (k, v) in kv) o[k] = v; return o; }

    switch (a[0])
    {
        case "status" or "list" or "reload" or "catalog" or "quit":
            return (a[0], new JsonObject());
        case "enable" or "disable":
            return ("configure", O(("id", Arg(1, "widget id")), ("enabled", a[0] == "enable")));
        case "lock" or "unlock":
            return ("configure", O(("id", Arg(1, "widget id")), ("locked", a[0] == "lock")));
        case "move":
            return ("configure", O(("id", Arg(1, "widget id")), ("x", int.Parse(Arg(2, "x"))), ("y", int.Parse(Arg(3, "y")))));
        case "set":
        {
            var id = Arg(1, "widget id");
            var key = Arg(2, "option key");
            var raw = Arg(3, "value");
            return ("configure", O(("id", id), ("options", O((key, await OptionValue(id, key, raw))))));
        }
        case "general":
        {
            var o = new JsonObject();
            if (Flag("--refresh") is string r) o["refreshSeconds"] = int.Parse(r);
            if (Flag("--animations") is string an) o["animations"] = OnOff(an);
            if (Flag("--startup") is string st) o["startup"] = OnOff(st);
            return ("set-general", o);
        }
        case "reset-position" or "install" or "remove":
            return (a[0], O(("id", Arg(1, "widget id"))));
        case "refresh":
            return ("refresh", a.Length > 1 ? O(("id", a[1])) : new JsonObject());
        case "capture":
        {
            var target = Arg(1, "target (widget id or settings:<page>)");
            var file = a.Length > 2 ? a[2] : $"{target.Replace(':', '-')}.png";
            return ("capture", O(("target", target), ("path", Path.GetFullPath(file))));
        }
        case "data":
        {
            var id = Arg(1, "widget id");
            if (a.Contains("--clear")) return ("data", O(("id", id), ("op", "clear")));
            if (Flag("--remove") is string rm) return ("data", O(("id", id), ("op", "remove"), ("key", rm)));
            if (a.Length == 2) return ("data", O(("id", id)));
            if (a.Length == 3) return ("data", O(("id", id), ("key", a[2])));
            return ("data", O(("id", id), ("op", "set"), ("key", a[2]), ("value", JsonOrText(a[3]))));
        }
        case "settings":
            return ("open-settings", a.Length > 1 ? O(("page", a[1])) : new JsonObject());
        case "logs":
            return ("logs", O(("lines", a.Length > 1 ? int.Parse(a[1]) : 50)));
        case "create":
        {
            // umbractl create <folder>: send a widget folder from disk (e.g. one you are editing in the repo).
            var folder = Path.GetFullPath(Arg(1, "widget folder"));
            var files = new JsonObject();
            foreach (var f in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(folder, f).Replace('\\', '/');
                var binary = Path.GetExtension(f).ToLowerInvariant() is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".woff" or ".woff2" or ".ttf" or ".otf";
                files[rel] = binary ? Convert.ToBase64String(File.ReadAllBytes(f)) : File.ReadAllText(f);
            }
            return ("create-widget", O(("id", Path.GetFileName(folder)), ("files", files), ("overwrite", true)));
        }
        case "send":
            return (Arg(1, "command"), a.Length > 2 ? JsonNode.Parse(a[2]) as JsonObject ?? throw new ArgumentException("args must be a JSON object") : new JsonObject());
        default:
            throw new ArgumentException($"Unknown command '{a[0]}'. Run umbractl help.");
    }
}

// Option values are typed by the widget's schema, so "set clock seconds true" sends a boolean
// and "set sp500 symbol 123" still sends a string.
async Task<JsonNode?> OptionValue(string id, string key, string raw)
{
    var list = await UmbraClient.SendAsync("list");
    var type = (list["result"] as JsonArray)?.FirstOrDefault(w => w?["id"]?.GetValue<string>() == id)?["optionSchema"]?[key]?["type"]?.GetValue<string>();
    return type switch
    {
        "toggle" => OnOff(raw),
        "number" => JsonValue.Create(double.Parse(raw, System.Globalization.CultureInfo.InvariantCulture)),
        _ => JsonValue.Create(raw),
    };
}

// "data todo tasks [1,2]" stores JSON; anything that isn't valid JSON is stored as a plain string.
static JsonNode? JsonOrText(string raw)
{
    try { return JsonNode.Parse(raw); }
    catch (JsonException) { return JsonValue.Create(raw); }
}

static bool OnOff(string v) => v.ToLowerInvariant() switch
{
    "on" or "true" or "1" or "yes" => true,
    "off" or "false" or "0" or "no" => false,
    _ => throw new ArgumentException($"Expected on/off, got '{v}'"),
};

string Arg(int i, string what) => i < args.Length ? args[i] : throw new ArgumentException($"Missing {what}. Run umbractl help.");

string? Flag(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

static void PrintHelp()
{
    Console.WriteLine("""
        umbractl - control Umbra from a terminal, script or AI agent (prints JSON)

          status                         version, paths, open widgets
          list                           widgets with settings, option schema and bounds
          enable|disable <id>            show or hide a widget
          lock|unlock <id>               lock or unlock dragging
          move <id> <x> <y>              position in physical pixels
          set <id> <option> <value>      change a widget option (typed by its schema)
          general [--refresh 30-600] [--animations on|off] [--startup on|off]
          reset-position <id>            back to the default position
          refresh [id]                   fetch fresh data now
          reload                         re-scan widget folders
          catalog                        community widgets on GitHub
          install|remove <id>            install/update or uninstall a community widget
          new <id> [--name N] [--dir D]  scaffold a widget (default: the community folder, loaded at once)
          create <folder>                load a widget folder from disk (e.g. widgets/my-widget in the repo)
          capture <id|settings:<page>> [file.png]
                                         PNG of a widget or Settings page (general|widgets|browse|about)
          data <id> [key] [json]         a widget's saved data (umbra.store): all, one key, or set a key
          data <id> --remove <key>|--clear
          settings [page]                open the Settings window
          logs [n]                       last n log lines
          quit                           exit Umbra
          send <command> [json]          raw control-protocol command
          mcp                            run as an MCP server on stdio:  claude mcp add umbra -- umbractl mcp

        If Umbra is not running it is started in the background first.
        """);
}
