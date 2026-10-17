namespace Umbra;

/// <summary>Owns the settings, the widget windows, the tray icon and the Settings window.</summary>
sealed class App : ApplicationContext
{
    public static readonly Icon AppIcon = LoadIcon();

    readonly Dictionary<string, WidgetWindow> _windows = new();
    readonly NotifyIcon _tray;
    readonly Notifier _notifier = new();
    string? _balloonUrl;
    Action? _balloonAction; // what a click on the current balloon does instead of opening _balloonUrl
    readonly SynchronizationContext _ui;
    SettingsWindow? _settingsWindow;
    public UpdateService Updater { get; }

    /// <summary>Runs widget-declared local commands behind the approval gate.</summary>
    public CommandService Commands { get; } = new(CommandApprovals.Shared, req => Task.FromResult(ApprovalDialog.Ask(req)));

    public Settings Settings { get; private set; }
    public List<WidgetManifest> Manifests { get; private set; }

    /// <summary>
    /// App-wide "arranging" state: unlocked widgets show an outline and a corner handle and can be zoomed.
    /// Deliberately not saved, so widgets always start in their normal, untouchable state.
    /// </summary>
    public bool EditMode { get; private set; }

    /// <summary>The widget copy last pressed in edit mode: the one the arrow keys nudge. Null outside edit mode.</summary>
    public string? EditSelection { get; private set; }

    /// <summary>All widgets temporarily hidden by the "toggle-widgets" hotkey. Not saved.</summary>
    public bool WidgetsHidden { get; private set; }

    readonly HotkeyService _hotkeys;
    readonly WindowsAccent _windowsAccent;

    /// <summary>Locked / display off / Energy Saver state (#104); widgets pause and slow down from it.</summary>
    public PowerState Power { get; }

    /// <summary>True while a fullscreen app hides the widgets (only with General.HideOnFullscreen). Not saved.</summary>
    public bool HiddenByFullscreen { get; private set; }
    public bool Peeking { get; private set; }
    readonly System.Windows.Forms.Timer _fullscreenTimer = new() { Interval = 750 };
    System.Windows.Forms.Timer? _peekTimer;

    bool ShouldHide => WidgetsHidden || HiddenByFullscreen;

    /// <summary>Instances with "start hidden" that the user has not revealed yet (#66). Not saved.</summary>
    readonly HashSet<string> _startHidden = new();
    readonly System.Windows.Forms.Timer _rulesTimer = new() { Interval = 15000 };

