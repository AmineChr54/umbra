using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Umbra;

/// <summary>
/// A theme is data only: a theme.json with a map of design tokens (the custom properties of shared/umbra.css).
/// Token names come from an allow-list and values must be plain colors or lengths, so a theme can never
/// carry script, url(), @import or any other way to load something. The host turns the tokens into a
/// single generated :root rule that widgets and Settings apply (shared/umbra.js).
/// </summary>
public sealed partial class Theme
{
    public const string DefaultId = "default";

    /// <summary>The tokens a theme may set: 'c' = color, 'l' = length.</summary>
    public static readonly IReadOnlyDictionary<string, char> Allowed = new Dictionary<string, char>
    {
        ["--bg"] = 'c', ["--surface-1"] = 'c', ["--surface-2"] = 'c', ["--surface-3"] = 'c',
        ["--line"] = 'c', ["--line-strong"] = 'c',
        ["--text"] = 'c', ["--text-2"] = 'c', ["--text-3"] = 'c',
        ["--accent"] = 'c', ["--accent-strong"] = 'c', ["--accent-soft"] = 'c',
        ["--up"] = 'c', ["--down"] = 'c', ["--flat"] = 'c',
        ["--radius-s"] = 'l', ["--radius-m"] = 'l', ["--radius-l"] = 'l',
    };

