namespace Umbra;

/// <summary>Owns the settings, the widget windows, the tray icon and the Settings window.</summary>
sealed class App : ApplicationContext
{
    public static readonly Icon AppIcon = LoadIcon();

    readonly Dictionary<string, WidgetWindow> _windows = new();
    readonly NotifyIcon _tray;
    readonly SynchronizationContext _ui;
    SettingsWindow? _settingsWindow;
    public UpdateService Updater { get; }

    public Settings Settings { get; private set; }
    public List<WidgetManifest> Manifests { get; private set; }

    /// <summary>
    /// App-wide "arranging" state: unlocked widgets show an outline and a corner handle and can be zoomed.
    /// Deliberately not saved, so widgets always start in their normal, untouchable state.
    /// </summary>
    public bool EditMode { get; private set; }

    public App(bool openSettings)
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        Settings = Settings.Load();
        Manifests = WidgetManifest.DiscoverAll();
        Log.Write($"Umbra started, {Manifests.Count} widget(s) found");

        Updater = new UpdateService(this);
        _tray = new NotifyIcon { Icon = AppIcon, Text = "Umbra", Visible = true };
        _tray.DoubleClick += (_, _) => ShowSettings();
        _tray.ContextMenuStrip = new ContextMenuStrip();
        _tray.ContextMenuStrip.Opening += (_, _) => BuildTrayMenu();
        BuildTrayMenu();