    /// <summary>Whether this widget copy may be on screen: global hide states, start-hidden and its "show only when" rules.</summary>
    bool WantVisible(string inst)
    {
        if (ShouldHide || _startHidden.Contains(inst)) return false;
        var rules = Settings.Widgets.TryGetValue(inst, out var ws) ? ws.ShowWhen : null;
        if (rules is null) return true;
        return Prefs.RulesAllow(rules, DateTime.Now.TimeOfDay,
            SystemInformation.PowerStatus.PowerLineStatus != PowerLineStatus.Offline,
            name => Screen.AllScreens.Any(s => s.DeviceName.Equals(name, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>Shows or hides every widget window from the hotkey and fullscreen states. Only changes windows whose state differs, so nothing flickers.</summary>
    void ApplyVisibility()
    {
        foreach (var (inst, w) in _windows)
        {
            var want = WantVisible(inst);
            if (w.Visible != want) w.Visible = want;
        }
    }

    void CheckFullscreen()
    {
        var hide = Settings.General.HideOnFullscreen && Placement.FullscreenAppActive();
        if (hide == HiddenByFullscreen) return;
        HiddenByFullscreen = hide;
        if (hide) EndPeek();
        ApplyVisibility();
    }

    /// <summary>Raises the widgets above other windows for General.PeekSeconds (never activating them), then returns them to the bottom.</summary>
    public void Peek()
    {
        if (ShouldHide) return;
        DesktopPin.Peeking = true;
        Peeking = true;
        foreach (var w in _windows.Values) if (w.IsHandleCreated) DesktopPin.Raise(w.Handle);
        _peekTimer ??= new System.Windows.Forms.Timer();
        _peekTimer.Stop();
        _peekTimer.Interval = Math.Clamp(Settings.General.PeekSeconds, 1, 60) * 1000;
        _peekTimer.Tick -= PeekTick;
        _peekTimer.Tick += PeekTick;
        _peekTimer.Start();
    }

    void PeekTick(object? s, EventArgs e) => EndPeek();

    void EndPeek()
    {
        _peekTimer?.Stop();
        if (!Peeking) return;
        Peeking = false;
        DesktopPin.Peeking = false;
        foreach (var w in _windows.Values) if (w.IsHandleCreated) DesktopPin.Lower(w.Handle);
    }

    WakeRefresh? _wakeRefresh;

    /// <summary>Resume / network back / unlock (#102): widgets fetch now instead of waiting for their next tick.</summary>
    void RefreshAfterWake(string trigger)
    {
        Log.Verbose($"Refreshing widgets after {trigger}");
        foreach (var w in _windows.Values) w.RefreshData();
    }

    void OnDisplayChanged(object? s, EventArgs e) => _ui.Post(_ => { foreach (var w in _windows.Values) w.ReapplyPlacement(); UpdateEditPills(); }, null);

    // SystemEvents raises these on its own thread, and a clock change often sends several in a row: coalesce them on the UI thread.
    readonly System.Windows.Forms.Timer _timeTimer = new() { Interval = 300 };
    string? _timeSignature;

    void OnTimeChanged(object? s, EventArgs e) => _ui.Post(_ => { _timeTimer.Stop(); _timeTimer.Start(); }, null);

    /// <summary>Settings broadcasts (WM_SETTINGCHANGE) are frequent; only a different time zone counts.</summary>
    void OnPreferenceChanged(object? s, Microsoft.Win32.UserPreferenceChangedEventArgs e) => _ui.Post(_ =>
    {
        if (!TimeChange.ZoneChanged(_timeSignature, TimeChange.Signature())) return;
        _timeTimer.Stop();
        _timeTimer.Start();
    }, null);

    void TimeTimerTick(object? s, EventArgs e)
    {
        _timeTimer.Stop();
        _timeSignature = TimeChange.Signature();
        foreach (var w in _windows.Values) w.NotifyTimeChanged();
    }

    /// <summary>Runs a hotkey action. Never activates a widget window; only Settings is brought forward, on request.</summary>
    void RunHotkey(string action)
    {
        switch (action)
        {
            case "edit-mode": SetEditMode(!EditMode); break;
            case "refresh-all": foreach (var w in _windows.Values) w.RefreshData(); break;
            case "toggle-widgets":
                WidgetsHidden = !WidgetsHidden;
                if (!WidgetsHidden) _startHidden.Clear();
                ApplyVisibility();
                break;
            case "peek": Peek(); break;
            case "open-settings": ShowSettings(); break;
        }
    }

    public System.Text.Json.Nodes.JsonObject DescribeHotkeys() => new()
    {
        ["hotkeys"] = _hotkeys.Describe(Settings.Hotkeys),
        ["widgetsHidden"] = WidgetsHidden,
    };

    /// <summary>Sets (or with empty keys clears) one hotkey, rejecting invalid or duplicate combinations; other apps' conflicts show as a failed status.</summary>
    public void SetHotkey(string action, string keys)
    {
        if (!Hotkey.IsAction(action)) throw new ArgumentException($"Unknown hotkey action '{action}'. Actions: {string.Join(", ", Hotkey.Actions.Select(a => a.Id))}");
        var next = new Dictionary<string, string>(Settings.Hotkeys);
        if (string.IsNullOrWhiteSpace(keys)) next.Remove(action);
        else
        {
            if (!Hotkey.TryParse(keys, out _, out _, out var err)) throw new ArgumentException(err);
            next[action] = Hotkey.Normalize(keys)!;
            if (Hotkey.Validate(next).TryGetValue(action, out var conflict)) throw new ArgumentException(conflict);
        }
        Settings.Hotkeys = next;
        ApplyHotkeys();
    }

    public void ResetHotkeys()
    {
        Settings.Hotkeys = new();
        ApplyHotkeys();
    }

    void ApplyHotkeys()
    {
        _hotkeys.Apply(Settings.Hotkeys);
        SaveSettings();
        SettingsChangedElsewhere();
    }

    /// <summary>Safe mode: community widgets stay closed (nothing is deleted or disabled in settings). Not saved, so the next normal start restores everything.</summary>
    public bool SafeMode { get; private set; }

    public Layouts Layouts { get; } = Layouts.Load();

    public void SetSafeMode(bool on)
    {
        if (SafeMode == on) return;
        SafeMode = on;
        Log.Write($"Safe mode {(on ? "on" : "off")}");
        SyncWindows();
        SettingsChangedElsewhere();
    }

    /// <summary>Saves the current positions, sizes and enabled widgets under a name.</summary>
    public void SaveLayout(string name)
    {
        Layouts.Capture(name, Settings);
        SettingsChangedElsewhere();
    }

    /// <summary>Switches to a saved layout live; returns how many widget copies it changed.</summary>
    public int ApplyLayout(string name)
    {
        var n = Layouts.Apply(name, Settings);
        SaveSettings();
        SyncWindows();
        foreach (var w in _windows.Values) w.PushSettings();
        SettingsChangedElsewhere();
        return n;
    }

    public bool DeleteLayout(string name)
    {
        var ok = Layouts.Delete(name);
        SettingsChangedElsewhere();
        return ok;
    }

    public App(bool openSettings, bool background = false, bool safe = false)
    {
        SafeMode = safe;
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        Settings = Settings.Load();
        Prefs.Configure(Settings.General);
        _windowsAccent = new WindowsAccent(() => _ui.Post(_ => OnSystemAccentChanged(), null));
        Prefs.SystemAccent = _windowsAccent.Read();
        WebHost.WebSettings = Settings.General;
        Manifests = WidgetManifest.DiscoverAll();
        Log.Write($"Umbra started, {Manifests.Count} widget(s) found");

        Updater = new UpdateService(this);
        _tray = new NotifyIcon { Icon = AppIcon, Text = "Umbra", Visible = true };
        // One left click, like OneDrive and PowerToys. ShowSettings only focuses an open window, so a double-click never opens two.
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowSettings(); };
        _tray.ContextMenuStrip = new ContextMenuStrip();
        _tray.ContextMenuStrip.Opening += (_, _) => BuildTrayMenu();
        BuildTrayMenu();
        UpdateTrayStatus();
        _tray.BalloonTipClicked += (_, _) =>
        {
            if (_balloonAction is { } act) act();
            else if (_balloonUrl is { } u) WebHost.OpenExternal(u);
        };
        AnnounceUpdate();

        foreach (var (k, ws) in Settings.Widgets) if (ws.StartHidden) _startHidden.Add(k);
        Power = new PowerState(_ui); // before the windows: their settings payload reads it
        Power.Changed += () => { foreach (var w in _windows.Values) w.PushPower(); };
        SyncWindows();
        _hotkeys = new HotkeyService(RunHotkey);
        _hotkeys.Apply(Settings.Hotkeys);
        _fullscreenTimer.Tick += (_, _) => CheckFullscreen();
        _fullscreenTimer.Start();
        _rulesTimer.Tick += (_, _) => ApplyVisibility();
        _rulesTimer.Start();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        _timeSignature = TimeChange.Signature();
        _timeTimer.Tick += TimeTimerTick;
        Microsoft.Win32.SystemEvents.TimeChanged += OnTimeChanged;
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += OnPreferenceChanged;
        _wakeRefresh = new WakeRefresh(_ui, RefreshAfterWake, () => Settings.General.RefreshSeconds);

        // Former built-in widgets are fetched again once; a fresh install starts on Browse.
        var restore = Restore.ToRestore(Settings, Manifests);
        if (restore.Count > 0)
        {
            _restoring.UnionWith(restore);
            _ = RestoreMissingAsync();
        }
        else if (!Settings.General.LegacyRestoreDone) Settings.General.LegacyRestoreDone = true;
        var showBrowse = openSettings && Manifests.Count == 0 && restore.Count == 0;
        if (openSettings)
        {
            var win = ShowSettings();
            if (showBrowse) _ = ShowBrowseAsync(win);
        }
    }

    static async Task ShowBrowseAsync(SettingsWindow win) => await ShowPageAsync(win, "browse");

    static async Task ShowPageAsync(SettingsWindow win, string page)
    {
        try { await win.ShowPageAsync(page); }
        catch (Exception ex) { Log.Write($"Could not open {page}: {ex.Message}"); }
    }

    /// <summary>
    /// After a self-update, shows one balloon "Umbra updated to x.y" that opens About, where the release notes are.
    /// The version is recorded first, so it shows once per version; a first install shows nothing.
    /// </summary>
    void AnnounceUpdate()
    {
        var current = UpdateService.CurrentVersion;
        var announce = Updates.ShouldAnnounce(Settings.General.LastSeenVersion, current);
        var next = Updates.NextLastSeen(Settings.General.LastSeenVersion, current);
        if (next != Settings.General.LastSeenVersion) { Settings.General.LastSeenVersion = next; SaveSettings(); }
        if (!announce) return;
        Log.Write($"Updated to {current}");
        _ = ObserveAsync(Updater.LoadWhatsNewAsync(current), "Release notes");
        ShowBalloon(6000, "Umbra", $"Umbra updated to {current}. See what's new", ToolTipIcon.None, null, () => _ = ShowPageAsync(ShowSettings(), "about"));
    }

    /// <summary>Legacy widget ids being restored right now; their settings and data must survive <see cref="ForgetOrphans"/>.</summary>
    readonly HashSet<string> _restoring = new();

    /// <summary>One attempt per start, never blocks startup; the marker is only set when it finished, so offline retries next start.</summary>
    async Task RestoreMissingAsync()
    {
        try
        {
            var r = await Restore.RunAsync(
                () => OnUi(() => Task.FromResult(Restore.ToRestore(Settings, Manifests))),
                Community.FetchCatalogAsync, e => Community.InstallAsync(e), Log.Write);
            await OnUi(() =>
            {
                _restoring.Clear();
                if (r.Installed.Count > 0) { ReloadWidgets(); SettingsChangedElsewhere(); }
                if (r.Done) { Settings.General.LegacyRestoreDone = true; SaveSettings(); }
                return Task.FromResult(0);
            });
            Log.Write($"Restore finished: installed [{string.Join(", ", r.Installed)}], done={r.Done}");
        }
        catch (Exception ex)
        {
            Log.Write($"Restore failed: {ex.Message}");
            await OnUi(() => { _restoring.Clear(); return Task.FromResult(0); });
        }
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
        UpdateTrayStatus();
    }

    Icon? _badgedIcon;
    bool _badged;

    /// <summary>Refreshes the tray tooltip (widget count, edit/safe mode, update) and shows the update dot while an Umbra update is ready.</summary>
    void UpdateTrayStatus()
    {
        _tray.Text = Tray.Tooltip(_windows.Count, EditMode, SafeMode, Updater.Available is not null);
        var badge = Updater.Available is not null;
        if (badge == _badged) return;
        _badged = badge;
        if (badge)
        {
            try { _badgedIcon = Tray.WithBadge(AppIcon, SystemInformation.SmallIconSize); _tray.Icon = _badgedIcon; }
            catch (Exception ex) { Log.Write($"Tray badge failed: {ex.Message}"); _badged = false; }
        }
        else
        {
            _tray.Icon = AppIcon;
            _badgedIcon?.Dispose();
            _badgedIcon = null;
        }
    }

    /// <summary>Starts a fresh Umbra that waits for this one to exit, then exits. For settings that only apply on start (GPU, proxy).</summary>
    public void Restart()
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(AppPaths.ExePath, Tray.RestartArg) { UseShellExecute = false });
        }
        catch (Exception ex)
        {
            Log.Write($"Restart failed: {ex.Message}");
            ShowBalloon(4000, "Umbra", $"Could not restart: {ex.Message}", ToolTipIcon.Error, null, null);
            return;
        }
        Log.Write("Restarting");
        QuitSoon();
    }

