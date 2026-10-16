using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra.Cli;

/// <summary>
/// A Model Context Protocol server over stdio (umbractl mcp): newline-delimited JSON-RPC 2.0.
/// Every tool maps onto a control-protocol command, so an agent can see, configure and build
/// widgets on the user's desktop. Register it with:  claude mcp add umbra -- umbractl mcp
/// </summary>
sealed class McpServer(Func<string, JsonObject, Task<JsonObject>> send)
{
    static readonly string[] SupportedVersions = { "2025-06-18", "2025-03-26", "2024-11-05" };
    static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    record Tool(string Name, string Command, string Description, JsonObject Schema);

    static JsonObject Obj(params (string Key, JsonNode? Value)[] props)
    {
        var o = new JsonObject();
        foreach (var (k, v) in props) o[k] = v;
        return o;
    }

    static JsonObject Schema(JsonObject properties, params string[] required) => Obj(
        ("type", "object"),
        ("properties", properties),
        ("required", new JsonArray(required.Select(r => (JsonNode?)r).ToArray())),
        ("additionalProperties", false));

    static JsonObject P(string type, string description) => Obj(("type", type), ("description", description));

    static readonly JsonObject IdProp = P("string", "Widget id, e.g. \"sp500\" (see list_widgets)");

    static readonly Tool[] Tools =
    {
        new("umbra_status", "status", "Umbra version, data folders, startup state, general settings and which widgets are open on the desktop.", Schema(new())),
        new("list_widgets", "list", "Every installed widget: id, name, source (builtin/community), enabled, locked, window bounds in physical pixels, current option values and the option schema (types and choices).", Schema(new())),
        new("configure_widget", "configure", "Change one widget. Any subset of: enabled (show/hide), locked (no moving, resizing or zooming by hand), x/y (screen position in physical pixels), scale (size and zoom, 0.5-3), options (values must match the widget's optionSchema). Applies live.",
            Schema(Obj(("id", IdProp.DeepClone()), ("enabled", P("boolean", "Show or hide the widget")), ("locked", P("boolean", "Lock position, size and zoom")),
                ("x", P("integer", "Left edge, physical pixels")), ("y", P("integer", "Top edge, physical pixels")),
                ("scale", Obj(("type", "number"), ("minimum", 0.5), ("maximum", 3), ("description", "Window size and page zoom; 1 = the widget's normal size, 1.5 = 150 %"))),
                ("options", P("object", "Option values by key, e.g. {\"symbol\": \"^IXIC\"}"))), "id")),
        new("edit_mode", "edit-mode", "Turn Umbra's edit mode on or off (omit on to read it). In edit mode the user can move unlocked widgets, resize them with a corner handle and zoom them with Ctrl+wheel. It is not saved across restarts.",
            Schema(Obj(("on", P("boolean", "true = edit mode on, false = off"))))),
        new("set_general", "set-general", "Change app-wide settings: refreshSeconds (30-600, how often widgets update), animations (on/off), startup (start with Windows), checkForUpdates (daily GitHub check for a new Umbra).",
            Schema(Obj(("refreshSeconds", P("integer", "30 to 600")), ("animations", P("boolean", "Enable motion")), ("startup", P("boolean", "Start Umbra when the user signs in")), ("checkForUpdates", P("boolean", "Check GitHub daily for a new Umbra release"))))),
        new("check_update", "check-update", "Check GitHub now for a newer Umbra release and report it (update.available has the version when there is one). Installing is left to the user via the tray menu or Settings > About.", Schema(new())),
        new("reset_widget_position", "reset-position", "Move a widget back to its default position.", Schema(Obj(("id", IdProp.DeepClone())), "id")),
        new("refresh_widgets", "refresh", "Ask widgets to fetch fresh data now (all, or one id).", Schema(Obj(("id", IdProp.DeepClone())))),
        new("reload_widgets", "reload", "Re-scan widget folders after files were edited on disk, reopening changed widgets.", Schema(new())),
        new("browse_catalog", "catalog", "The community widget catalog (from the GitHub repo), with installed and updateAvailable flags.", Schema(new())),
        new("install_widget", "install", "Install or update a community widget from the catalog by id.", Schema(Obj(("id", IdProp.DeepClone())), "id")),
        new("remove_widget", "remove", "Uninstall a community widget (built-in widgets can only be disabled).", Schema(Obj(("id", IdProp.DeepClone())), "id")),
        new("create_widget", "create-widget",
            "Create or replace a local widget from source files and show it on the desktop. Call widget_authoring_guide first. " +
            "files maps relative paths to contents: widget.json and the entry page are required; text files as plain text, images and fonts as base64. " +
            "The widget is sandboxed: network access only to permissions.hosts. After creating it, call capture to look at the result and iterate.",
            Schema(Obj(("id", IdProp.DeepClone()),
                ("files", Obj(("type", "object"), ("description", "{\"widget.json\": \"...\", \"index.html\": \"...\", \"main.js\": \"...\"}"), ("additionalProperties", Obj(("type", "string"))))),
                ("overwrite", P("boolean", "Replace an existing widget with this id"))), "id", "files")),
        new("widget_data", "data",
            "Read or change a widget's saved data (what the widget stores with umbra.store, e.g. a todo list). op: get (default; all keys, or one key), set (key + value, any JSON), remove (key) or clear. " +
            "An open widget is notified and re-renders. Use list_widgets for ids.",
            Schema(Obj(("id", IdProp.DeepClone()),
                ("op", Obj(("type", "string"), ("enum", new JsonArray("get", "set", "remove", "clear")), ("description", "Default get"))),
                ("key", P("string", "Storage key; omit with get to read everything")),
                ("value", Obj(("description", "Any JSON value, for set")))), "id")),
        new("capture", "capture","Screenshot one widget (target = its id) or a Settings page (target = settings:general|widgets|browse|about). Returns a PNG of only that surface, never the rest of the screen.",
            Schema(Obj(("target", P("string", "Widget id or settings:<page>"))), "target")),
        new("open_settings", "open-settings", "Open Umbra's Settings window for the user, optionally on a page (general, widgets, browse, about).", Schema(Obj(("page", P("string", "general | widgets | browse | about"))))),
        new("read_logs", "logs", "The last lines of Umbra's log: widget load errors, blocked network requests, crashes.", Schema(Obj(("lines", P("integer", "How many lines (default 50)"))))),
        new("widget_authoring_guide", "", "How to write an Umbra widget: the manifest format, the JavaScript SDK (umbra.fetchJson, umbra.every, options...), the sandbox and the design rules, plus the widget.json JSON Schema. Read this before create_widget.", Schema(new())),
    };

