using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// The <c>scripts</c> control command (umbractl scripts, the MCP <c>scripts</c> tool): AI agents manage the user's own scripts
/// (<see cref="UserScripts"/>, Script Runner). Listing them always works; reading output, adding, editing, deleting, approving,
/// running and stopping work only while the user switched on <see cref="GeneralSettings.AgentScripts"/> in Settings. That
/// switch is off by default and only the Settings page changes it: no control command, umbractl or MCP tool, and no backup.
/// A script that runs as administrator stays the user's alone (created, changed, approved and started only in Settings or by
/// a click on the widget).
/// </summary>
static class AgentScripts
{
    public const string SwitchName = "Let AI agents manage my scripts";
    public static readonly string[] Ops = ["list", "get", "output", "add", "edit", "delete", "approve", "run", "stop"];
    static readonly string[] Reads = ["list", "get"];
    static readonly string[] Fields = ["title", "description", "kind", "mode", "path", "code", "args", "startIn", "timeoutSeconds", "keepsRunning", "autoStart", "restart", "runAsAdmin"];

    /// <param name="Allowed">The user's <see cref="GeneralSettings.AgentScripts"/> switch.</param>
    /// <param name="Enabled">The widget copy is switched on (a script that finishes runs only then).</param>
    /// <param name="WindowOpen">The widget has an open window (a script that keeps running stops when its widget is off).</param>
    public sealed record Context(CommandService Commands, WidgetManifest Manifest, bool Allowed, bool Enabled, bool WindowOpen);

    public static bool IsRead(string op) => Reads.Contains(op);

    static string Off(WidgetManifest m) =>
        $"AI agents can't change, run or stop scripts yet: the user has to switch on \"{SwitchName}\" in Settings > My widgets > {m.Name}. Listing them (list, get) works without it.";

    const string AdminOnly = "A script that runs as administrator is created, changed, approved, started and deleted only by the user (Settings, or a click on the widget)";

    public static async Task<JsonNode?> ExecuteAsync(Context c, string op, JsonObject a)
    {
        var (svc, m) = (c.Commands, c.Manifest);
        if (!svc.TakesUserScripts(m)) throw new WidgetCommandException($"{m.Name} doesn't take your own scripts (no permissions.userScripts)");
        if (!Ops.Contains(op)) throw new WidgetCommandException($"\"op\" must be one of: {string.Join(", ", Ops)}");
        if (!c.Allowed && !IsRead(op)) throw new WidgetCommandException(Off(m));

        switch (op)
        {
            case "list":
                return new JsonObject
                {
                    ["widget"] = m.Id,
                    ["agentAccess"] = c.Allowed,
                    ["scripts"] = new JsonArray(svc.UserScriptsOf(m).Select(s => (JsonNode?)Item(c, s)).ToArray()),
                };

            case "get":
                return Item(c, Find(c, a));

            case "output":
                return svc.Output(m.Id, m.Id, Find(c, a).Id);

            case "add":
            case "edit":
            {
                var input = a["script"] as JsonObject ?? throw new WidgetCommandException("\"script\" (object with the script's fields) is required");
                UserScript s;
                if (op == "edit")
                {
                    s = Find(c, a);
                    if (s.RunAsAdmin) throw new WidgetCommandException(AdminOnly);
                }
                else s = new UserScript();
                Overlay(s, input);
                if (op == "add") s.Id = "";
                if (s.RunAsAdmin) throw new WidgetCommandException(AdminOnly);
                var (saved, approved) = svc.SaveUserScript(m, s);
                Log.Write($"[{m.Id}] user script '{saved.Id}' {(op == "add" ? "added" : "changed")} by an AI agent (umbractl/MCP)");
                var item = Item(c, saved);
                if (!approved) item["note"] = "Saved, but its program wasn't found on this PC (PATH). Install it or use a full path, then approve it";
                return item;
            }

            case "delete":
            {
                var s = Find(c, a);
                if (s.RunAsAdmin) throw new WidgetCommandException(AdminOnly);
                svc.DeleteUserScript(m, s.Id);
                Log.Write($"[{m.Id}] user script '{s.Id}' deleted by an AI agent (umbractl/MCP)");
                return new JsonObject { ["deleted"] = s.Id };
            }

            case "approve":
            {
                var s = Find(c, a);
                if (s.RunAsAdmin) throw new WidgetCommandException(AdminOnly);
                var spec = Spec(c, s);
                svc.ApproveFromSettings(m, spec.Id, spec.Hash());
                Log.Write($"[{m.Id}] user script '{s.Id}' approved by an AI agent (umbractl/MCP)");
                return Item(c, s);
            }

            case "run":
            {
                var s = Find(c, a);
                if (s.RunAsAdmin) throw new WidgetCommandException("A script that runs as administrator only starts when the user clicks Run on the widget");
                var spec = Spec(c, s);
                Log.Write($"[{m.Id}] user script '{s.Id}' {(spec.KeepsRunning ? "started" : "run")} by an AI agent (umbractl/MCP)");
                if (spec.KeepsRunning)
                {
                    if (!c.WindowOpen) throw new WidgetCommandException($"Turn {m.Name} on first: a script that keeps running stops when its widget is off");
                    if (svc.State(m.Id, s.Id) is { Running: true } or { Restarting: true }) return Item(c, s);
                    svc.StartFromSettings(m, spec.Id);
                    return Item(c, s);
                }
                return await svc.RunAsync(m, c.Enabled, userGesture: false, spec.Id, null, CancellationToken.None);
            }

            case "stop":
            {
                var s = Find(c, a);
                var stopped = svc.Stop(m.Id, m.Id, s.Id);
                if (stopped) Log.Write($"[{m.Id}] user script '{s.Id}' stopped by an AI agent (umbractl/MCP)");
                return new JsonObject { ["stopped"] = stopped };
            }
        }
        return null;
    }