    /// <summary>Exits shortly after the current pipe reply has been written.</summary>
    public void QuitSoon() => _ = Task.Delay(300).ContinueWith(_ => _ui.Post(_ => ExitThread(), null));

    Font? _trayBold; // one shared bold font for the tray menu (a new one per rebuild would leak)

    void BuildTrayMenu()
    {
        var menu = _tray.ContextMenuStrip!;
        menu.Items.Clear();
        _tray.Text = Updater.Progress is { } dl ? $"Umbra - downloading update {dl}%"
            : Updater.Ready && Updater.Available is { } ready ? $"Umbra - restart to update to v{ready.Version}" : "Umbra";
        if (Updater.Available is { } up)
        {
            var label = Updater.Progress is { } pct ? $"Downloading update v{up.Version} ({pct}%)"
                : Updater.Ready ? $"Restart to update to v{up.Version}" : $"Update to v{up.Version} available";
            menu.Items.Add(label, null, async (_, _) =>
            {
                try { await Updater.InstallAsync(); }
                catch (Exception ex)
                {
                    Log.Write($"Update failed: {ex.Message}");
                    ShowTrayMessage($"Update failed: {ex.Message}", ToolTipIcon.Error);
                }
            }).Font = _trayBold ??= new Font(menu.Font, FontStyle.Bold);
            menu.Items.Add(new ToolStripSeparator());
        }
        menu.Items.Add("Settings...", null, (_, _) => ShowSettings()).Font = _trayBold ??= new Font(menu.Font, FontStyle.Bold);
        var edit = new ToolStripMenuItem("Edit mode (move and resize)") { Checked = EditMode };
        edit.Click += (_, _) => SetEditMode(!EditMode);
        menu.Items.Add(edit);
        var safe = new ToolStripMenuItem("Safe mode (community widgets off)") { Checked = SafeMode };
        safe.Click += (_, _) => SetSafeMode(!SafeMode);
        menu.Items.Add(safe);
        var layouts = new ToolStripMenuItem("Layouts");
        foreach (var name in Layouts.Items.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
            layouts.DropDownItems.Add(name, null, (_, _) => ApplyLayout(name));
        if (layouts.DropDownItems.Count > 0) layouts.DropDownItems.Add(new ToolStripSeparator());
        layouts.DropDownItems.Add("Save current layout", null, (_, _) =>
        {
            var n = Layouts.Items.Count + 1;
            while (Layouts.Items.ContainsKey($"Layout {n}")) n++;
            try { SaveLayout($"Layout {n}"); } catch (Exception ex) { Log.Write($"Save layout failed: {ex.Message}"); }
        });
        menu.Items.Add(layouts);
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
        menu.Items.Add("Open data folder", null, (_, _) =>
        {
            try { System.Diagnostics.Process.Start("explorer.exe", $"\"{AppPaths.DataDir}\""); }
            catch (Exception ex) { Log.Write($"Open data folder failed: {ex.Message}"); }
        });
        menu.Items.Add("Restart Umbra", null, (_, _) => Restart());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
    }

    /// <summary>A balloon from Umbra itself (not a widget), e.g. a failed update.</summary>
    public void ShowTrayMessage(string text, ToolTipIcon icon)
    {
        ShowBalloon(5000, "Umbra", text, icon, null, null);
    }

    /// <summary>
    /// The only place a tray balloon is shown: it resets what a click does first, so a later balloon without a target
    /// never inherits the previous one's URL or action (e.g. opening About).
    /// </summary>
    void ShowBalloon(int ms, string title, string text, ToolTipIcon icon, string? url, Action? action)
    {
        _balloonUrl = url;
        _balloonAction = action;
        _tray.ShowBalloonTip(ms, title, text, icon);
    }

    /// <summary>Awaits a fire-and-forget task so an exception is logged instead of going unobserved.</summary>
    static async Task ObserveAsync(Task task, string what)
    {
        try { await task; }
        catch (Exception ex) { Log.Write($"{what} failed: {ex.Message}"); }
    }

    /// <summary>"Name" for the first copy of a widget, "Name (2)" for the others.</summary>
    /// <summary>Shows a widget's notification (balloon/toast from the tray icon) unless its rate limit is used up; clicking opens <paramref name="url"/>.</summary>
    public bool Notify(string instance, string widgetName, string title, string body, string? url)
    {
        if (!_notifier.TryAcquire(instance, DateTime.UtcNow)) return false;
        Log.Write($"[{instance}] notify: {title}");
        ShowBalloon(5000, widgetName, body.Length == 0 ? title : $"{title}\n{body}", ToolTipIcon.None, url, null);
        return true;
    }

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
                var enabled = Settings.For(m, inst).Enabled && !(SafeMode && m.Source != WidgetSource.BuiltIn);
                var open = _windows.TryGetValue(inst, out var win);
                if (enabled && !open)
                {
                    win = new WidgetWindow(this, m, inst);
                    win.FormClosed += (_, _) => _windows.Remove(inst);
                    _windows[inst] = win;
                    if (WantVisible(inst)) win.Show();
                }
                else if (!enabled && open)
                {
                    win!.Close();
                }
            }
        var live = Manifests.SelectMany(m => Settings.Instances(m.Id)).ToHashSet();
        foreach (var inst in _windows.Keys.Where(k => !live.Contains(k)).ToList()) CloseWidget(inst);
        foreach (var inst in _startHidden.Where(k => !Settings.Widgets.TryGetValue(k, out var s) || !s.StartHidden).ToList()) _startHidden.Remove(inst);
        ApplyVisibility();
        UpdateTrayStatus();
        RefreshEditPills();
    }

    /// <summary>Closes one copy (an instance id), or every copy of a widget (its plain id).</summary>
    public void CloseWidget(string id)
    {
        foreach (var key in _windows.Keys.Where(k => k == id || (!id.Contains('#') && InstanceId.WidgetOf(k) == id)).ToList())
        {
            if (EditSelection == key) EditSelection = null;
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
        var known = Manifests.Select(m => m.Id).ToList();
        foreach (var key in Restore.Orphans(Settings.Widgets.Keys.Where(InstanceId.IsExtra), known, _restoring))
        {
            CloseWidget(key);
            Settings.Widgets.Remove(key);
        }
        foreach (var inst in Restore.Orphans(WidgetStore.CopyIds(), known, _restoring))
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
        UpdateTrayStatus();
    }

    /// <summary>Replaces settings (positions included) and widget data from a validated backup; approvals are untouched.</summary>
    public void RestoreBackup(Backup.Parsed backup)
    {
        Backup.WriteData(backup, WidgetStore.CopyIds().Concat(Settings.Widgets.Keys));
        foreach (var id in _windows.Keys.ToList()) CloseWidget(id);
        var s = backup.Settings;
        if (Theme.DiscoverAll().All(t => t.Id != s.General.Theme)) s.General.Theme = Theme.DefaultId;
        s.General.LegacyRestoreDone = true;
        s.General.LastSeenVersion = Settings.General.LastSeenVersion; // an old backup must not announce an update again
        s.SettingsPanel = Settings.SettingsPanel; // where this window sits is not part of a backup
        Settings = s;
        SaveSettings();
        _hotkeys.Apply(Settings.Hotkeys);
        SyncWindows();
        BuildTrayMenu();
        SettingsChangedElsewhere();
    }

    readonly Dictionary<string, long> _handScaledAt = new();

    /// <summary>A zoom by hand (handle, Ctrl+wheel) just happened: an in-flight Settings save must not revert it.</summary>
    public void NoteHandScale(string instance) => _handScaledAt[instance] = System.Environment.TickCount64;

    bool HandScaledRecently(string instance) =>
        _handScaledAt.TryGetValue(instance, out var t) && System.Environment.TickCount64 - t < 2000;

    public void ApplySettings(Settings incoming)
    {
        // Positions are owned by the widget windows (dragging), so keep the current ones.
        // Copies are only added and removed through AddInstance/RemoveInstance, never by a (possibly stale) save.
        foreach (var id in incoming.Widgets.Keys.Where(k => InstanceId.IsExtra(k) && !Settings.Widgets.ContainsKey(k)).ToList())
            incoming.Widgets.Remove(id);
        foreach (var (id, cur) in Settings.Widgets)
            if (!incoming.Widgets.ContainsKey(id) && InstanceId.IsExtra(id)) incoming.Widgets[id] = cur;
        foreach (var (id, ws) in incoming.Widgets)
            if (Settings.Widgets.TryGetValue(id, out var cur)) { ws.X = cur.X; ws.Y = cur.Y; ws.Monitor = cur.Monitor; ws.RelX = cur.RelX; ws.RelY = cur.RelY; if (HandScaledRecently(id)) ws.Scale = cur.Scale; }
        incoming.Hotkeys = Settings.Hotkeys; // owned by SetHotkey, never by a (possibly stale) save
        incoming.General.LastSeenVersion = Settings.General.LastSeenVersion; // owned by AnnounceUpdate
        incoming.SettingsPanel = Settings.SettingsPanel; // owned by the Settings window
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
        if (!on) ShowGuides(Array.Empty<Snap.Guide>(), 96);
        EditSelection = null;
        Log.Write($"Edit mode {(on ? "on" : "off")}");
        foreach (var w in _windows.Values) w.PushSettings();
        UpdateEditPills();
        SettingsChangedElsewhere();
    }

    SnapGuides? _snapGuides;

    /// <summary>Draws (or, with none, hides) the alignment guides while a widget is moved in edit mode.</summary>
    public void ShowGuides(IReadOnlyList<Snap.Guide> guides, int dpi)
    {
        if (guides.Count == 0 && _snapGuides is null) return;
        _snapGuides ??= new SnapGuides();
        _snapGuides.SetGuides(guides, Settings.General.Accent, dpi);
    }

    readonly List<EditPill> _pills = new();

    /// <summary>The "Done" pills: one per monitor that shows a widget (the primary one if none does) while edit mode is on, none otherwise.</summary>
    void UpdateEditPills()
    {
        if (!EditMode)
        {
            foreach (var p in _pills) p.Close();
            _pills.Clear();
            return;
        }
        var screens = Placement.Monitors();
        var areas = _windows.Values.Where(w => w.IsHandleCreated && w.Visible)
            .Select(w => Placement.Find(screens, w.Bounds)).OfType<MonitorInfo>().Select(m => m.WorkArea).Distinct().ToList();
        if (areas.Count == 0) areas = screens.Where(s => s.Primary).Select(s => s.WorkArea).Take(1).ToList();
        // Only touch pills that must appear or go, so a save or a drag never makes them flicker.
        foreach (var p in _pills.Where(p => !areas.Contains(p.Area)).ToList()) { p.Close(); _pills.Remove(p); }
        var added = false;
        foreach (var area in areas.Where(a => _pills.All(p => p.Area != a)))
        {
            var pill = new EditPill(this, area);
            _pills.Add(pill);
            pill.Show();
            added = true;
        }
        foreach (var p in _pills) p.RefreshState();
        if (added) LowerWidgets();
    }

    /// <summary>Moves the pills to the monitors that show widgets now (a widget was dragged to another monitor, added or removed).</summary>
    public void RefreshEditPills() { if (EditMode) UpdateEditPills(); }

    /// <summary>Puts every widget back at the bottom, under the edit pills (a pill is shown at the bottom too, so the widgets go under it).</summary>
    public void LowerWidgets()
    {
        if (Peeking) return;
        foreach (var w in _windows.Values) if (w.IsHandleCreated) DesktopPin.SendToBottom(w.Handle);
    }

    /// <summary>The pill's snap switch: flips snapping and refreshes the pills, tray and Settings.</summary>
    public void ToggleSnap()
    {
        Snap.Toggle(Settings.General);
        SaveSettings();
        foreach (var p in _pills) p.RefreshState();
        SettingsChangedElsewhere();
    }

    /// <summary>Marks one widget copy as the edit-mode selection (stronger outline, arrow keys); everyone else is deselected.</summary>
    public void SelectForEdit(string instance)
    {
        if (!EditMode || EditSelection == instance) return;
        EditSelection = instance;
        foreach (var w in _windows.Values) w.ShowEditSelected(w.Instance == instance);
    }

    public void ResetPosition(string id)
    {
        if (_windows.TryGetValue(id, out var w)) w.ResetPosition();
        else if (Settings.Widgets.TryGetValue(id, out var ws)) { ws.X = ws.Y = null; SaveSettings(); }
    }

    /// <summary>Remembers where the Settings window was closed (see <see cref="SettingsPlacement"/>).</summary>
    public void SaveSettingsPlacement(SettingsPlacement p) { Settings.SettingsPanel = p; Settings.Save(); }

    public void SaveSettings() { Prefs.Configure(Settings.General); Settings.Save(); foreach (var w in _windows.Values) if (w.IsHandleCreated) DesktopPin.RoundCorners(w.Handle); }

    /// <summary>
    /// Windows reported new colors: re-read the accent and, when "Match Windows accent" is on, re-tint widgets and Settings at once.
    /// Windows can fire the event just before the value is readable, so it is checked once more shortly after.
    /// </summary>
    void OnSystemAccentChanged(bool recheck = true)
    {
        var now = _windowsAccent.Read();
        if (now != Prefs.SystemAccent)
        {
            Prefs.SystemAccent = now;
            if (Prefs.IsWindowsAccent(Settings.General.Accent))
            {
                foreach (var w in _windows.Values) w.PushSettings();
                SettingsChangedElsewhere();
            }
        }
        if (recheck) _ = Task.Delay(500).ContinueWith(_ => _ui.Post(_ => OnSystemAccentChanged(false), null));
    }

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

    /// <summary>Opens (or focuses) Settings. With <paramref name="background"/> an unopened window is created off-screen and never activated, and an open one is left alone.</summary>
    public SettingsWindow ShowSettings(bool background = false)
    {
        if (_settingsWindow is { IsDisposed: false })
        {
            if (background) return _settingsWindow;
            if (_settingsWindow.WindowState == FormWindowState.Minimized) _settingsWindow.WindowState = FormWindowState.Normal;
            _settingsWindow.Activate();
            return _settingsWindow;
        }
        _settingsWindow = new SettingsWindow(this, background);
        _settingsWindow.Show();
        if (!background) _settingsWindow.Activate();
        return _settingsWindow;
    }

    public bool SettingsOpen => _settingsWindow is { IsDisposed: false };

    protected override void ExitThreadCore()
    {
        _tray.Visible = false;
        _tray.Dispose();
        _badgedIcon?.Dispose();
        Updater.Dispose();
        _windowsAccent.Dispose();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        Microsoft.Win32.SystemEvents.TimeChanged -= OnTimeChanged;
        Microsoft.Win32.SystemEvents.UserPreferenceChanged -= OnPreferenceChanged;
        _timeTimer.Dispose();
        _wakeRefresh?.Dispose();
        _fullscreenTimer.Dispose();
        _peekTimer?.Dispose();
        _hotkeys.Dispose();
        _snapGuides?.Dispose();
        foreach (var p in _pills) p.Close();
        Power.Dispose();
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