        SyncWindows();
        if (openSettings) ShowSettings();
    }

    /// <summary>Runs work on the UI thread (pipe requests arrive on worker threads) and returns its result.</summary>
    public Task<T> OnUi<T>(Func<Task<T>> work)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ui.Post(async _ =>
        {
            try { tcs.SetResult(await work()); }
            catch (Exception ex) { tcs.SetException(ex); }
        }, null);
        return tcs.Task;
    }

    public WidgetWindow? Window(string id) => _windows.GetValueOrDefault(id);

    public IEnumerable<WidgetWindow> OpenWindows => _windows.Values;

    /// <summary>Tells an open Settings window to re-render after a change made elsewhere (tray, umbractl).</summary>
    public void SettingsChangedElsewhere()
    {
        if (_settingsWindow is { IsDisposed: false }) _settingsWindow.RefreshState();
        BuildTrayMenu();
    }

    /// <summary>Exits shortly after the current pipe reply has been written.</summary>
    public void QuitSoon() => _ = Task.Delay(300).ContinueWith(_ => _ui.Post(_ => ExitThread(), null));

    void BuildTrayMenu()
    {
        var menu = _tray.ContextMenuStrip!;
        menu.Items.Clear();
        if (Updater.Available is { } up)
        {
            menu.Items.Add($"Update to v{up.Version} available", null, async (_, _) =>
            {
                try { await Updater.InstallAsync(); }
                catch (Exception ex)
                {
                    Log.Write($"Update failed: {ex.Message}");
                    _tray.ShowBalloonTip(4000, "Umbra", $"Update failed: {ex.Message}", ToolTipIcon.Error);
                }
            }).Font = new Font(menu.Font, FontStyle.Bold);
            menu.Items.Add(new ToolStripSeparator());
        }
        menu.Items.Add("Settings...", null, (_, _) => ShowSettings()).Font = new Font(menu.Font, FontStyle.Bold);
        var edit = new ToolStripMenuItem("Edit mode (move and resize)") { Checked = EditMode };
        edit.Click += (_, _) => SetEditMode(!EditMode);
        menu.Items.Add(edit);
        menu.Items.Add(new ToolStripSeparator());
        foreach (var m in Manifests)
            foreach (var inst in Settings.Instances(m.Id))
            {
                var ws = Settings.For(m, inst);
                var item = new ToolStripMenuItem(InstanceLabel(m, inst)) { Checked = ws.Enabled, CheckOnClick = true };
                item.Click += (_, _) => { ws.Enabled = item.Checked; SaveSettings(); SyncWindows(); };
                menu.Items.Add(item);
            }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Refresh all", null, (_, _) => { foreach (var w in _windows.Values) w.RefreshData(); });
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
    }

    /// <summary>"Name" for the first copy of a widget, "Name (2)" for the others.</summary>
    public static string InstanceLabel(WidgetManifest m, string instance) =>
        InstanceId.IsExtra(instance) ? $"{m.Name} ({InstanceId.NumberOf(instance)})" : m.Name;

    /// <summary>The manifest and instance id for a widget id or an instance id ("sp500#2"), or null when unknown.</summary>
    public (WidgetManifest Manifest, string Instance)? Resolve(string id)
    {
        if (!InstanceId.IsValid(id)) return null;
        var m = Manifests.FirstOrDefault(x => x.Id == InstanceId.WidgetOf(id));
        if (m is null) return null;
        return Settings.Instances(m.Id).Contains(id) ? (m, id) : null;
    }

    /// <summary>Opens a window for each enabled widget copy and closes the ones that were disabled or removed.</summary>
    public void SyncWindows()
    {
        foreach (var m in Manifests)
            foreach (var inst in Settings.Instances(m.Id))
            {
                var enabled = Settings.For(m, inst).Enabled;
                var open = _windows.TryGetValue(inst, out var win);
                if (enabled && !open)
                {
                    win = new WidgetWindow(this, m, inst);
                    win.FormClosed += (_, _) => _windows.Remove(inst);
                    _windows[inst] = win;
                    win.Show();
                }
                else if (!enabled && open)
                {
                    win!.Close();
                }
            }
        var live = Manifests.SelectMany(m => Settings.Instances(m.Id)).ToHashSet();
        foreach (var inst in _windows.Keys.Where(k => !live.Contains(k)).ToList()) CloseWidget(inst);
    }

    /// <summary>Closes one copy (an instance id), or every copy of a widget (its plain id).</summary>
    public void CloseWidget(string id)
    {
        foreach (var key in _windows.Keys.Where(k => k == id || (!id.Contains('#') && InstanceId.WidgetOf(k) == id)).ToList())
        {
            _windows[key].Close();
            _windows.Remove(key);
        }
    }

    /// <summary>Adds another copy of a widget (new position next to the first one) and returns its instance id.</summary>
    public string AddInstance(WidgetManifest m)
    {
        var inst = Settings.AddInstance(m) ?? throw new InvalidOperationException($"A widget can have at most {InstanceId.MaxInstances} copies");
        if (Window(m.Id) is { } first)
        {
            var offset = (int)(32 * first.DeviceDpi / 96.0);
            var ws = Settings.For(m, inst);
            ws.X = first.Left + offset * (InstanceId.NumberOf(inst) - 1);
            ws.Y = first.Top + offset * (InstanceId.NumberOf(inst) - 1);
        }
        SaveSettings();
        SyncWindows();
        SettingsChangedElsewhere();
        return inst;
    }

    /// <summary>Removes an extra copy with its settings and stored data. The first copy can only be disabled.</summary>
    public void RemoveInstance(string instance)
    {
        if (!InstanceId.IsExtra(instance) || !Settings.Widgets.ContainsKey(instance))
            throw new InvalidOperationException($"'{instance}' is not an extra copy of a widget");
        CloseWidget(instance);
        Settings.Widgets.Remove(instance);
        WidgetStore.Delete(instance);
        SaveSettings();
        SettingsChangedElsewhere();
    }

    /// <summary>Forgets all extra copies of an uninstalled widget (settings; the data files go with the widget).</summary>
    public void ForgetInstances(string widgetId)
    {
        Settings.RemoveExtraInstances(widgetId);
        SaveSettings();
    }

    /// <summary>
    /// Extra copies of a widget whose folder vanished (deleted outside Umbra) are forgotten with their data.
    /// A missing first copy keeps its settings, as before.
    /// </summary>
    void ForgetOrphans()
    {
        foreach (var key in Settings.Widgets.Keys.Where(k => InstanceId.IsExtra(k) && Manifests.All(m => m.Id != InstanceId.WidgetOf(k))).ToList())
        {
            CloseWidget(key);
            Settings.Widgets.Remove(key);
        }
        foreach (var inst in WidgetStore.CopyIds().Where(i => Manifests.All(m => m.Id != InstanceId.WidgetOf(i))))
            WidgetStore.Delete(inst);
    }

    /// <summary>Re-scans widget folders after an install/remove and opens/closes windows to match.</summary>
    public void ReloadWidgets()
    {
        Manifests = WidgetManifest.DiscoverAll();
        ForgetOrphans();
        foreach (var id in _windows.Keys.Where(id => Manifests.All(m => m.Id != InstanceId.WidgetOf(id))).ToList())
            CloseWidget(id);
        SaveSettings();
        SyncWindows();
        BuildTrayMenu();
    }

    public void ApplySettings(Settings incoming)
    {
        // Positions are owned by the widget windows (dragging), so keep the current ones.
        // Copies are only added and removed through AddInstance/RemoveInstance, never by a (possibly stale) save.
        foreach (var id in incoming.Widgets.Keys.Where(k => InstanceId.IsExtra(k) && !Settings.Widgets.ContainsKey(k)).ToList())
            incoming.Widgets.Remove(id);
        foreach (var (id, cur) in Settings.Widgets)
            if (!incoming.Widgets.ContainsKey(id) && InstanceId.IsExtra(id)) incoming.Widgets[id] = cur;
        foreach (var (id, ws) in incoming.Widgets)
            if (Settings.Widgets.TryGetValue(id, out var cur)) { ws.X = cur.X; ws.Y = cur.Y; }
        Settings = incoming;
        SaveSettings();
        SyncWindows();
        foreach (var w in _windows.Values) w.PushSettings();
    }

    /// <summary>Turns edit mode on or off for every widget and updates the tray and Settings window.</summary>
    public void SetEditMode(bool on)
    {
        if (EditMode == on) return;
        EditMode = on;
        Log.Write($"Edit mode {(on ? "on" : "off")}");
        foreach (var w in _windows.Values) w.PushSettings();
        SettingsChangedElsewhere();
    }

    public void ResetPosition(string id)
    {
        if (_windows.TryGetValue(id, out var w)) w.ResetPosition();
        else if (Settings.Widgets.TryGetValue(id, out var ws)) { ws.X = ws.Y = null; SaveSettings(); }
    }

    public void SaveSettings() => Settings.Save();

    /// <summary>Generated :root override of the active theme (empty for the default look).</summary>
    public string ThemeCss => Theme.CssFor(Settings.General.Theme);

    /// <summary>Switches the theme live: widgets and Settings re-apply it at once. Unknown ids are an error.</summary>
    public void SetTheme(string id)
    {
        if (Theme.DiscoverAll().All(t => t.Id != id)) throw new InvalidOperationException($"No installed theme '{id}'");
        Settings.General.Theme = id;
        SaveSettings();
        foreach (var w in _windows.Values) w.PushSettings();
        SettingsChangedElsewhere();
    }

    public SettingsWindow ShowSettings()
    {
        if (_settingsWindow is { IsDisposed: false })
        {
            if (_settingsWindow.WindowState == FormWindowState.Minimized) _settingsWindow.WindowState = FormWindowState.Normal;
            _settingsWindow.Activate();
            return _settingsWindow;
        }
        _settingsWindow = new SettingsWindow(this);
        _settingsWindow.Show();
        _settingsWindow.Activate();
        return _settingsWindow;
    }

    public bool SettingsOpen => _settingsWindow is { IsDisposed: false };

    protected override void ExitThreadCore()
    {
        _tray.Visible = false;
        _tray.Dispose();
        Updater.Dispose();
        foreach (var w in _windows.Values.ToList()) w.Close();
        _settingsWindow?.Close();
        base.ExitThreadCore();
    }

    static Icon LoadIcon()
    {
        using var s = typeof(App).Assembly.GetManifestResourceStream("umbra.ico");
        return s is null ? SystemIcons.Application : new Icon(s);
    }
}
