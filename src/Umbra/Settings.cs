using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

public sealed class GeneralSettings
{
    public int RefreshSeconds { get; set; } = 60;
    public bool Animations { get; set; } = true;
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

    /// <summary>Returns the widget's settings, creating them and filling any missing option with its manifest default.</summary>
    public WidgetSettings For(WidgetManifest m)
    {
        if (!Widgets.TryGetValue(m.Id, out var ws))
            Widgets[m.Id] = ws = new WidgetSettings();
        foreach (var (key, value) in m.DefaultOptions())
            if (!ws.Options.ContainsKey(key)) ws.Options[key] = value?.DeepClone();
        General.RefreshSeconds = Math.Clamp(General.RefreshSeconds, 30, 600);
        return ws;
    }

    public JsonNode ToJson() => JsonSerializer.SerializeToNode(this, Json)!;

    public static Settings FromJson(JsonNode node) => node.Deserialize<Settings>(Json) ?? new();
}
