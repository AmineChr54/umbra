using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Executes control-protocol commands (<see cref="Protocol"/>) against the running app.
/// This is what makes Umbra scriptable: umbractl, the MCP server and tests all end up here.
/// Every command runs on the UI thread, so it can touch windows and settings directly.
/// </summary>
sealed class Control(App app)
{
    sealed class CommandException(string message) : Exception(message);

    public async Task<string?> HandleLineAsync(string line)
    {
        if (line.Trim() == "settings")
        {
            await app.OnUi(() => Task.FromResult(app.ShowSettings()));
            return null; // legacy second-launch signal: no reply expected
        }

        JsonObject reply;
        string cmd = "?";
        try
        {
            var req = JsonNode.Parse(line) as JsonObject ?? throw new CommandException("Request must be a JSON object");
            cmd = req["cmd"]?.GetValue<string>() ?? throw new CommandException("Missing \"cmd\"");
            var args = req["args"] as JsonObject ?? new JsonObject();
            reply = Protocol.Ok(await app.OnUi(() => Execute(cmd, args)));
        }
        catch (Exception ex)
        {
            if (ex is not CommandException) Log.Write($"Control '{cmd}' failed: {ex}");
            reply = Protocol.Error(ex is JsonException ? $"Invalid JSON: {ex.Message}" : ex.Message);
        }
        return reply.ToJsonString();
    }