    public async Task RunAsync(TextReader input, TextWriter output)
    {
        string? line;
        while ((line = await input.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            JsonObject? reply;
            try
            {
                reply = JsonNode.Parse(line) is JsonObject msg ? await HandleAsync(msg) : RpcError(null, -32600, "Invalid request");
            }
            catch (JsonException ex)
            {
                reply = RpcError(null, -32700, $"Parse error: {ex.Message}");
            }
            if (reply is null) continue;
            await output.WriteLineAsync(reply.ToJsonString());
            await output.FlushAsync();
        }
    }

    /// <summary>Handles one JSON-RPC message. Returns null for notifications.</summary>
    public async Task<JsonObject?> HandleAsync(JsonObject msg)
    {
        var id = msg["id"]?.DeepClone();
        var method = msg["method"]?.GetValue<string>();
        if (id is null) return null; // notifications (notifications/initialized, cancelled...) need no answer

        switch (method)
        {
            case "initialize":
                var requested = msg["params"]?["protocolVersion"]?.GetValue<string>();
                return Result(id, Obj(
                    ("protocolVersion", SupportedVersions.Contains(requested) ? requested : SupportedVersions[0]),
                    ("capabilities", Obj(("tools", new JsonObject()))),
                    ("serverInfo", Obj(("name", "umbra"), ("version", typeof(McpServer).Assembly.GetName().Version?.ToString(3)))),
                    ("instructions", "Umbra pins small web widgets to the user's Windows desktop. Use list_widgets to see them, " +
                                     "configure_widget to change them, and widget_authoring_guide + create_widget + capture to build new ones.")));

            case "ping":
                return Result(id, new JsonObject());

            case "tools/list":
                return Result(id, Obj(("tools", new JsonArray(Tools.Select(t => (JsonNode?)Obj(
                    ("name", t.Name), ("description", t.Description), ("inputSchema", t.Schema.DeepClone()))).ToArray()))));

            case "tools/call":
                var name = msg["params"]?["name"]?.GetValue<string>();
                var args = msg["params"]?["arguments"] as JsonObject ?? new JsonObject();
                var tool = Tools.FirstOrDefault(t => t.Name == name);
                if (tool is null) return RpcError(id, -32602, $"Unknown tool '{name}'");
                return Result(id, await CallAsync(tool, (JsonObject)args.DeepClone()));

            default:
                return RpcError(id, -32601, $"Method not found: {method}");
        }
    }

    async Task<JsonObject> CallAsync(Tool tool, JsonObject args)
    {
        if (tool.Name == "widget_authoring_guide") return Text(AuthoringGuide());

        JsonObject reply;
        try { reply = await send(tool.Command, args); }
        catch (Exception ex) { return Text(ex.Message, isError: true); }

        if (reply["ok"]?.GetValue<bool>() != true)
            return Text(reply["error"]?.GetValue<string>() ?? "Umbra reported an error", isError: true);

        var result = reply["result"];
        if (tool.Name == "capture" && result?["base64"] is JsonNode b64)
            return Obj(("content", new JsonArray(Obj(("type", "image"), ("data", b64.GetValue<string>()), ("mimeType", "image/png")))));
        return Text(result?.ToJsonString(Pretty) ?? "ok");
    }

    static string AuthoringGuide()
    {
        string Read(string rel)
        {
            var path = Path.Combine(AppContext.BaseDirectory, rel);
            return File.Exists(path) ? File.ReadAllText(path) : $"({rel} not found next to umbractl.exe; see https://github.com/AmineChr54/umbra/blob/main/{rel.Replace('\\', '/')})";
        }
        return $"{Read(Path.Combine("docs", "widget-sdk.md"))}\n\n## widget.json JSON Schema\n\n```json\n{Read(Path.Combine("schemas", "widget.schema.json"))}\n```\n";
    }

    static JsonObject Text(string text, bool isError = false)
    {
        var o = Obj(("content", new JsonArray(Obj(("type", "text"), ("text", text)))));
        if (isError) o["isError"] = true;
        return o;
    }

    static JsonObject Result(JsonNode id, JsonNode result) => Obj(("jsonrpc", "2.0"), ("id", id), ("result", result));

    static JsonObject RpcError(JsonNode? id, int code, string message) =>
        Obj(("jsonrpc", "2.0"), ("id", id), ("error", Obj(("code", code), ("message", message))));

    public static IEnumerable<string> ToolNames => Tools.Select(t => t.Name);
}
