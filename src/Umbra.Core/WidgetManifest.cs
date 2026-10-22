using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Umbra;

public enum WidgetSource { BuiltIn, Community }

/// <summary>Describes one widget folder (widgets/&lt;id&gt;/widget.json).</summary>
public sealed partial class WidgetManifest
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Author { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
    /// <summary>What changed in this version (max 500 characters); shown when an update asks for new access.</summary>
    public string? Changelog { get; set; }
    public string Entry { get; set; } = "index.html";
    public string? Preview { get; set; }
    /// <summary>Small PNG (up to 128 px, 64 KB) next to widget.json, drawn on the group tab strip; null = a letter badge.</summary>
    public string? Icon { get; set; }
    public int Width { get; set; } = 320;
    public int Height { get; set; } = 180;
    /// <summary>False opts the widget out of themes (it keeps the default look).</summary>
    public bool Themeable { get; set; } = true;
    public PointSpec? DefaultPosition { get; set; }
    public PermissionSpec Permissions { get; set; } = new();
    /// <summary>Option schema shown in Settings: key -> {label, type, default, choices?}.</summary>
    public JsonObject Options { get; set; } = new();

    [JsonIgnore] public List<string> OptionOrder { get; set; } = new();
    [JsonIgnore] public string Folder { get; set; } = "";
    [JsonIgnore] public WidgetSource Source { get; set; }

    public sealed class PointSpec { public int X { get; set; } public int Y { get; set; } }
    public sealed class PermissionSpec
    {
        public List<string> Hosts { get; set; } = new();
        /// <summary>Read-only machine totals the widget may read with <c>umbra.system()</c>: any of cpu, memory, network.</summary>
        public List<string> System { get; set; } = new();
        /// <summary>Allows <c>umbra.notify</c>; the user must also switch notifications on for the widget.</summary>
        public bool Notifications { get; set; }
        /// <summary>Windows media session access for <c>umbra.media</c>: "read" (now playing) and/or "control" (play, pause, next, previous).</summary>
        public List<string> Media { get; set; } = new();
        /// <summary>Local programs the widget may ask to run; each needs the user's approval (see <see cref="CommandSpec"/>).</summary>
        public List<CommandSpec> Commands { get; set; } = new();
    }

    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Lowercase letters, digits and dashes; also used as the folder name.</summary>
    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,39}$")]
    public static partial Regex IdPattern();

    /// <summary>Page URL inside WebView2. Built-ins and community widgets live on separate virtual hosts.</summary>
    public string PageUrl => Source == WidgetSource.BuiltIn
        ? VirtualHosts.Url($"widgets/{Folder}/{Entry}")
        : VirtualHosts.CommunityUrl($"{Folder}/{Entry}");

    /// <summary>
    /// True for widgets that ship with the app and cannot be removed. A legacy id (it used to be built in and is
    /// now a catalog widget) can still be sitting in an old install folder; that copy is removable.
    /// </summary>
    public bool IsPermanent => Source == WidgetSource.BuiltIn && !Restore.LegacyIds.Contains(Id);

    public static List<WidgetManifest> DiscoverAll()
    {
        var all = Discover(AppPaths.CommunityDir, WidgetSource.Community);
        var builtIn = Discover(AppPaths.WidgetsDir, WidgetSource.BuiltIn)
            // A catalog copy of a legacy id replaces the stale built-in one left by an old install.
            .Where(b => !Restore.LegacyIds.Contains(b.Id) || all.All(c => c.Id != b.Id));
        var builtInList = builtIn.ToList();
        var community = all.Where(c => builtInList.All(b => b.Id != c.Id));
        return builtInList.Concat(community).ToList();
    }

    /// <summary>First line only, control characters removed, at most 500 characters (it is shown in a native dialog).</summary>
    public static string? SanitizeChangelog(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var line = text.Trim().Split((char)10, 2)[0];
        var clean = new string(line.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (clean.Length > 500) clean = clean[..500];
        return clean.Length == 0 ? null : clean;
    }

    /// <summary>Parses widget.json text. Throws on invalid JSON; does not check the id.</summary>
    public static WidgetManifest Parse(string text)
    {
        var m = JsonSerializer.Deserialize<WidgetManifest>(text, Json) ?? throw new JsonException("widget.json is empty");
        // Settings shows options in the order they are written in widget.json.
        using (var doc = JsonDocument.Parse(text))
        {
            if (doc.RootElement.TryGetProperty("options", out var opts) && opts.ValueKind == JsonValueKind.Object)
                m.OptionOrder = opts.EnumerateObject().Select(p => p.Name).ToList();
            // Commands are strict: any problem fails the whole widget rather than loading a half-understood command.
            if (doc.RootElement.TryGetProperty("permissions", out var perms) && perms.ValueKind == JsonValueKind.Object
                && perms.TryGetProperty("commands", out var cmds))
                CommandSpec.CheckKeys(cmds);
        }
        m.Changelog = SanitizeChangelog(m.Changelog);
        CommandSpec.ValidateAll(m.Permissions.Commands);
        SystemMetrics.Validate(m.Permissions.System);
        MediaService.Validate(m.Permissions.Media);
        return m;
    }

    internal static List<WidgetManifest> Discover(string root, WidgetSource source)
    {
        var list = new List<WidgetManifest>();
        if (!Directory.Exists(root)) return list;
        foreach (var dir in Directory.GetDirectories(root).OrderBy(d => d))
        {
            var file = Path.Combine(dir, "widget.json");
            if (!File.Exists(file)) continue;
            try
            {
                var m = Parse(File.ReadAllText(file));
                if (!IdPattern().IsMatch(m.Id)) continue;
                m.Folder = Path.GetFileName(dir);
                m.Source = source;
                list.Add(m);
            }
            catch (Exception ex)
            {
                Log.Write($"Skipping widget {dir}: {ex.Message}");
            }
        }
        return list;
    }

    /// <summary>Default value for every option declared in the manifest.</summary>
    public JsonObject DefaultOptions()
    {
        var o = new JsonObject();
        foreach (var (key, spec) in Options)
            o[key] = spec?["default"]?.DeepClone();
        return o;
    }

    public bool AllowsHost(string host) =>
        Permissions.Hosts.Any(h => string.Equals(h, host, StringComparison.OrdinalIgnoreCase));

    public bool AllowsUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u)
        && u.Scheme == Uri.UriSchemeHttps
        && AllowsHost(u.Host);
}