    async Task<JsonNode?> Execute(string cmd, JsonObject a)
    {
        switch (cmd)
        {
            case "status":
                return new JsonObject
                {
                    ["version"] = Application.ProductVersion.Split('+')[0],
                    ["protocol"] = 1,
                    ["exe"] = AppPaths.ExePath,
                    ["dataDir"] = AppPaths.DataDir,
                    ["communityDir"] = AppPaths.CommunityDir,
                    ["startup"] = Startup.IsEnabled(),
                    ["general"] = JsonSerializer.SerializeToNode(app.Settings.General, Web),
                    ["widgets"] = app.Manifests.Count,
                    ["open"] = new JsonArray(app.OpenWindows.Select(w => (JsonNode?)w.Manifest.Id).ToArray()),
                    ["commands"] = new JsonArray(Protocol.Commands.Select(c => (JsonNode?)c.Cmd).ToArray()),
                };

            case "list":
                return new JsonArray(app.Manifests.Select(m => (JsonNode?)Describe(m)).ToArray());

            case "configure":
            {
                var m = Manifest(a);
                var ws = app.Settings.For(m);
                if (a["enabled"] is JsonNode en) ws.Enabled = Bool(en, "enabled");
                if (a["locked"] is JsonNode lk) ws.Locked = Bool(lk, "locked");
                if (a["x"] is JsonNode x) ws.X = Int(x, "x");
                if (a["y"] is JsonNode y) ws.Y = Int(y, "y");
                if (a["options"] is JsonObject opts)
                    foreach (var (key, value) in opts) ws.Options[key] = CheckOption(m, key, value);
                else if (a["options"] is not null) throw new CommandException("\"options\" must be an object");
                app.SaveSettings();
                app.SyncWindows();
                app.Window(m.Id)?.PushSettings();
                app.SettingsChangedElsewhere();
                return Describe(m);
            }

            case "set-general":
            {
                var g = app.Settings.General;
                if (a["refreshSeconds"] is JsonNode r)
                {
                    var secs = Int(r, "refreshSeconds");
                    if (secs is < 30 or > 600) throw new CommandException("refreshSeconds must be between 30 and 600");
                    g.RefreshSeconds = secs;
                }
                if (a["animations"] is JsonNode an) g.Animations = Bool(an, "animations");
                if (a["startup"] is JsonNode st) Startup.Set(Bool(st, "startup"));
                app.SaveSettings();
                foreach (var w in app.OpenWindows) w.PushSettings();
                app.SettingsChangedElsewhere();
                return new JsonObject
                {
                    ["general"] = JsonSerializer.SerializeToNode(g, Web),
                    ["startup"] = Startup.IsEnabled(),
                };
            }

            case "reset-position":
            {
                var m = Manifest(a);
                app.ResetPosition(m.Id);
                return Describe(m);
            }

            case "refresh":
                foreach (var w in app.OpenWindows.Where(w => a["id"] is null || w.Manifest.Id == Str(a, "id"))) w.RefreshData();
                return null;

            case "reload":
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                return new JsonArray(app.Manifests.Select(m => (JsonNode?)Describe(m)).ToArray());

            case "catalog":
            {
                var list = new JsonArray();
                foreach (var entry in await Community.FetchCatalogAsync())
                {
                    if (entry is null) continue;
                    var copy = entry.DeepClone().AsObject();
                    copy.Remove("files");
                    var installed = app.Manifests.FirstOrDefault(m => m.Id == copy["id"]?.GetValue<string>());
                    copy["installed"] = installed is not null;
                    copy["builtin"] = installed?.Source == WidgetSource.BuiltIn;
                    copy["installedVersion"] = installed?.Version;
                    copy["updateAvailable"] = installed is { Source: WidgetSource.Community }
                        && Community.CompareVersions(copy["version"]?.GetValue<string>() ?? "0", installed.Version) > 0;
                    list.Add(copy);
                }
                return list;
            }

            case "install":
            {
                var id = Str(a, "id");
                if (app.Manifests.Any(m => m.Id == id && m.Source == WidgetSource.BuiltIn))
                    throw new CommandException($"'{id}' is built in and always installed");
                var entry = (await Community.FetchCatalogAsync()).FirstOrDefault(w => w?["id"]?.GetValue<string>() == id)
                            ?? throw new CommandException($"'{id}' is not in the community catalog");
                app.CloseWidget(id);
                await Community.InstallAsync(entry);
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                return Describe(app.Manifests.First(m => m.Id == id));
            }

            case "remove":
            {
                var m = Manifest(a);
                if (m.Source == WidgetSource.BuiltIn) throw new CommandException($"'{m.Id}' is built in; disable it instead");
                app.CloseWidget(m.Id);
                Community.Remove(m.Id);
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                return null;
            }

            case "create-widget":
            {
                var id = Str(a, "id");
                if (app.Manifests.Any(m => m.Id == id && m.Source == WidgetSource.BuiltIn))
                    throw new CommandException($"'{id}' is the id of a built-in widget; pick another id");
                if (a["files"] is not JsonObject filesNode) throw new CommandException("\"files\" must be an object of {path: content}");
                var files = filesNode.ToDictionary(kv => kv.Key, kv => kv.Value?.GetValueKind() == JsonValueKind.String
                    ? kv.Value.GetValue<string>()
                    : kv.Value?.ToJsonString() ?? "");
                app.CloseWidget(id);
                var dir = Community.WriteLocalWidget(id, files, a["overwrite"] is JsonNode o && Bool(o, "overwrite"));
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                var created = app.Manifests.FirstOrDefault(m => m.Id == id)
                              ?? throw new CommandException("The widget was written but Umbra could not load its widget.json; check logs");
                var info = Describe(created);
                info["path"] = dir;
                return info;
            }

            case "capture":
                return await Capture(Str(a, "target"), a["path"]?.GetValue<string>());

            case "open-settings":
            {
                var win = app.ShowSettings();
                if (a["page"] is not null) await win.ShowPageAsync(Str(a, "page"));
                return null;
            }

            case "logs":
                return new JsonArray(Log.Tail(a["lines"] is JsonNode n ? Int(n, "lines") : 50).Select(l => (JsonNode?)l).ToArray());

            case "quit":
                app.QuitSoon();
                return null;

            default:
                throw new CommandException($"Unknown command '{cmd}'. Commands: {string.Join(", ", Protocol.Commands.Select(c => c.Cmd))}");
        }
    }

