using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>One widget copy's saved arrangement.</summary>
public sealed class LayoutEntry
{
    public bool Enabled { get; set; } = true;
    public int? X { get; set; }
    public int? Y { get; set; }
    public string? Monitor { get; set; }
    public int? RelX { get; set; }
    public int? RelY { get; set; }
    public double Scale { get; set; } = 1.0;
}

/// <summary>
/// Named layouts (positions, sizes and enabled state of every widget copy), kept in layouts.json next to settings.json.
/// Applying one only touches placement, scale and enabled; options and data are never changed.
/// </summary>
public sealed class Layouts
{
    public const int MaxLayouts = 20;

    public Dictionary<string, Dictionary<string, LayoutEntry>> Items { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    static string FilePath => Path.Combine(AppPaths.DataDir, "layouts.json");

    static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static Layouts Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var l = JsonSerializer.Deserialize<Layouts>(File.ReadAllText(FilePath), Json) ?? new();
                l.Items = new(l.Items, StringComparer.OrdinalIgnoreCase);
                return l;
            }
        }
        catch (Exception ex) { Log.Write($"layouts.json unreadable: {ex.Message}"); }
        return new();
    }

    public void Persist()
    {
        try
        {
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
            File.Move(tmp, FilePath, overwrite: true);
        }
        catch (Exception ex) { Log.Write($"Could not save layouts: {ex.Message}"); }
    }

    /// <summary>A layout name: 1-40 characters, letters, digits, space, dash, underscore.</summary>
    public static bool IsValidName(string? name) =>
        !string.IsNullOrWhiteSpace(name) && name.Trim().Length <= 40 && name.Trim().All(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_');

    /// <summary>Captures the current arrangement under <paramref name="name"/> (replacing a layout of that name).</summary>
    public void Capture(string name, Settings settings)
    {
        Set(name, settings);
        Persist();
    }

    /// <summary>Like <see cref="Capture"/> but in memory only.</summary>
    public void Set(string name, Settings settings)
    {
        name = name.Trim();
        if (!IsValidName(name)) throw new ArgumentException("Layout names are 1-40 letters, digits, spaces, - or _");
        if (!Items.ContainsKey(name) && Items.Count >= MaxLayouts) throw new InvalidOperationException($"At most {MaxLayouts} layouts");
        Items[name] = settings.Widgets.ToDictionary(kv => kv.Key, kv => new LayoutEntry
        {
            Enabled = kv.Value.Enabled, X = kv.Value.X, Y = kv.Value.Y, Monitor = kv.Value.Monitor,
            RelX = kv.Value.RelX, RelY = kv.Value.RelY, Scale = kv.Value.Scale,
        });
    }

    public bool Delete(string name)
    {
        var removed = Items.Remove(name.Trim());
        if (removed) Persist();
        return removed;
    }

    /// <summary>Writes the layout into the settings of every widget copy that still exists; returns how many were changed. Unknown names throw.</summary>
    public int Apply(string name, Settings settings)
    {
        if (!Items.TryGetValue(name.Trim(), out var layout)) throw new KeyNotFoundException($"No layout '{name}'");
        var n = 0;
        foreach (var (id, e) in layout)
        {
            if (!settings.Widgets.TryGetValue(id, out var ws)) continue;
            ws.Enabled = e.Enabled; ws.X = e.X; ws.Y = e.Y; ws.Monitor = e.Monitor; ws.RelX = e.RelX; ws.RelY = e.RelY; ws.Scale = e.Scale;
            n++;
        }
        return n;
    }

    public JsonArray ToJson() => new(Items.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
        .Select(kv => (JsonNode?)new JsonObject { ["name"] = kv.Key, ["widgets"] = kv.Value.Count, ["enabled"] = kv.Value.Count(w => w.Value.Enabled) }).ToArray());
}
