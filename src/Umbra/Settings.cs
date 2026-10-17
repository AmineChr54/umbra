using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

public sealed class GeneralSettings
{
    public int RefreshSeconds { get; set; } = 60;
    public bool Animations { get; set; } = true;
    /// <summary>Id of the active theme (see <see cref="Theme"/>); "default" is the built-in look.</summary>
    public string Theme { get; set; } = Umbra.Theme.DefaultId;
    /// <summary>Look for a newer Umbra release on GitHub at start and daily.</summary>
    public bool CheckForUpdates { get; set; } = true;
    /// <summary>Set once the one-time restore of former built-in widgets (sp500) has finished; see <see cref="Restore"/>.</summary>
    public bool LegacyRestoreDone { get; set; }
    /// <summary>Hide every widget while a fullscreen app or game is in the foreground, and show them again after.</summary>
    public bool HideOnFullscreen { get; set; }
    /// <summary>How long Peek (hotkey or "peek" command) keeps the widgets above other windows, 1-60 s.</summary>
    public int PeekSeconds { get; set; } = 5;
    /// <summary>Stretch widget intervals 4x while Windows Energy Saver is on (#104). Widgets always pause while the PC is locked or the display is off.</summary>
    public bool SlowOnEnergySaver { get; set; } = true;

    // Appearance (#61): see Prefs.AppearanceCss
    /// <summary>"default", "sharp" or "round": overrides the --radius-* tokens after the theme.</summary>
    public string CornerRadius { get; set; } = "default";
    /// <summary>"normal", "calm" (--motion-scale 2) or "off".</summary>
    public string AnimationSpeed { get; set; } = "normal";
    /// <summary>Scale given to widgets the first time they are set up (50-300 %).</summary>
    public double DefaultScale { get; set; } = 1.0;

    /// <summary>Draw the hairline border around widget windows (#61).</summary>
    public bool BorderEnabled { get; set; } = true;
    /// <summary>"#rrggbb" border color, or "" for the default.</summary>
    public string BorderColor { get; set; } = "";
    /// <summary>Interface font from <see cref="Prefs.Fonts"/> ("default" = Segoe UI Variable).</summary>
    public string UiFont { get; set; } = "default";
    /// <summary>Interface text size multiplier, 0.8-1.4.</summary>
    public double FontScale { get; set; } = 1.0;
    /// <summary>Solid instead of translucent lines and tints, and fully opaque windows.</summary>
    public bool ReduceTransparency { get; set; }
    /// <summary>"#rrggbb" accent overriding the theme's accent (#13), or "" to follow the theme.</summary>
    public string Accent { get; set; } = "";
    /// <summary>Brighter text tokens for readability on bright wallpapers.</summary>
    public bool LightText { get; set; }

    // Advanced (#65): see Prefs
    /// <summary>"errors", "normal" or "verbose".</summary>
    public string LogLevel { get; set; } = "normal";
    /// <summary>Devtools and a context menu in widget windows.</summary>
    public bool DeveloperMode { get; set; }
    /// <summary>GPU acceleration for WebView2; off passes --disable-gpu (restart needed).</summary>
    public bool HardwareAcceleration { get; set; } = true;
    /// <summary>Seconds to wait after sign-in before starting (only with --background), 0-300.</summary>
    public int StartupDelaySeconds { get; set; }
    /// <summary>"system", "none" or "https://host:port" (restart needed).</summary>
    public string Proxy { get; set; } = "system";
    /// <summary>Grid in physical pixels that widgets snap to while moved in edit mode; 0 = no grid.</summary>
    public int SnapGrid { get; set; }
    /// <summary>Snap to screen and other widgets' edges while moving in edit mode (hold Shift to skip snapping).</summary>
    public bool SnapEdges { get; set; } = true;
    /// <summary>Master switch for snapping (the edit-mode pill toggles it); the grid and edge settings above are kept while it is off.</summary>
    public bool SnapEnabled { get; set; } = true;
}

/// <summary>"Show only when" conditions of a widget; every set field must hold.</summary>
public sealed class ShowRules
{
    /// <summary>"HH:mm" start of the daily window (with <see cref="To"/>; wraps past midnight).</summary>
    public string? From { get; set; }
    public string? To { get; set; }
    /// <summary>true = only on AC power, false = only on battery.</summary>
    public bool? OnAc { get; set; }
    /// <summary>Only while this monitor (device name) is connected.</summary>
    public string? Monitor { get; set; }
}

public sealed class WidgetSettings
{
    public const double MinScale = 0.5, MaxScale = 3.0;

    double _scale = 1.0;

    public bool Enabled { get; set; } = true;
    public int? X { get; set; }
    public int? Y { get; set; }
    /// <summary>Device name of the monitor the widget lives on (e.g. \\.\DISPLAY2); null = not recorded yet, X/Y apply as they are.</summary>
    public string? Monitor { get; set; }
    /// <summary>Offset from that monitor's top-left corner, so the widget keeps its place when monitors change.</summary>
    public int? RelX { get; set; }
    public int? RelY { get; set; }
    /// <summary>No dragging, resizing or zooming, even in edit mode.</summary>
    public bool Locked { get; set; }
    /// <summary>The user allows this widget to show notifications (umbra.notify). Off until switched on.</summary>
    public bool Notifications { get; set; }

    /// <summary>Size multiplier for the window and the page zoom, kept within 50-300 % and rounded to whole percent.</summary>
    public double Scale
    {
        get => _scale;
        set => _scale = ClampScale(value);
    }