    /// <summary>target = widget id, or settings:&lt;page&gt;. Writes to path when given, otherwise returns base64.</summary>
    async Task<JsonNode> Capture(string target, string? path)
    {
        byte[] png;
        if (target.StartsWith("settings", StringComparison.OrdinalIgnoreCase))
        {
            var page = target.Contains(':') ? target[(target.IndexOf(':') + 1)..] : "general";
            var wasOpen = app.SettingsOpen;
            var win = app.ShowSettings();
            try { png = await win.CaptureAsync(page); }
            finally { if (!wasOpen) win.Close(); }
        }
        else
        {
            var m = app.Manifests.FirstOrDefault(x => x.Id == target)
                    ?? throw new CommandException($"No widget '{target}'. Targets: {string.Join(", ", app.Manifests.Select(x => x.Id))}, settings:<page>");
            var win = app.Window(m.Id) ?? throw new CommandException($"'{m.Id}' is not open; enable it first (configure enabled=true)");
            png = await win.CaptureAsync();
        }

        if (string.IsNullOrEmpty(path))
            return new JsonObject { ["mimeType"] = "image/png", ["bytes"] = png.Length, ["base64"] = Convert.ToBase64String(png) };
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, png);
        return new JsonObject { ["path"] = full, ["bytes"] = png.Length };
    }

    JsonObject Describe(WidgetManifest m)
    {
        var ws = app.Settings.For(m);
        var win = app.Window(m.Id);
        return new JsonObject
        {
            ["id"] = m.Id,
            ["name"] = m.Name,
            ["description"] = m.Description,
            ["author"] = m.Author,
            ["version"] = m.Version,
            ["source"] = m.Source == WidgetSource.BuiltIn ? "builtin" : "community",
            ["folder"] = Path.Combine(m.Source == WidgetSource.BuiltIn ? AppPaths.WidgetsDir : AppPaths.CommunityDir, m.Folder),
            ["enabled"] = ws.Enabled,
            ["locked"] = ws.Locked,
            ["open"] = win is not null,
            ["bounds"] = win is null ? null : new JsonObject { ["x"] = win.Left, ["y"] = win.Top, ["width"] = win.Width, ["height"] = win.Height },
            ["hosts"] = new JsonArray(m.Permissions.Hosts.Select(h => (JsonNode?)h).ToArray()),
            ["options"] = ws.Options.DeepClone(),
            ["optionSchema"] = m.Options.DeepClone(),
        };
    }

    /// <summary>Checks a value against the option's declared type (text, number, select, toggle).</summary>
    internal static JsonNode? CheckOption(WidgetManifest m, string key, JsonNode? value)
    {
        if (m.Options[key] is not JsonObject spec)
            throw new CommandException($"'{m.Id}' has no option '{key}'. Options: {string.Join(", ", m.OptionOrder)}");
        var kind = value?.GetValueKind();
        switch (spec["type"]?.GetValue<string>())
        {
            case "toggle" when kind is JsonValueKind.True or JsonValueKind.False:
            case "number" when kind is JsonValueKind.Number:
            case "text" when kind is JsonValueKind.String:
                return value!.DeepClone();
            case "select" when kind is JsonValueKind.String:
                var v = value!.GetValue<string>();
                var choices = (spec["choices"] as JsonArray)?.Select(c => c?["value"]?.GetValue<string>()).ToList() ?? new();
                if (!choices.Contains(v)) throw new CommandException($"'{key}' must be one of: {string.Join(", ", choices)}");
                return value.DeepClone();
            default:
                throw new CommandException($"'{key}' expects a {spec["type"]} value, got {kind?.ToString() ?? "null"}");
        }
    }

    WidgetManifest Manifest(JsonObject a)
    {
        var id = Str(a, "id");
        return app.Manifests.FirstOrDefault(m => m.Id == id)
               ?? throw new CommandException($"No widget '{id}'. Installed: {string.Join(", ", app.Manifests.Select(m => m.Id))}");
    }

    static string Str(JsonObject a, string key) =>
        a[key]?.GetValueKind() == JsonValueKind.String ? a[key]!.GetValue<string>() : throw new CommandException($"\"{key}\" (string) is required");

    static bool Bool(JsonNode n, string key) =>
        n.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? n.GetValue<bool>() : throw new CommandException($"\"{key}\" must be true or false");

    static int Int(JsonNode n, string key) =>
        n.GetValueKind() == JsonValueKind.Number && n.AsValue().TryGetValue(out int i) ? i
        : n.GetValueKind() == JsonValueKind.Number ? (int)Math.Round(n.GetValue<double>())
        : throw new CommandException($"\"{key}\" must be a number");

    static readonly JsonSerializerOptions Web = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
}
