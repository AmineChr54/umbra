using System.Globalization;
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
    internal sealed class CommandException(string message) : Exception(message);

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
                    ["portable"] = AppPaths.IsPortable,
                    ["communityDir"] = AppPaths.CommunityDir,
                    ["startup"] = Startup.IsEnabled(),
                    ["editMode"] = app.EditMode,
                    ["safeMode"] = app.SafeMode,
                    ["update"] = app.Updater.ToJson(),
                    ["updateAvailable"] = app.Updater.Available?.Version,
                    ["general"] = JsonSerializer.SerializeToNode(app.Settings.General, Web),
                    ["monitors"] = MonitorList(),
                    ["hiddenByFullscreen"] = app.HiddenByFullscreen,
                    ["widgets"] = app.Manifests.Count,
                    ["open"] = new JsonArray(app.OpenWindows.Select(w => (JsonNode?)w.Instance).ToArray()),
                    ["commands"] = new JsonArray(Protocol.Commands.Select(c => (JsonNode?)c.Cmd).ToArray()),
                };

            case "list":
                return DescribeAll();

            case "configure":
            {
                var (m, inst) = Target(a);
                var ws = app.Settings.For(m, inst);
                if (a["enabled"] is JsonNode en) ws.Enabled = Bool(en, "enabled");
                if (a["locked"] is JsonNode lk) ws.Locked = Bool(lk, "locked");
                string? monitor = null;
                if (a["monitor"] is JsonNode mo)
                {
                    monitor = mo.GetValueKind() == JsonValueKind.String ? mo.GetValue<string>() : throw new CommandException("\"monitor\" must be a monitor name or number (see status.monitors)");
                    monitor = ResolveMonitor(monitor);
                }
                if (a["x"] is JsonNode x) ws.X = Int(x, "x");
                if (a["y"] is JsonNode y) ws.Y = Int(y, "y");
                if (a["x"] is not null || a["y"] is not null) { ws.Monitor = null; ws.RelX = ws.RelY = null; } // an absolute spot replaces the recorded monitor
                if (a["scale"] is JsonNode sc) ws.Scale = CheckScale(sc);
                Prefs.ApplyWidget(a, ws);
                if (a["options"] is JsonObject opts)
                    foreach (var (key, value) in opts) ws.Options[key] = CheckOption(m, key, value);
                else if (a["options"] is not null) throw new CommandException("\"options\" must be an object");
                app.SaveSettings();
                app.SyncWindows();
                if (monitor is not null) app.Window(inst)?.MoveToMonitor(monitor);
                app.Window(inst)?.PushSettings();
                app.SettingsChangedElsewhere();
                return Describe(m, inst);
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
                if (a["checkForUpdates"] is JsonNode cu) g.CheckForUpdates = Bool(cu, "checkForUpdates");
                if (a["hideOnFullscreen"] is JsonNode hf) g.HideOnFullscreen = Bool(hf, "hideOnFullscreen");
                if (a["slowOnEnergySaver"] is JsonNode es) g.SlowOnEnergySaver = Bool(es, "slowOnEnergySaver");
                if (a["peekSeconds"] is JsonNode ps)
                {
                    var secs = Int(ps, "peekSeconds");
                    if (secs is < 1 or > 60) throw new CommandException("peekSeconds must be between 1 and 60");
                    g.PeekSeconds = secs;
                }
                Prefs.ApplyGeneral(a, g);
                if (a["snapEdges"] is JsonNode se) g.SnapEdges = Bool(se, "snapEdges");
                if (a["snapGrid"] is JsonNode sg)
                {
                    var grid = Int(sg, "snapGrid");
                    if (grid is < 0 or > Snap.MaxGrid) throw new CommandException($"snapGrid must be between 0 (off) and {Snap.MaxGrid}");
                    g.SnapGrid = grid;
                }
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

            case "theme":
                if (a["id"] is not null) app.SetTheme(Str(a, "id"));
                return new JsonObject { ["theme"] = app.Settings.General.Theme };

            case "themes":
                return await Themes();

            case "install-theme":
            {
                var id = Str(a, "id");
                var entry = (await Community.FetchThemeCatalogAsync()).FirstOrDefault(t => t?["id"]?.GetValue<string>() == id)
                            ?? throw new CommandException($"'{id}' is not in the theme catalog");
                await Community.InstallThemeAsync(entry);
                if (app.Settings.General.Theme == id) app.SetTheme(id); // re-push the updated colors
                app.SettingsChangedElsewhere();
                return await Themes();
            }

            case "remove-theme":
            {
                var id = Str(a, "id");
                if (id == Theme.DefaultId) throw new CommandException("The default theme is built in");
                if (Theme.DiscoverAll().All(t => t.Id != id)) throw new CommandException($"No installed theme '{id}'");
                Community.RemoveTheme(id);
                if (app.Settings.General.Theme == id) app.SetTheme(Theme.DefaultId);
                app.SettingsChangedElsewhere();
                return await Themes();
            }
            case "check-update":
                await app.Updater.CheckAsync(manual: false);
                return app.Updater.ToJson();

            case "hotkeys":
                if (a["reset"] is JsonNode rs && Bool(rs, "reset")) app.ResetHotkeys();
                else if (a["action"] is not null)
                {
                    try { app.SetHotkey(Str(a, "action"), a["keys"]?.GetValue<string>() ?? ""); }
                    catch (ArgumentException ex) { throw new CommandException(ex.Message); }
                }
                return app.DescribeHotkeys();

            case "peek":
                if (a["seconds"] is JsonNode pk)
                {
                    var secs = Int(pk, "seconds");
                    if (secs is < 1 or > 60) throw new CommandException("seconds must be between 1 and 60");
                    app.Settings.General.PeekSeconds = secs;
                    app.SaveSettings();
                }
                app.Peek();
                return new JsonObject { ["peeking"] = app.Peeking, ["seconds"] = app.Settings.General.PeekSeconds, ["hidden"] = app.WidgetsHidden || app.HiddenByFullscreen };

            case "safe-mode":
                if (a["on"] is JsonNode sm) app.SetSafeMode(Bool(sm, "on"));
                return new JsonObject { ["safeMode"] = app.SafeMode };

            case "layouts":
            {
                var op = a["op"] is null ? "list" : Str(a, "op");
                try
                {
                    switch (op)
                    {
                        case "list": break;
                        case "save": app.SaveLayout(Str(a, "name")); break;
                        case "apply": return new JsonObject { ["applied"] = app.ApplyLayout(Str(a, "name")), ["layouts"] = app.Layouts.ToJson() };
                        case "delete":
                            if (!app.DeleteLayout(Str(a, "name"))) throw new CommandException($"No layout '{Str(a, "name")}'");
                            break;
                        default: throw new CommandException("op must be list, save, apply or delete");
                    }
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException) { throw new CommandException(ex.Message); }
                return new JsonObject { ["layouts"] = app.Layouts.ToJson() };
            }

            case "edit-mode":
                if (a["on"] is JsonNode on) app.SetEditMode(Bool(on, "on"));
                return new JsonObject { ["editMode"] = app.EditMode };

            case "reset-position":
            {
                var (m, inst) = Target(a);
                app.ResetPosition(inst);
                return Describe(m, inst);
            }

            case "refresh":
            {
                // A widget id refreshes all its copies; an instance id ("sp500#2") just that one.
                var which = a["id"] is null ? null : Str(a, "id");
                foreach (var w in app.OpenWindows.Where(w => which is null || w.Instance == which || (!which.Contains('#') && w.Manifest.Id == which)))
                    w.RefreshData();
                return null;
            }

            case "add-instance":
            {
                var (m, _) = Target(a);
                try { return Describe(m, app.AddInstance(m)); }
                catch (InvalidOperationException ex) { throw new CommandException(ex.Message); }
            }

            case "remove-instance":
            {
                var (m, inst) = Target(a);
                if (!InstanceId.IsExtra(inst))
                    throw new CommandException($"'{inst}' is the first copy of '{m.Id}'; disable it instead. Extra copies look like '{m.Id}#2'");
                app.RemoveInstance(inst);
                return null;
            }

            case "reload":
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                return DescribeAll();

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
                    copy["builtin"] = installed?.IsPermanent == true;
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
                if (app.Manifests.Any(m => m.Id == id && m.IsPermanent))
                    throw new CommandException($"'{id}' is built in and always installed");
                var entry = (await Community.FetchCatalogAsync()).FirstOrDefault(w => w?["id"]?.GetValue<string>() == id)
                            ?? throw new CommandException($"'{id}' is not in the community catalog");
                app.CloseWidget(id);
                await Community.InstallAsync(entry);
                app.ReloadWidgets();
                app.SettingsChangedElsewhere();
                return Describe(app.Manifests.First(m => m.Id == id), id);
            }

            case "remove":
            {
                var (m, _) = Target(a);
                if (m.IsPermanent) throw new CommandException($"'{m.Id}' is built in; disable it instead");
                app.CloseWidget(m.Id);
                Community.Remove(m.Id); // folder and the data of every copy
                app.ForgetInstances(m.Id);
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
                var info = Describe(created, created.Id);
                info["path"] = dir;
                return info;
            }

            case "data":
                return Data(Target(a).Instance, a);

            case "approvals":
                // Read-only on purpose: there is no control command that approves or revokes a command.
                return app.Commands.Approvals.Describe(app.Manifests, a["id"] is null ? null : Target(a).Manifest.Id);

            case "privacy":
                return Backup.Privacy(app, a["id"] is null ? null : Target(a).Manifest.Id);

            case "backup":
            {
                var path = Path.GetFullPath(Str(a, "path"));
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, Backup.Create(app.Settings).ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
                return new JsonObject { ["path"] = path, ["bytes"] = new FileInfo(path).Length };
            }

            case "restore":
            {
                Backup.Parsed parsed;
                try { parsed = Backup.ReadFile(Path.GetFullPath(Str(a, "path"))); }
                catch (InvalidDataException ex) { throw new CommandException(ex.Message); }
                app.RestoreBackup(parsed);
                return new JsonObject { ["widgets"] = parsed.Settings.Widgets.Count, ["data"] = parsed.Data.Count, ["note"] = "Command approvals are not part of a backup; approve again if needed" };
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

    /// <summary>Reads or changes a widget's umbra.store data; an open widget is told about changes so it can re-render.</summary>
    JsonNode? Data(string inst, JsonObject a)
    {
        var op = a["op"] is null ? "get" : Str(a, "op");
        var key = a["key"] is null ? null : Str(a, "key");
        try
        {
            switch (op)
            {
                case "get" when key is null:
                    return WidgetStore.All(inst);
                case "get":
                    var (found, value) = WidgetStore.Get(inst, key);
                    return found ? value : throw new CommandException($"'{inst}' has no stored key '{key}'. Keys: {string.Join(", ", WidgetStore.Keys(inst))}");
                case "set":
                    if (key is null) throw new CommandException("\"key\" is required for set");
                    if (!a.ContainsKey("value")) throw new CommandException("\"value\" is required for set");
                    WidgetStore.Set(inst, key, a["value"]);
                    break;
                case "remove":
                    if (key is null) throw new CommandException("\"key\" is required for remove");
                    if (!WidgetStore.Remove(inst, key)) throw new CommandException($"'{inst}' has no stored key '{key}'");
                    break;
                case "clear":
                    WidgetStore.Delete(inst);
                    break;
                default:
                    throw new CommandException("\"op\" must be get, set, remove or clear");
            }
        }
        catch (InvalidOperationException ex) { throw new CommandException(ex.Message); }
        app.Window(inst)?.StoreChanged(op == "clear" ? null : key);
        return WidgetStore.All(inst);
    }

    /// <summary>target = widget id, or settings:&lt;page&gt;. Writes to path when given, otherwise returns base64.</summary>
    async Task<JsonNode> Capture(string target, string? path)
    {
        byte[] png;
        if (target.StartsWith("settings", StringComparison.OrdinalIgnoreCase))
        {
            var page = target.Contains(':') ? target[(target.IndexOf(':') + 1)..] : "general";
            var wasOpen = app.SettingsOpen;
            var win = app.ShowSettings(background: true);
            try { png = await win.CaptureAsync(page); }
            finally { if (!wasOpen) win.Close(); }
        }
        else
        {
            var (_, inst) = app.Resolve(target)
                    ?? throw new CommandException($"No widget '{target}'. Targets: {string.Join(", ", app.Manifests.SelectMany(x => app.Settings.Instances(x.Id)))}, settings:<page>");
            var win = app.Window(inst) ?? throw new CommandException($"'{inst}' is not open; enable it first (configure enabled=true)");
            png = await win.CaptureAsync();
        }

        if (string.IsNullOrEmpty(path))
            return new JsonObject { ["mimeType"] = "image/png", ["bytes"] = png.Length, ["base64"] = Convert.ToBase64String(png) };
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, png);
        return new JsonObject { ["path"] = full, ["bytes"] = png.Length };
    }

    /// <summary>Installed themes and the community catalog merged by id; a failed catalog fetch only sets "catalogError".</summary>
    async Task<JsonObject> Themes()
    {
        JsonArray? catalog = null;
        string? error = null;
        try { catalog = await Community.FetchThemeCatalogAsync(); }
        catch (Exception ex) { error = ex.Message; Log.Write($"Theme catalog fetch failed: {ex.Message}"); }
        return new JsonObject { ["active"] = app.Settings.General.Theme, ["themes"] = Theme.Listing(catalog), ["catalogError"] = error };
    }

    JsonArray DescribeAll() => new(app.Manifests
        .SelectMany(m => app.Settings.Instances(m.Id).Select(inst => (JsonNode?)Describe(m, inst))).ToArray());

    /// <summary>One copy of a widget. "id" is the instance id; "widget" the manifest id (same for the first copy).</summary>
    JsonObject Describe(WidgetManifest m, string inst)
    {
        var ws = app.Settings.For(m, inst);
        var win = app.Window(inst);
        return new JsonObject
        {
            ["id"] = inst,
            ["widget"] = m.Id,
            ["instance"] = InstanceId.NumberOf(inst),
            ["name"] = App.InstanceLabel(m, inst),
            ["description"] = m.Description,
            ["author"] = m.Author,
            ["version"] = m.Version,
            ["source"] = m.IsPermanent ? "builtin" : "community",
            ["folder"] = Path.Combine(m.Source == WidgetSource.BuiltIn ? AppPaths.WidgetsDir : AppPaths.CommunityDir, m.Folder),
            ["enabled"] = ws.Enabled,
            ["locked"] = ws.Locked,
            ["monitor"] = ws.Monitor,
            ["scale"] = ws.Scale,
            ["refreshSeconds"] = ws.RefreshSeconds,
            ["opacity"] = ws.Opacity,
            ["startHidden"] = ws.StartHidden,
            ["showWhen"] = ws.ShowWhen is { } sw ? new JsonObject { ["from"] = sw.From, ["to"] = sw.To, ["onAc"] = sw.OnAc, ["monitor"] = sw.Monitor } : null,
            ["open"] = win is not null,
            ["bounds"] = win is null ? null : new JsonObject { ["x"] = win.Left, ["y"] = win.Top, ["width"] = win.Width, ["height"] = win.Height },
            ["hosts"] = new JsonArray(m.Permissions.Hosts.Select(h => (JsonNode?)h).ToArray()),
            ["commands"] = app.Commands.Approvals.Describe(new[] { m }),
            ["options"] = ws.Options.DeepClone(),
            ["optionSchema"] = m.Options.DeepClone(),
        };
    }

    internal static JsonArray MonitorList()
    {
        var all = Placement.Monitors();
        return new JsonArray(all.Select((m, i) => (JsonNode?)new JsonObject
        {
            ["number"] = i + 1, ["name"] = m.Name, ["primary"] = m.Primary,
            ["x"] = m.Bounds.X, ["y"] = m.Bounds.Y, ["width"] = m.Bounds.Width, ["height"] = m.Bounds.Height,
        }).ToArray());
    }

    /// <summary>Accepts a device name, a 1-based number from status.monitors, or "primary".</summary>
    internal static string ResolveMonitor(string input)
    {
        var all = Placement.Monitors();
        if (input.Equals("primary", StringComparison.OrdinalIgnoreCase) && all.Any(m => m.Primary)) return all.First(m => m.Primary).Name;
        if (int.TryParse(input, out var n) && n >= 1 && n <= all.Count) return all[n - 1].Name;
        if (Placement.Has(all, input)) return all.First(m => string.Equals(m.Name, input, StringComparison.OrdinalIgnoreCase)).Name;
        throw new CommandException($"No monitor '{input}'. Connected: {string.Join(", ", all.Select((m, i) => $"{i + 1} = {m.Name}"))}");
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

    /// <summary>A widget scale from the protocol: a number from 0.5 to 3 (out-of-range values are an error, not clamped).</summary>
    internal static double CheckScale(JsonNode? n) =>
        n?.GetValueKind() == JsonValueKind.Number && n.GetValue<double>() is var s && s >= WidgetSettings.MinScale && s <= WidgetSettings.MaxScale
            ? WidgetSettings.ClampScale(s)
            // Invariant: umbractl only parses "0.5", so the message must not say "0,5" on a German PC.
            : throw new CommandException(string.Create(CultureInfo.InvariantCulture,
                $"\"scale\" must be a number from {WidgetSettings.MinScale} to {WidgetSettings.MaxScale} (1 = 100 %)"));

    /// <summary>The widget copy an "id" argument names: a widget id (first copy) or an instance id like "sp500#2".</summary>
    (WidgetManifest Manifest, string Instance) Target(JsonObject a)
    {
        var id = Str(a, "id");
        return app.Resolve(id)
               ?? throw new CommandException($"No widget '{id}'. Installed: {string.Join(", ", app.Manifests.SelectMany(m => app.Settings.Instances(m.Id)))}");
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
