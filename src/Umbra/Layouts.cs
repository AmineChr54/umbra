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
/// A layout can be pinned to the monitor setup it was saved on (<see cref="Placement.Fingerprint"/>) so it can be applied
/// automatically when that setup comes back.
/// </summary>
public sealed class Layouts
{
    public const int MaxLayouts = 20;

    public Dictionary<string, Dictionary<string, LayoutEntry>> Items { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Layout name to the monitor-setup fingerprint it is pinned to. No entry = not pinned.</summary>
    public Dictionary<string, string> Pins { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The layout deleted last, kept in memory so Settings can offer Undo. Not saved.</summary>
    (string Name, Dictionary<string, LayoutEntry> Entries, string? Pin)? _deleted;

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
                l.Pins = new(l.Pins ?? new(), StringComparer.OrdinalIgnoreCase);
                foreach (var gone in l.Pins.Keys.Where(k => !l.Items.ContainsKey(k)).ToList()) l.Pins.Remove(gone);
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
    public void Capture(string name, Settings settings, string? fingerprint = null)
    {
        Set(name, settings, fingerprint);
        Persist();
    }

    /// <summary>Like <see cref="Capture"/> but in memory only. A non-empty <paramref name="fingerprint"/> pins the layout to that monitor setup.</summary>
    public void Set(string name, Settings settings, string? fingerprint = null)
    {
        name = name.Trim();
        if (!IsValidName(name)) throw new ArgumentException("Layout names are 1-40 letters, digits, spaces, - or _");
        if (!Items.ContainsKey(name) && Items.Count >= MaxLayouts) throw new InvalidOperationException($"At most {MaxLayouts} layouts");
        Items[name] = settings.Widgets.ToDictionary(kv => kv.Key, kv => new LayoutEntry
        {
            Enabled = kv.Value.Enabled, X = kv.Value.X, Y = kv.Value.Y, Monitor = kv.Value.Monitor,
            RelX = kv.Value.RelX, RelY = kv.Value.RelY, Scale = kv.Value.Scale,
        });
        if (!string.IsNullOrEmpty(fingerprint)) Pins[name] = fingerprint;
    }

    public bool Delete(string name)
    {
        name = name.Trim();
        if (!Items.TryGetValue(name, out var entries)) return false;
        name = Items.Keys.First(k => k.Equals(name, StringComparison.OrdinalIgnoreCase)); // keep the saved spelling for Undo
        Pins.TryGetValue(name, out var pin);
        _deleted = (name, entries, pin);
        Items.Remove(name);
        Pins.Remove(name);
        Persist();
        return true;
    }

    /// <summary>Brings back the layout deleted last (with its pin); returns its name, or null when there is none or the name is taken again.</summary>
    public string? UndoDelete()
    {
        if (_deleted is not { } d || Items.ContainsKey(d.Name) || Items.Count >= MaxLayouts) return null;
        _deleted = null;
        Items[d.Name] = d.Entries;
        if (d.Pin is not null) Pins[d.Name] = d.Pin;
        Persist();
        return d.Name;
    }

    /// <summary>Renames a layout, keeping its pin. Unknown names throw KeyNotFoundException, a taken or invalid new name throws too.</summary>
    public void Rename(string name, string newName)
    {
        name = name.Trim();
        newName = newName.Trim();
        if (!IsValidName(newName)) throw new ArgumentException("Layout names are 1-40 letters, digits, spaces, - or _");
        if (!Items.TryGetValue(name, out var entries)) throw new KeyNotFoundException($"No layout '{name}'");
        if (!name.Equals(newName, StringComparison.OrdinalIgnoreCase) && Items.ContainsKey(newName))
            throw new InvalidOperationException($"A layout named '{newName}' already exists");
        Pins.TryGetValue(name, out var pin);
        Items.Remove(name);
        Pins.Remove(name);
        Items[newName] = entries;
        if (pin is not null) Pins[newName] = pin;
        Persist();
    }

    /// <summary>Pins a layout to a monitor setup, or with a null or empty <paramref name="fingerprint"/> unpins it.</summary>
    public void SetPin(string name, string? fingerprint)
    {
        name = name.Trim();
        name = Items.Keys.FirstOrDefault(k => k.Equals(name, StringComparison.OrdinalIgnoreCase)) ?? throw new KeyNotFoundException($"No layout '{name}'");
        if (string.IsNullOrEmpty(fingerprint)) Pins.Remove(name); else Pins[name] = fingerprint;
        Persist();
    }

    /// <summary>The layout pinned to exactly this monitor setup (the first by name if several are), or null.</summary>
    public string? FindPinned(string fingerprint) =>
        string.IsNullOrEmpty(fingerprint) ? null
            : Pins.Where(p => p.Value == fingerprint && Items.ContainsKey(p.Key)).Select(p => p.Key)
                .OrderBy(k => k, StringComparer.OrdinalIgnoreCase).FirstOrDefault();

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

    /// <summary>The layouts for Settings and umbractl; <paramref name="currentFingerprint"/> marks the one pinned to the monitor setup in use.</summary>
    public JsonArray ToJson(string? currentFingerprint = null) => new(Items.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
        .Select(kv =>
        {
            Pins.TryGetValue(kv.Key, out var pin);
            return (JsonNode?)new JsonObject
            {
                ["name"] = kv.Key, ["widgets"] = kv.Value.Count, ["enabled"] = kv.Value.Count(w => w.Value.Enabled),
                ["pinned"] = pin is not null,
                ["pinnedMonitors"] = pin is null ? 0 : Placement.FingerprintMonitors(pin),
                ["matchesNow"] = pin is not null && pin == currentFingerprint,
            };
        }).ToArray());
}
