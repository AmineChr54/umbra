using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Umbra;

/// <summary>The Settings panel: a dark window hosting settings/index.html.</summary>
sealed class SettingsWindow : Form
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly Color Surface = Color.FromArgb(0, 0, 0);

    readonly App _app;
    readonly WebView2 _view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Surface };
    JsonArray _catalog = new();
    readonly Dictionary<string, string?> _previewCache = new();
    readonly TaskCompletionSource _loaded = new(TaskCreationOptions.RunContinuationsAsynchronously);
    TaskCompletionSource _catalogSent = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public static readonly string[] Pages = { "general", "widgets", "browse", "themes", "hotkeys", "about" };

    readonly bool _background;

    /// <summary>Background windows (used for captures) are shown off-screen, outside the taskbar, without taking focus.</summary>
    protected override bool ShowWithoutActivation => _background;

    public SettingsWindow(App app, bool background = false)
    {
        _app = app;
        _background = background;
        Text = "Umbra";
        Icon = App.AppIcon;
        BackColor = Surface;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        Controls.Add(_view);
        ApplyDpiSize();
        if (background)
        {
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
        }
    }

    /// <summary>Sizes are in logical (96-DPI) pixels; scale them to the monitor the window is on.</summary>
    void ApplyDpiSize()
    {
        float s = DeviceDpi / 96f;
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        MinimumSize = new Size((int)(760 * s), (int)(520 * s));
        ClientSize = new Size(Math.Min((int)(1000 * s), wa.Width - 40), Math.Min((int)(700 * s), wa.Height - 40));
        CenterToScreen();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.SetDwm(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
        Native.SetDwm(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, Native.DWMWCP_ROUND);
        Native.SetDwm(Handle, Native.DWMWA_BORDER_COLOR, Native.ColorRef(30, 31, 36));
        Native.SetDwm(Handle, Native.DWMWA_CAPTION_COLOR, Native.ColorRef(0, 0, 0));
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await WebHost.InitAsync(_view);
            _view.CoreWebView2.WebMessageReceived += OnMessage;
            _view.CoreWebView2.Navigate(WebHost.Url("settings/index.html"));
        }
        catch (Exception ex)
        {
            Log.Write($"Settings WebView2 init failed: {ex}");
        }
    }

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(e.WebMessageAsJson); } catch { return; }
        var id = msg?["id"]?.GetValue<string>() ?? "";

        switch (msg?["type"]?.GetValue<string>())
        {
            case "load":
                SendState();
                _loaded.TrySetResult();
                break;

            case "save":
                if (msg["settings"] is JsonNode s) { _app.ApplySettings(Settings.FromJson(s)); SendState(); }
                break;

            case "setStartup":
                Startup.Set(msg["value"]?.GetValue<bool>() == true);
                SendState();
                break;

            case "setEditMode":
                _app.SetEditMode(msg["value"]?.GetValue<bool>() == true); // re-sends the state
                break;

            case "setHotkey":
                try { _app.SetHotkey(msg["action"]?.GetValue<string>() ?? "", msg["keys"]?.GetValue<string>() ?? ""); }
                catch (ArgumentException ex) { Post(new JsonObject { ["type"] = "commandError", ["error"] = ex.Message }); }
                SendState();
                break;

            case "resetHotkeys":
                _app.ResetHotkeys();
                SendState();
                break;

            case "setMonitor":
                if (msg["monitor"]?.GetValue<string>() is string mon && Placement.Has(Placement.Monitors(), mon))
                    _app.Window(id)?.MoveToMonitor(mon);
                SendState();
                break;

            case "resetPosition":
                _app.ResetPosition(id);
                SendState();
                break;

            case "approveCommand":
            case "revokeCommand":
            {
                // The only places a command gets approved are this button (shown with the exact command line) and the run-time prompt.
                var widget = _app.Manifests.FirstOrDefault(w => w.Id == (msg["widget"]?.GetValue<string>() ?? ""));
                var cmdId = msg["command"]?.GetValue<string>() ?? "";
                try
                {
                    if (widget is null) throw new WidgetCommandException("Unknown widget");
                    if (msg["type"]?.GetValue<string>() == "approveCommand")
                        _app.Commands.ApproveFromSettings(widget, cmdId, msg["hash"]?.GetValue<string>() ?? "");
                    else
                        _app.Commands.Approvals.Revoke(widget.Id, cmdId);
                }
                catch (WidgetCommandException ex) { Post(new JsonObject { ["type"] = "commandError", ["error"] = ex.Message }); }
                SendState();
                break;
            }
            case "addInstance":
                if (_app.Manifests.FirstOrDefault(m => m.Id == id) is { } wm)
                {
                    try { _app.AddInstance(wm); }
                    catch (InvalidOperationException ex) { Log.Write($"Add copy of {id} failed: {ex.Message}"); }
                }
                SendState();
                break;

            case "removeInstance":
                try { _app.RemoveInstance(id); }
                catch (InvalidOperationException ex) { Log.Write($"Remove copy {id} failed: {ex.Message}"); }
                SendState();
                break;

            case "checkUpdate":
                await _app.Updater.CheckAsync(manual: true); // re-sends the state
                break;

            case "installUpdate":
                try { await _app.Updater.InstallAsync(); }
                catch (Exception ex)
                {
                    Log.Write($"Update failed: {ex.Message}");
                    Post(new JsonObject { ["type"] = "updateError", ["error"] = ex.Message });
                }
                break;

            case "openUrl":
                WebHost.OpenExternal(msg["url"]?.GetValue<string>() ?? "");
                break;

            case "openFolder":
                System.Diagnostics.Process.Start("explorer.exe", AppPaths.CommunityDir);
                break;

            case "catalog":
                await SendCatalog();
                break;

            case "themes":
                await SendThemes();
                break;

            case "setTheme":
                try { _app.SetTheme(id); } catch (InvalidOperationException ex) { Log.Write(ex.Message); }
                await SendThemes(refetch: false);
                break;

            case "installTheme":
                await ThemeJob(id, async () =>
                {
                    var entry = _themeCatalog.FirstOrDefault(t => t?["id"]?.GetValue<string>() == id)
                                ?? throw new InvalidOperationException("Theme not in catalog");
                    await Community.InstallThemeAsync(entry);
                    if (_app.Settings.General.Theme == id) _app.SetTheme(id);
                });
                break;

            case "removeTheme":
                await ThemeJob(id, () =>
                {
                    Community.RemoveTheme(id);
                    if (_app.Settings.General.Theme == id) _app.SetTheme(Theme.DefaultId);
                    return Task.CompletedTask;
                });
                break;

            case "install":
                await RunJob(id, async () =>
                {
                    var entry = _catalog.FirstOrDefault(w => w?["id"]?.GetValue<string>() == id)
                                ?? throw new InvalidOperationException("Widget not in catalog");
                    _app.CloseWidget(id);
                    await Community.InstallAsync(entry);
                });
                break;

            case "remove":
                await RunJob(id, () =>
                {
                    _app.CloseWidget(id); // every copy
                    Community.Remove(id); // folder and the data of every copy
                    _app.ForgetInstances(id);
                    return Task.CompletedTask;
                });
                break;
        }
    }

    async Task RunJob(string id, Func<Task> job)
    {
        string? error = null;
        try { await job(); }
        catch (Exception ex) { error = ex.Message; Log.Write($"Widget job {id} failed: {ex}"); }
        _app.ReloadWidgets();
        Post(new JsonObject { ["type"] = "jobDone", ["id"] = id, ["error"] = error });
        SendState();
        await SendCatalog(refetch: false);
    }

    JsonArray _themeCatalog = new();
    bool _themeCatalogLoaded;
    TaskCompletionSource _themesSent = new(TaskCreationOptions.RunContinuationsAsynchronously);

    async Task ThemeJob(string id, Func<Task> job)
    {
        string? error = null;
        try { await job(); }
        catch (Exception ex) { error = ex.Message; Log.Write($"Theme job {id} failed: {ex}"); }
        Post(new JsonObject { ["type"] = "jobDone", ["id"] = id, ["error"] = error });
        SendState();
        await SendThemes(refetch: false);
    }

    /// <summary>Sends installed + catalog themes (the catalog is fetched once per visit unless refetch).</summary>
    async Task SendThemes(bool refetch = true)
    {
        string? error = null;
        if (refetch || !_themeCatalogLoaded)
        {
            try { _themeCatalog = await Community.FetchThemeCatalogAsync(); _themeCatalogLoaded = true; }
            catch (Exception ex) { error = ex.Message; Log.Write($"Theme catalog fetch failed: {ex.Message}"); }
        }
        Post(new JsonObject { ["type"] = "themes", ["error"] = error, ["themes"] = Theme.Listing(_themeCatalog) });
        _themesSent.TrySetResult();
    }

    void SendState()
    {
        var widgets = new JsonArray();
        foreach (var m in _app.Manifests)
        foreach (var inst in _app.Settings.Instances(m.Id))
        {
            _app.Settings.For(m, inst); // ensure defaults exist
            widgets.Add(new JsonObject
            {
                ["id"] = inst,
                ["widget"] = m.Id,
                ["instance"] = InstanceId.NumberOf(inst),
                ["name"] = App.InstanceLabel(m, inst),
                ["monitor"] = _app.Settings.Widgets[inst].Monitor,
                ["description"] = m.Description,
                ["author"] = m.Author,
                ["version"] = m.Version,
                ["source"] = m.Source == WidgetSource.BuiltIn ? "builtin" : "community",
                ["preview"] = m.Preview is null ? null
                    : m.Source == WidgetSource.BuiltIn ? WebHost.Url($"widgets/{m.Folder}/{m.Preview}")
                    : WebHost.CommunityUrl($"{m.Folder}/{m.Preview}"),
                ["hosts"] = new JsonArray(m.Permissions.Hosts.Select(h => (JsonNode?)h).ToArray()),
                ["notifications"] = m.Permissions.Notifications,
                ["media"] = new JsonArray(m.Permissions.Media.Select(h => (JsonNode?)h).ToArray()),
                ["system"] = new JsonArray(m.Permissions.System.Select(h => (JsonNode?)h).ToArray()),
                ["commands"] = new JsonArray(m.Permissions.Commands.Select(c => (JsonNode?)new JsonObject
                {
                    ["id"] = c.Id,
                    ["line"] = c.DisplayLine(),
                    ["description"] = c.Description,
                    ["hash"] = c.Hash(),
                    ["status"] = _app.Commands.Approvals.Status(m.Id, c),
                }).ToArray()),
                ["options"] = m.Options.DeepClone(),
                ["optionOrder"] = new JsonArray(m.OptionOrder.Select(k => (JsonNode?)k).ToArray()),
            });
        }

        Post(new JsonObject
        {
            ["type"] = "state",
            ["version"] = Application.ProductVersion.Split('+')[0],
            ["startup"] = Startup.IsEnabled(),
            ["editMode"] = _app.EditMode,
            ["update"] = _app.Updater.ToJson(),
            ["repo"] = $"https://github.com/{Community.Repo}",
            ["settings"] = _app.Settings.ToJson(),
            ["themeCss"] = _app.ThemeCss,
            ["hotkeys"] = _app.DescribeHotkeys()["hotkeys"]!.DeepClone(),
            ["monitors"] = new JsonArray(Placement.Monitors().Select((m, i) => (JsonNode?)new JsonObject { ["name"] = m.Name, ["label"] = $"Monitor {i + 1}{(m.Primary ? " (primary)" : "")} - {m.Bounds.Width}x{m.Bounds.Height}" }).ToArray()),
            ["widgets"] = widgets,
        });
    }

    async Task SendCatalog(bool refetch = true)
    {
        string? error = null;
        if (refetch || _catalog.Count == 0)
        {
            try { _catalog = await Community.FetchCatalogAsync(); }
            catch (Exception ex) { error = ex.Message; Log.Write($"Catalog fetch failed: {ex.Message}"); }
        }

        var previews = await Task.WhenAll(_catalog.Select(async entry =>
        {
            var wid = entry?["id"]?.GetValue<string>() ?? "";
            if (entry?["preview"]?.GetValue<string>() is not string p) return (wid, (string?)null);
            if (!_previewCache.TryGetValue($"{wid}/{p}", out var url))
                _previewCache[$"{wid}/{p}"] = url = await Community.PreviewDataUrlAsync(wid, p);
            return (wid, url);
        }));

        var list = new JsonArray();
        foreach (var entry in _catalog)
        {
            if (entry is null) continue;
            var copy = entry.DeepClone().AsObject();
            var wid = copy["id"]?.GetValue<string>() ?? "";
            var installed = _app.Manifests.FirstOrDefault(m => m.Id == wid);
            copy["installed"] = installed is not null;
            copy["builtin"] = installed?.Source == WidgetSource.BuiltIn;
            copy["installedVersion"] = installed?.Version;
            copy["updateAvailable"] = installed is { Source: WidgetSource.Community }
                && Community.CompareVersions(copy["version"]?.GetValue<string>() ?? "0", installed.Version) > 0;
            copy["previewUrl"] = previews.FirstOrDefault(x => x.wid == wid).Item2;
            list.Add(copy);
        }
        Post(new JsonObject { ["type"] = "catalog", ["error"] = error, ["widgets"] = list });
        _catalogSent.TrySetResult();
    }

    /// <summary>Re-sends the state after something changed outside this window (tray menu, umbractl).</summary>
    public void RefreshState()
    {
        if (!_loaded.Task.IsCompleted) return;
        SendState();
        if (_themeCatalogLoaded) _ = SendThemes(refetch: false);
        if (_catalog.Count > 0) _ = SendCatalog(refetch: false);
    }

    /// <summary>Switches the panel to one of <see cref="Pages"/> (the page's own show() function).</summary>
    public async Task ShowPageAsync(string page)
    {
        if (!Pages.Contains(page)) throw new ArgumentException($"Unknown Settings page '{page}'. Pages: {string.Join(", ", Pages)}");
        await _loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
        if (page == "browse") _catalogSent = new(TaskCreationOptions.RunContinuationsAsynchronously);
        if (page == "themes") _themesSent = new(TaskCreationOptions.RunContinuationsAsynchronously);
        await _view.CoreWebView2.ExecuteScriptAsync($"show('{page}')");
    }

    /// <summary>A pixel-exact PNG of one Settings page (only this window's web content, never the screen).</summary>
    public async Task<byte[]> CaptureAsync(string page)
    {
        await ShowPageAsync(page);
        if (page == "browse")
            await Task.WhenAny(_catalogSent.Task, Task.Delay(TimeSpan.FromSeconds(25)));
        if (page == "themes")
            await Task.WhenAny(_themesSent.Task, Task.Delay(TimeSpan.FromSeconds(25)));
        await Task.Delay(page == "browse" ? 1200 : 500); // images decode, transitions settle
        using var ms = new MemoryStream();
        await _view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, ms);
        return ms.ToArray();
    }

    void Post(JsonNode node)
    {
        if (IsDisposed || _view.CoreWebView2 is null) return;
        _view.CoreWebView2.PostWebMessageAsJson(node.ToJsonString(Json));
    }
}
