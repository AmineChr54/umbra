namespace Umbra;

/// <summary>Owns the settings, the widget windows, the tray icon and the Settings window.</summary>
sealed class App : ApplicationContext
{
    public static readonly Icon AppIcon = LoadIcon();

    readonly Dictionary<string, WidgetWindow> _windows = new();
    readonly NotifyIcon _tray;
    readonly SynchronizationContext _ui;
    SettingsWindow? _settingsWindow;

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
        menu.Items.Add("Settings...", null, (_, _) => ShowSettings()).Font = new Font(menu.Font, FontStyle.Bold);
        var edit = new ToolStripMenuItem("Edit mode (move and resize)") { Checked = EditMode };
        edit.Click += (_, _) => SetEditMode(!EditMode);
        menu.Items.Add(edit);
        menu.Items.Add(new ToolStripSeparator());
        foreach (var m in Manifests)
        {
            var ws = Settings.For(m);
            var item = new ToolStripMenuItem(m.Name) { Checked = ws.Enabled, CheckOnClick = true };
            item.Click += (_, _) => { ws.Enabled = item.Checked; SaveSettings(); SyncWindows(); };
            menu.Items.Add(item);
        }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Refresh all", null, (_, _) => { foreach (var w in _windows.Values) w.RefreshData(); });
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
    }

    /// <summary>Opens a window for each enabled widget and closes the ones that were disabled.</summary>
    public void SyncWindows()
    {
        foreach (var m in Manifests)
        {
            var enabled = Settings.For(m).Enabled;
            var open = _windows.TryGetValue(m.Id, out var win);
            if (enabled && !open)
            {
                win = new WidgetWindow(this, m);
                win.FormClosed += (_, _) => _windows.Remove(m.Id);
                _windows[m.Id] = win;
                win.Show();
            }
            else if (!enabled && open)
            {
                win!.Close();
            }
        }
    }

    public void CloseWidget(string id)
    {
        if (_windows.TryGetValue(id, out var w)) { w.Close(); _windows.Remove(id); }
    }

    /// <summary>Re-scans widget folders after an install/remove and opens/closes windows to match.</summary>
    public void ReloadWidgets()
    {
        Manifests = WidgetManifest.DiscoverAll();
        foreach (var id in _windows.Keys.Where(id => Manifests.All(m => m.Id != id)).ToList())
            CloseWidget(id);
        SaveSettings();
        SyncWindows();
        BuildTrayMenu();
    }

    public void ApplySettings(Settings incoming)
    {
        // Positions are owned by the widget windows (dragging), so keep the current ones.
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
