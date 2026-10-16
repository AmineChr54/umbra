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
    public bool Enabled { get; set; } = true;
    public int? X { get; set; }
    public int? Y { get; set; }
    public bool Locked { get; set; }
    public JsonObject Options { get; set; } = new();
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
