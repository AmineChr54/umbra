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
}

public sealed class WidgetSettings
{
    public const double MinScale = 0.5, MaxScale = 3.0;

    double _scale = 1.0;

    public bool Enabled { get; set; } = true;
    public int? X { get; set; }
    public int? Y { get; set; }
    /// <summary>No dragging, resizing or zooming, even in edit mode.</summary>
    public bool Locked { get; set; }

    /// <summary>Size multiplier for the window and the page zoom, kept within 50-300 % and rounded to whole percent.</summary>
    public double Scale
    {
        get => _scale;
        set => _scale = ClampScale(value);
    }

    public JsonObject Options { get; set; } = new();

    /// <summary>Clamps to <see cref="MinScale"/>-<see cref="MaxScale"/> and rounds to 0.01; anything not a number becomes 1.</summary>
    public static double ClampScale(double value) =>
        double.IsFinite(value) ? Math.Round(Math.Clamp(value, MinScale, MaxScale), 2) : 1.0;
}

/// <summary>User settings persisted to %APPDATA%\Umbra\settings.json.</summary>
public sealed class Settings
{
    public GeneralSettings General { get; set; } = new();
    public Dictionary<string, WidgetSettings> Widgets { get; set; } = new();

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
            Widgets[instance] = ws = new WidgetSettings();
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
        return extras;
    }

    public JsonNode ToJson() => JsonSerializer.SerializeToNode(this, Json)!;

    public static Settings FromJson(JsonNode node) => node.Deserialize<Settings>(Json) ?? new();
}