    static UserScript Find(Context c, JsonObject a)
    {
        var id = a["scriptId"] is JsonValue v && v.TryGetValue<string>(out var sid) ? sid
            : throw new WidgetCommandException("\"scriptId\" (string) is required: the script's id from list");
        var all = c.Commands.UserScriptsOf(c.Manifest);
        // The id, or else the exact name (case-insensitive), which is what people and agents usually know.
        return all.FirstOrDefault(s => s.Id == id)
               ?? all.FirstOrDefault(s => string.Equals(s.Title, id, StringComparison.OrdinalIgnoreCase))
               ?? throw new WidgetCommandException($"No script '{id}'. Scripts: {string.Join(", ", all.Select(s => s.Id))}");
    }

    /// <summary>The command a stored script runs; a script that no longer validates can't be approved or run until it's fixed.</summary>
    static CommandSpec Spec(Context c, UserScript s) =>
        c.Commands.All(c.Manifest).FirstOrDefault(x => x.Id == s.Id && x.IsUserScript)
        ?? throw new WidgetCommandException($"The script '{s.Id}' can't run as it is: edit it to fix it");

    /// <summary>Copies the fields the agent sent onto the script; unknown fields and wrong types are refused with a sentence.</summary>
    static void Overlay(UserScript s, JsonObject input)
    {
        foreach (var (key, _) in input)
            if (!Fields.Contains(key) && key != "id")
                throw new WidgetCommandException($"Unknown script field '{key}'. Fields: {string.Join(", ", Fields)}");
        if (Text(input, "title") is { } t) s.Title = t;
        if (Text(input, "description") is { } d) s.Description = d;
        if (Text(input, "kind") is { } k) s.Kind = k;
        if (Text(input, "path") is { } p) s.Path = p;
        if (Text(input, "code") is { } code) s.Code = code;
        if (Text(input, "args") is { } args) s.Args = args;
        if (Text(input, "startIn") is { } si) s.StartIn = si;
        // Code or a path without a mode says which one is meant.
        if (Text(input, "mode") is { } mode) s.Mode = mode;
        else if (input.ContainsKey("code")) s.Mode = "code";
        else if (input.ContainsKey("path")) s.Mode = "file";
        if (input["timeoutSeconds"] is JsonNode ts)
            s.TimeoutSeconds = ts.GetValueKind() == JsonValueKind.Number && ts.AsValue().TryGetValue<int>(out var n) ? n
                : throw new WidgetCommandException("\"timeoutSeconds\" must be a whole number of seconds");
        if (Flag(input, "keepsRunning") is { } kr) s.KeepsRunning = kr;
        if (Flag(input, "autoStart") is { } au) s.AutoStart = au;
        if (Flag(input, "restart") is { } re) s.Restart = re;
        if (Flag(input, "runAsAdmin") is { } ad) s.RunAsAdmin = ad;
    }

    static string? Text(JsonObject o, string key) =>
        o[key] is not JsonNode n ? null
        : n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>()
        : throw new WidgetCommandException($"\"{key}\" must be text");

    static bool? Flag(JsonObject o, string key) =>
        o[key] is not JsonNode n ? null
        : n.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? n.GetValue<bool>()
        : throw new WidgetCommandException($"\"{key}\" must be true or false");

    /// <summary>One script as agents see it: what it runs, whether it's approved, and (keeps running) whether it's up.</summary>
    static JsonObject Item(Context c, UserScript s)
    {
        var (svc, m) = (c.Commands, c.Manifest);
        var row = svc.Describe([m], m.Id).OfType<JsonObject>()
            .FirstOrDefault(r => r["userScript"] is not null && r["command"]?.GetValue<string>() == s.Id);
        var o = new JsonObject
        {
            ["id"] = s.Id,
            ["title"] = s.Title,
            ["description"] = s.Description,
            ["kind"] = s.Kind,
            ["mode"] = s.IsCode ? "code" : "file",
            ["status"] = row?["status"]?.GetValue<string>() ?? "invalid",
            ["line"] = row?["run"]?.GetValue<string>(),
            ["keepsRunning"] = s.KeepsRunning,
        };
        if (!s.IsCode) o["path"] = s.Path;
        else if (c.Allowed) o["code"] = s.Code; // the code itself only while the user lets agents manage scripts
        if (s.Args.Length > 0) o["args"] = s.Args;
        if (s.StartIn.Length > 0) o["startIn"] = s.StartIn;
        if (s.RunAsAdmin) o["runAsAdmin"] = true;
        if (s.KeepsRunning)
        {
            var st = svc.State(m.Id, s.Id);
            o["autoStart"] = s.AutoStart;
            o["restart"] = s.Restart;
            o["running"] = st.Running;
            o["restarting"] = st.Restarting;
            if (st.Since is { } since) o["since"] = new DateTimeOffset(since).ToUnixTimeMilliseconds();
            if (st.LastExit is { } exit) o["lastExit"] = exit;
        }
        else o["timeoutSeconds"] = s.TimeoutSeconds;
        return o;
    }
}