    public static readonly string[] PreviewExtensions = { ".png", ".jpg", ".jpeg", ".webp" };

    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Author { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
    public string? Preview { get; set; }
    public Dictionary<string, string> Values { get; set; } = new();

    /// <summary>The built-in theme: today's look, no overrides.</summary>
    public static Theme Default => new() { Id = DefaultId, Name = "Umbra Black", Author = "Umbra", Description = "True black surfaces and an indigo accent." };

    [GeneratedRegex(@"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\z|^(?:rgb|rgba|hsl|hsla)\( *[0-9.]+(?:%|deg)? *[, ] *[0-9.]+%? *[, ] *[0-9.]+%? *(?:[,/] *[0-9.]+%? *)?\)\z")]
    private static partial Regex ColorPattern();

    [GeneratedRegex(@"^(?:[0-9]|[1-9][0-9])(?:\.[0-9]{1,3})?(?:px|rem)\z")]
    private static partial Regex LengthPattern();

    [GeneratedRegex(@"^\d+\.\d+\.\d+\z")]
    private static partial Regex VersionPattern();

    /// <summary>True when the value is acceptable for the token (allow-listed name, safe color or length).</summary>
    public static bool IsValidToken(string name, string value) =>
        Allowed.TryGetValue(name, out var kind) && value.Length <= 64
        && (kind == 'c' ? ColorPattern().IsMatch(value) : LengthPattern().IsMatch(value));

    /// <summary>Minimum contrast ratio between --text and --bg; below it the theme would be unreadable.</summary>
    public const double MinTextContrast = 3.0;

    /// <summary>Reads #hex, rgb()/rgba() and hsl()/hsla() into 0-255 channels (alpha is ignored). False for anything else.</summary>
    internal static bool TryRgb(string v, out (double R, double G, double B) c)
    {
        c = default;
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        if (v.StartsWith('#'))
        {
            var h = v[1..];
            if (h.Length is 3 or 4) h = string.Concat(h.Take(3).Select(ch => $"{ch}{ch}"));
            if (h.Length < 6 || !int.TryParse(h[..6], System.Globalization.NumberStyles.HexNumber, inv, out var n)) return false;
            c = ((n >> 16) & 255, (n >> 8) & 255, n & 255);
            return true;
        }
        var open = v.IndexOf('(');
        if (open < 0 || !v.EndsWith(')')) return false;
        var parts = v[(open + 1)..^1].Split(new[] { ',', ' ', '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3) return false;
        double Num(string p, string unit) => double.Parse(p.EndsWith(unit) ? p[..^unit.Length] : p, inv);
        try
        {
            if (v.StartsWith("rgb"))
            {
                double Ch(string p) => Math.Clamp(p.EndsWith('%') ? Num(p, "%") * 2.55 : Num(p, ""), 0, 255);
                c = (Ch(parts[0]), Ch(parts[1]), Ch(parts[2]));
                return true;
            }
            double hue = (Num(parts[0], "deg") % 360 + 360) % 360, s = Math.Clamp(Num(parts[1], "%"), 0, 100) / 100, l = Math.Clamp(Num(parts[2], "%"), 0, 100) / 100;
            double f(int n) { var k = (n + hue / 30) % 12; return 255 * (l - s * Math.Min(l, 1 - l) * Math.Max(-1, Math.Min(Math.Min(k - 3, 9 - k), 1))); }
            c = (f(0), f(8), f(4));
            return true;
        }
        catch (FormatException) { return false; }
    }

    static double Luminance((double R, double G, double B) c)
    {
        static double L(double v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4); }
        return 0.2126 * L(c.R) + 0.7152 * L(c.G) + 0.0722 * L(c.B);
    }

    internal static double Contrast((double, double, double) a, (double, double, double) b)
    {
        var la = Luminance(a); var lb = Luminance(b);
        return (Math.Max(la, lb) + 0.05) / (Math.Min(la, lb) + 0.05);
    }

    static readonly string[] KnownKeys = { "$schema", "id", "name", "description", "author", "version", "preview", "tokens" };

    /// <summary>Parses and validates theme.json text. Throws <see cref="InvalidOperationException"/> with a readable reason.</summary>
    public static Theme Parse(string text)
    {
        // Duplicate keys surface as ArgumentException, lazily while the tree is read: report them like bad JSON.
        try { return ParseCore(text); }
        catch (Exception ex) when (ex is JsonException or ArgumentException)
        { throw new InvalidOperationException($"theme.json is not valid JSON: {ex.Message}"); }
    }

    static Theme ParseCore(string text)
    {
        var root = JsonNode.Parse(text) as JsonObject ?? throw new InvalidOperationException("theme.json must be a JSON object");

        foreach (var (key, _) in root)
            if (!KnownKeys.Contains(key)) throw new InvalidOperationException($"Unknown key \"{key}\" in theme.json");

        string Req(string key) =>
            root[key] is JsonValue v && v.GetValueKind() == JsonValueKind.String && v.GetValue<string>().Trim() is { Length: > 0 and <= 300 } s
                ? s : throw new InvalidOperationException($"theme.json needs a \"{key}\" text");

        var t = new Theme { Id = Req("id"), Name = Req("name"), Description = Req("description"), Author = Req("author"), Version = Req("version") };
        if (!WidgetManifest.IdPattern().IsMatch(t.Id)) throw new InvalidOperationException($"Invalid theme id '{t.Id}': use 2-40 lowercase letters, digits and dashes");
        if (!VersionPattern().IsMatch(t.Version)) throw new InvalidOperationException("\"version\" must look like 1.2.3");
        if (root["preview"] is JsonNode p)
        {
            var preview = p.GetValueKind() == JsonValueKind.String ? p.GetValue<string>() : "";
            if (!Community.IsSafeRelativePath(preview) || !PreviewExtensions.Contains(Path.GetExtension(preview), StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException("\"preview\" must be a .png, .jpg or .webp file next to theme.json");
            t.Preview = preview;
        }

        if (root["tokens"] is not JsonObject tokens || tokens.Count == 0) throw new InvalidOperationException("theme.json needs a non-empty \"tokens\" object");
        foreach (var (name, value) in tokens)
        {
            if (!Allowed.ContainsKey(name)) throw new InvalidOperationException($"Token \"{name}\" is not allowed. Allowed: {string.Join(", ", Allowed.Keys)}");
            var v = value?.GetValueKind() == JsonValueKind.String ? value.GetValue<string>().Trim() : "";
            if (!IsValidToken(name, v)) throw new InvalidOperationException($"Value for {name} must be a plain color (#rrggbb, rgb(), hsl()) or a length like 12px");
            if (Allowed[name] == 'c' && !TryRgb(v, out _)) throw new InvalidOperationException($"{name} is not a valid color");
            t.Values[name] = Regex.Replace(v, " +", " "); // one space between parts, so the generated rule is always plain
        }

        // Guard rails: a theme must stay readable and keep rising/falling values apart (unset tokens count as the defaults).
        (double, double, double) Eff(string token, string fallback) { TryRgb(t.Values.GetValueOrDefault(token, fallback), out var c); return c; }
        if (Contrast(Eff("--text", "#f4f5f7"), Eff("--bg", "#000000")) < MinTextContrast)
            throw new InvalidOperationException($"--text is too close to --bg (contrast under {MinTextContrast}:1); the theme would be unreadable");
        if (Eff("--up", "#2fd58b") == Eff("--down", "#ff5a5f"))
            throw new InvalidOperationException("--up and --down must be different colors");
        return t;
    }

    /// <summary>The generated override: one :root rule with only validated tokens. Empty for the default theme.</summary>
    public string ToCss()
    {
        if (Values.Count == 0) return "";
        var sb = new StringBuilder(":root{");
        foreach (var (name, value) in Values)
            if (IsValidToken(name, value)) sb.Append(name).Append(':').Append(value).Append(';');
        return sb.Append('}').ToString();
    }

    /// <summary>Summary for Settings and the control protocol.</summary>
    public JsonObject ToJson() => new()
    {
        ["id"] = Id, ["name"] = Name, ["description"] = Description, ["author"] = Author, ["version"] = Version,
        ["builtin"] = Id == DefaultId,
        ["tokens"] = new JsonObject(Values.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)kv.Value))),
    };

    // ---------- installed themes: %APPDATA%\Umbra\themes\<id>\theme.json ----------

    public static string Dir
    {
        get
        {
            var d = Path.Combine(AppPaths.DataDir, "themes");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    /// <summary>The default theme followed by every valid installed theme, sorted by id.</summary>
    public static List<Theme> DiscoverAll()
    {
        var list = new List<Theme> { Default }; // always first and always selectable, whatever is on disk
        foreach (var dir in Directory.GetDirectories(Dir).OrderBy(d => d))
        {
            // Leftovers of an interrupted install (see Community.CommitTheme) are not themes: clean them up.
            if (dir.EndsWith(".tmp", StringComparison.Ordinal) || dir.EndsWith(".old", StringComparison.Ordinal))
            {
                try { Directory.Delete(dir, recursive: true); } catch { }
                continue;
            }
            var file = Path.Combine(dir, "theme.json");
            if (!File.Exists(file)) continue;
            try
            {
                var t = Parse(File.ReadAllText(file));
                if (t.Id == Path.GetFileName(dir) && t.Id != DefaultId) list.Add(t);
            }
            catch (Exception ex) { Log.Write($"Skipping theme {dir}: {ex.Message}"); }
        }
        return list;
    }

    /// <summary>
    /// Installed themes merged with the catalog (by id): each entry has installed and updateAvailable flags;
    /// catalog-only themes follow the installed ones. Pass null when the catalog could not be fetched.
    /// </summary>
    public static JsonArray Listing(JsonArray? catalog)
    {
        var list = new JsonArray();
        foreach (var t in DiscoverAll())
        {
            var o = t.ToJson();
            o["installed"] = true;
            o["updateAvailable"] = false;
            list.Add(o);
        }
        foreach (var entry in catalog ?? new JsonArray())
        {
            if (entry is null) continue;
            var id = entry["id"]?.GetValue<string>();
            var version = entry["version"]?.GetValue<string>() ?? "0";
            var have = list.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == id);
            if (have is not null)
            {
                have["updateAvailable"] = Community.CompareVersions(version, have["version"]?.GetValue<string>() ?? "0") > 0;
                continue;
            }
            var copy = entry.DeepClone().AsObject();
            copy.Remove("files");
            copy.Remove("preview");
            // The catalog is remote data: only validated tokens reach the Settings page (which draws swatches from them).
            var safe = new JsonObject();
            if (copy["tokens"] is JsonObject tokens)
                foreach (var (name, v) in tokens)
                    if (v?.GetValueKind() == JsonValueKind.String && IsValidToken(name, v.GetValue<string>())) safe[name] = v.GetValue<string>();
            copy["tokens"] = safe;
            copy["builtin"] = false; copy["installed"] = false; copy["updateAvailable"] = false;
            list.Add(copy);
        }
        return list;
    }

    /// <summary>The CSS for a theme id; unknown or removed ids fall back to the default look.</summary>
    public static string CssFor(string? id) =>
        string.IsNullOrEmpty(id) || id == DefaultId ? "" : DiscoverAll().FirstOrDefault(t => t.Id == id)?.ToCss() ?? "";
}