    /// <summary>Own refresh interval in seconds (30-600) overriding the global one; null = global.</summary>
    public int? RefreshSeconds { get; set; }
    /// <summary>Window opacity 0.2-1; null = fully opaque (the default keeps true black and ClearType).</summary>
    public double? Opacity { get; set; }
    /// <summary>Not shown at launch; revealed with the toggle-widgets hotkey or by configure startHidden=false (#66).</summary>
    public bool StartHidden { get; set; }
    /// <summary>Show only while these conditions hold (#66); null = always.</summary>
    public ShowRules? ShowWhen { get; set; }

    public JsonObject Options { get; set; } = new();

    /// <summary>Clamps to <see cref="MinScale"/>-<see cref="MaxScale"/> and rounds to 0.01; anything not a number becomes 1.</summary>
    public static double ClampScale(double value) =>
        double.IsFinite(value) ? Math.Round(Math.Clamp(value, MinScale, MaxScale), 2) : 1.0;
}

/// <summary>Where the Settings window was when it was last closed, so it opens there again (#111). Sizes are logical (96-DPI) pixels.</summary>
public sealed class SettingsPlacement
{
    /// <summary>Device name of the monitor the window was on; null = never saved.</summary>
    public string? Monitor { get; set; }
    /// <summary>Offset of the window's top-left corner from that monitor's top-left corner.</summary>
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    /// <summary>The window was maximized (X/Y/Width/Height are then the restored bounds).</summary>
    public bool Maximized { get; set; }
    /// <summary>Last open page (one of <see cref="SettingsWindow.Pages"/>); null = General.</summary>
    public string? Page { get; set; }
}

/// <summary>User settings persisted to %APPDATA%\Umbra\settings.json.</summary>
public sealed class Settings
{
    public GeneralSettings General { get; set; } = new();
    public Dictionary<string, WidgetSettings> Widgets { get; set; } = new();
    /// <summary>Global hotkeys by action id (see <see cref="Hotkey.Actions"/>), e.g. "edit-mode": "Ctrl+Alt+E". No entry = off.</summary>
    public Dictionary<string, string> Hotkeys { get; set; } = new();

    /// <summary>Last placement and page of the Settings window; owned by the window, never by a (possibly stale) Settings save or a backup.</summary>
    public SettingsPlacement SettingsPanel { get => _settingsPanel; set => _settingsPanel = value ?? new(); } // a null in the file means defaults
    SettingsPlacement _settingsPanel = new();

    static string FilePath => Path.Combine(AppPaths.DataDir, "settings.json");

    static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), Json) ?? new();
        }
        catch (Exception ex)
        {
            Log.Write($"settings.json unreadable, using defaults: {ex.Message}");
        }
        return new();
    }

    public void Save()
    {
        try
        {
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
            File.Move(tmp, FilePath, overwrite: true);
        }
        catch (Exception ex)
        {
            Log.Write($"Could not save settings: {ex.Message}");
        }
    }

    /// <summary>
    /// Returns the settings of one copy of the widget (<paramref name="instance"/> = its <see cref="InstanceId"/>,
    /// null = the first copy), creating them and filling any missing option with its manifest default.
    /// </summary>
    public WidgetSettings For(WidgetManifest m, string? instance = null)
    {
        instance ??= m.Id;
        if (InstanceId.WidgetOf(instance) != m.Id) throw new ArgumentException($"'{instance}' is not a copy of '{m.Id}'");
        if (!Widgets.TryGetValue(instance, out var ws))
            Widgets[instance] = ws = new WidgetSettings { Scale = General.DefaultScale };
        foreach (var (key, value) in m.DefaultOptions())
            if (!ws.Options.ContainsKey(key)) ws.Options[key] = value?.DeepClone();
        General.RefreshSeconds = Math.Clamp(General.RefreshSeconds, 30, 600);
        return ws;
    }

    /// <summary>Instance ids of a widget: the first copy always, then the extra ones in order. Old files only have the first.</summary>
    public List<string> Instances(string widgetId) =>
        Widgets.Keys.Where(k => k != widgetId && InstanceId.IsValid(k) && InstanceId.WidgetOf(k) == widgetId && InstanceId.IsExtra(k))
            .OrderBy(InstanceId.NumberOf).Prepend(widgetId).ToList();

    /// <summary>Creates the next free extra copy and returns its instance id, or null at <see cref="InstanceId.MaxInstances"/>.</summary>
    public string? AddInstance(WidgetManifest m)
    {
        if (Instances(m.Id).Count >= InstanceId.MaxInstances) return null;
        var n = 2;
        while (Widgets.ContainsKey(InstanceId.Make(m.Id, n))) n++;
        var id = InstanceId.Make(m.Id, n);
        For(m, id);
        return id;
    }

    /// <summary>Forgets every extra copy of a widget (when it is uninstalled); returns their ids.</summary>
    public List<string> RemoveExtraInstances(string widgetId)
    {
        var extras = Instances(widgetId).Skip(1).ToList();
        foreach (var e in extras) Widgets.Remove(e);
        Widgets.Remove(widgetId); // removed means gone: no stale entry that a restore could bring back
        return extras;
    }

    public JsonNode ToJson() => JsonSerializer.SerializeToNode(this, Json)!;

    public static Settings FromJson(JsonNode node) => node.Deserialize<Settings>(Json) ?? new();
}
