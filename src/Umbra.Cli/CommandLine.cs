using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra.Cli;

/// <summary>Maps umbractl's friendly command line onto control-protocol requests (one command and its args).</summary>
static class CommandLine
{
    /// <param name="send">Used only to read a widget's option schema, so "set" can send typed values.</param>
    public static async Task<(string Cmd, JsonObject Args)> TranslateAsync(string[] a, Func<string, JsonObject, Task<JsonObject>> send)
    {
        static JsonObject O(params (string, JsonNode?)[] kv) { var o = new JsonObject(); foreach (var (k, v) in kv) o[k] = v; return o; }

        switch (a[0])
        {
            case "status" or "list" or "reload" or "catalog" or "themes" or "quit":
                return (a[0], new JsonObject());
            case "enable" or "disable":
                return ("configure", O(("id", Arg(a, 1, "widget id")), ("enabled", a[0] == "enable")));
            case "lock" or "unlock":
                return ("configure", O(("id", Arg(a, 1, "widget id")), ("locked", a[0] == "lock")));
            case "move":
                return ("configure", O(("id", Arg(a, 1, "widget id")), ("x", int.Parse(Arg(a, 2, "x"))), ("y", int.Parse(Arg(a, 3, "y")))));
            case "configure":
            {
                var o = O(("id", Arg(a, 1, "widget id")));
                if (Flag(a, "--scale") is string sc) o["scale"] = Scale(sc);
                if (Flag(a, "--enabled") is string en) o["enabled"] = OnOff(en);
                if (Flag(a, "--locked") is string lk) o["locked"] = OnOff(lk);
                if (Flag(a, "--refresh") is string wr) o["refreshSeconds"] = wr == "default" ? null : int.Parse(wr, CultureInfo.InvariantCulture);
                if (Flag(a, "--opacity") is string op) o["opacity"] = op == "opaque" ? null : double.Parse(op, CultureInfo.InvariantCulture);
                if (Flag(a, "--start-hidden") is string sh) o["startHidden"] = OnOff(sh);
                var (from, to, ac, sm) = (Flag(a, "--show-from"), Flag(a, "--show-to"), Flag(a, "--show-on-ac"), Flag(a, "--show-monitor"));
                if (from == "always") o["showWhen"] = null;
                else if (from is not null || to is not null || ac is not null || sm is not null)
                {
                    var r = new JsonObject();
                    if (from is not null) r["from"] = from;
                    if (to is not null) r["to"] = to;
                    if (ac is not null && ac != "any") r["onAc"] = OnOff(ac);
                    if (sm is not null) r["monitor"] = sm;
                    o["showWhen"] = r;
                }
                if (Flag(a, "--x") is string x) o["x"] = int.Parse(x, CultureInfo.InvariantCulture);
                if (Flag(a, "--y") is string y) o["y"] = int.Parse(y, CultureInfo.InvariantCulture);
                if (Flag(a, "--monitor") is string mon) o["monitor"] = mon;
                return ("configure", o);
            }
            case "peek":
                return ("peek", a.Length > 1 ? O(("seconds", int.Parse(a[1], CultureInfo.InvariantCulture))) : new JsonObject());
            case "theme":
                return ("theme", a.Length > 1 ? O(("id", a[1])) : new JsonObject());
            case "check-update" or "update":
                return ("check-update", new JsonObject());
            case "safe-mode":
                return ("safe-mode", a.Length > 1 ? O(("on", OnOff(a[1]))) : new JsonObject());
            case "layouts" or "layout":
                if (a.Length < 2 || a[1] == "list") return ("layouts", new JsonObject());
                if (a[1] is "save" or "apply" or "delete") return ("layouts", O(("op", a[1]), ("name", string.Join(' ', a.Skip(2)))));
                throw new ArgumentException("Usage: layouts [list | save <name> | apply <name> | delete <name>]");
            case "edit-mode":
                return ("edit-mode", a.Length > 1 ? O(("on", OnOff(a[1]))) : new JsonObject());
            case "set":
            {
                var id = Arg(a, 1, "widget id");
                var key = Arg(a, 2, "option key");
                var raw = Arg(a, 3, "value");
                return ("configure", O(("id", id), ("options", O((key, await OptionValue(send, id, key, raw))))));
            }
            case "general":
            {
                var o = new JsonObject();
                if (Flag(a, "--refresh") is string r) o["refreshSeconds"] = int.Parse(r);
                if (Flag(a, "--animations") is string an) o["animations"] = OnOff(an);
                if (Flag(a, "--startup") is string st) o["startup"] = OnOff(st);
                if (Flag(a, "--updates") is string up) o["checkForUpdates"] = OnOff(up);
                if (Flag(a, "--hide-fullscreen") is string hf) o["hideOnFullscreen"] = OnOff(hf);
                if (Flag(a, "--energy-saver") is string es) o["slowOnEnergySaver"] = OnOff(es);
                if (Flag(a, "--snap-grid") is string sgr) o["snapGrid"] = int.Parse(sgr, CultureInfo.InvariantCulture);
                if (Flag(a, "--snap-edges") is string sed) o["snapEdges"] = OnOff(sed);
                if (Flag(a, "--snap-gap") is string sgp) o["snapGap"] = int.Parse(sgp, CultureInfo.InvariantCulture);
                if (Flag(a, "--snap") is string sna) o["snap"] = OnOff(sna);
                if (Flag(a, "--peek-seconds") is string pk) o["peekSeconds"] = int.Parse(pk, CultureInfo.InvariantCulture);
                if (Flag(a, "--corner-radius") is string cr) o["cornerRadius"] = cr;
                if (Flag(a, "--animation-speed") is string asp) o["animationSpeed"] = asp;
                if (Flag(a, "--default-scale") is string ds) o["defaultScale"] = Scale(ds);
                if (Flag(a, "--log-level") is string ll) o["logLevel"] = ll;
                if (Flag(a, "--developer-mode") is string dm) o["developerMode"] = OnOff(dm);
                if (Flag(a, "--hardware-acceleration") is string ha) o["hardwareAcceleration"] = OnOff(ha);
                if (Flag(a, "--startup-delay") is string sd) o["startupDelaySeconds"] = int.Parse(sd, CultureInfo.InvariantCulture);
                if (Flag(a, "--proxy") is string px) o["proxy"] = px;
                if (Flag(a, "--border") is string bd) o["borderEnabled"] = OnOff(bd);
                if (Flag(a, "--border-color") is string bcl) o["borderColor"] = bcl == "default" ? "" : bcl;
                if (Flag(a, "--accent") is string acc) o["accent"] = acc == "default" ? "" : acc;
                if (Flag(a, "--light-text") is string lt) o["lightText"] = OnOff(lt);
                if (Flag(a, "--ui-font") is string uf) o["uiFont"] = uf;
                if (Flag(a, "--font-scale") is string fsc) o["fontScale"] = double.Parse(fsc, CultureInfo.InvariantCulture);
                if (Flag(a, "--reduce-transparency") is string rt) o["reduceTransparency"] = OnOff(rt);
                return ("set-general", o);
            }
            case "install":
            {
                // An update that adds hosts, media, notifications or commands is refused (and the new access listed) until
                // the person at the keyboard repeats it with --accept-permissions.
                var id = a.Skip(1).FirstOrDefault(x => !x.StartsWith("--")) ?? throw new ArgumentException("Missing widget id. Run umbractl help.");
                var o = O(("id", id));
                if (a.Contains("--accept-permissions")) o["acceptPermissions"] = true;
                return ("install", o);
            }
            case "reset-position" or "remove" or "add-instance" or "remove-instance" or "install-theme" or "remove-theme":
                return (a[0], O(("id", Arg(a, 1, "widget id"))));
            case "hotkeys":
            {
                // umbractl hotkeys | hotkeys reset | hotkeys <action> <keys|off>
                if (a.Length == 1) return ("hotkeys", new JsonObject());
                if (a[1] == "reset") return ("hotkeys", O(("reset", true)));
                var keys = Arg(a, 2, "keys (e.g. Ctrl+Alt+E, or off)");
                return ("hotkeys", O(("action", a[1]), ("keys", keys.Equals("off", StringComparison.OrdinalIgnoreCase) ? "" : keys)));
            }
            case "approvals":
                // List only. Approving a widget's command is a human action (prompt or Settings > My widgets).
                return ("approvals", a.Length > 1 ? O(("id", a[1])) : new JsonObject());
            case "privacy":
                return ("privacy", a.Length > 1 ? O(("id", a[1])) : new JsonObject());
            case "backup":
                return ("backup", O(("path", Path.GetFullPath(Arg(a, 1, "output file")))));
            case "restore":
                return ("restore", O(("path", Path.GetFullPath(Arg(a, 1, "backup file")))));
            case "refresh":
                return ("refresh", a.Length > 1 ? O(("id", a[1])) : new JsonObject());
            case "capture":
            {
                var target = Arg(a, 1, "target (widget id or settings:<page>)");
                var file = a.Length > 2 ? a[2] : $"{target.Replace(':', '-')}.png";
                return ("capture", O(("target", target), ("path", Path.GetFullPath(file))));
            }
            case "data":
            {
                var id = Arg(a, 1, "widget id");
                if (a.Contains("--clear")) return ("data", O(("id", id), ("op", "clear")));
                if (Flag(a, "--remove") is string rm) return ("data", O(("id", id), ("op", "remove"), ("key", rm)));
                if (a.Length == 2) return ("data", O(("id", id)));
                if (a.Length == 3) return ("data", O(("id", id), ("key", a[2])));
                return ("data", O(("id", id), ("op", "set"), ("key", a[2]), ("value", JsonOrText(a[3]))));
            }
            case "settings":
                return ("open-settings", a.Length > 1 ? O(("page", a[1])) : new JsonObject());
            case "diagnostics":
                return ("diagnostics", new JsonObject());
            case "logs":
                return ("logs", O(("lines", a.Length > 1 ? int.Parse(a[1]) : 50)));
            case "create":
            {
                // umbractl create <folder>: send a widget folder from disk (e.g. one you are editing in the repo).
                var folder = Path.GetFullPath(Arg(a, 1, "widget folder"));
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
                return (Arg(a, 1, "command"), a.Length > 2 ? JsonNode.Parse(a[2]) as JsonObject ?? throw new ArgumentException("args must be a JSON object") : new JsonObject());
            default:
                throw new ArgumentException($"Unknown command '{a[0]}'. Run umbractl help.");
        }
    }

    // Option values are typed by the widget's schema, so "set clock seconds true" sends a boolean
    // and "set sp500 symbol 123" still sends a string.
    static async Task<JsonNode?> OptionValue(Func<string, JsonObject, Task<JsonObject>> send, string id, string key, string raw)
    {
        var list = await send("list", new JsonObject());
        var type = (list["result"] as JsonArray)?.FirstOrDefault(w => w?["id"]?.GetValue<string>() == id)?["optionSchema"]?[key]?["type"]?.GetValue<string>();
        return type switch
        {
            "toggle" => OnOff(raw),
            "number" => JsonValue.Create(double.Parse(raw, CultureInfo.InvariantCulture)),
            _ => JsonValue.Create(raw),
        };
    }

    /// <summary>"1.5" or "150%" (both mean 150 %).</summary>
    internal static double Scale(string raw)
    {
        var percent = raw.EndsWith('%');
        if (!double.TryParse(percent ? raw[..^1] : raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
            throw new ArgumentException($"Expected a scale like 1.5 or 150%, got '{raw}'");
        return percent ? v / 100 : v;
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

    public static string Arg(string[] a, int i, string what) => i < a.Length ? a[i] : throw new ArgumentException($"Missing {what}. Run umbractl help.");

    public static string? Flag(string[] a, string name)
    {
        var i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : null;
    }
}
