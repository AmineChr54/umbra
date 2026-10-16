using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// The community catalog. Widgets are contributed by pull request to the repo's widgets/ folder;
/// a GitHub Action validates them and regenerates widgets/index.json on merge. Umbra reads that
/// index and installs widgets file by file into %APPDATA%\Umbra\widgets\&lt;id&gt;.
/// </summary>
static class Community
{
    public const string Repo = "AmineChr54/umbra";
    public const string Branch = "main";

    static string RawBase =>
        Environment.GetEnvironmentVariable("UMBRA_CATALOG_BASE")?.TrimEnd('/')
        ?? $"https://raw.githubusercontent.com/{Repo}/{Branch}/widgets";

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".json", ".html", ".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".woff", ".woff2", ".ttf", ".otf", ".txt", ".md",
    };

    const long MaxWidgetBytes = 5 * 1024 * 1024;

    static async Task<byte[]> GetBytes(string relative)
    {
        var url = $"{RawBase}/{relative}";
        // A local folder (file:///...) can stand in for GitHub when testing a catalog before pushing.
        if (url.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            return await File.ReadAllBytesAsync(new Uri(url.Split('?')[0]).LocalPath);
        return await Http.GetByteArrayAsync(url);
    }

    /// <summary>Downloads widgets/index.json. Each entry: id, name, description, author, version, hosts, preview, files[].</summary>
    public static async Task<JsonArray> FetchCatalogAsync()
    {
        var bytes = await GetBytes($"index.json?t={DateTime.UtcNow.Ticks}");
        var root = JsonNode.Parse(bytes);
        return root?["widgets"] as JsonArray ?? new JsonArray();
    }

    /// <summary>Preview image as a data: URL, so the Settings page never hot-links remote files.</summary>
    public static async Task<string?> PreviewDataUrlAsync(string id, string file)
    {
        try
        {
            var bytes = await GetBytes($"{id}/{file}");
            var mime = Path.GetExtension(file).ToLowerInvariant() switch
            {
                ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp",
                ".gif" => "image/gif", ".svg" => "image/svg+xml", _ => null,
            };
            return mime is null || bytes.Length > 1_000_000 ? null : $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch { return null; }
    }

    /// <summary>Installs or updates one widget. Everything is downloaded to a temp folder and validated first.</summary>
    public static async Task InstallAsync(JsonNode entry)
    {
        var id = entry["id"]?.GetValue<string>() ?? "";
        if (!WidgetManifest.IdPattern().IsMatch(id)) throw new InvalidOperationException($"Invalid widget id '{id}'");
        var files = (entry["files"] as JsonArray)?.Select(f => f?.GetValue<string>() ?? "").ToList() ?? new();
        if (!files.Contains("widget.json")) throw new InvalidOperationException("Catalog entry has no widget.json");

        var staging = Path.Combine(Path.GetTempPath(), $"umbra-{id}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            long total = 0;
            foreach (var rel in files)
            {
                if (!IsSafeRelativePath(rel)) throw new InvalidOperationException($"Unsafe file path '{rel}'");
                var data = await GetBytes($"{id}/{rel}");
                total += data.Length;
                if (total > MaxWidgetBytes) throw new InvalidOperationException("Widget is larger than 5 MB");
                var dest = Path.Combine(staging, rel.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                await File.WriteAllBytesAsync(dest, data);
            }

            var manifest = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(staging, "widget.json")));
            if (manifest?["id"]?.GetValue<string>() != id)
                throw new InvalidOperationException("widget.json id does not match the catalog");

            Commit(staging, id);
            Log.Write($"Installed community widget {id} {entry["version"]}");
        }
        finally
        {
            try { Directory.Delete(staging, recursive: true); } catch { }
        }
    }

    static readonly HashSet<string> BinaryExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff", ".woff2", ".ttf", ".otf",
    };

    /// <summary>
    /// Writes a widget authored locally (umbractl create-widget, MCP create_widget) into the community folder.
    /// Same rules as a catalog install: safe relative paths, allowed file types, 5 MB, widget.json id = folder.
    /// Text files are passed as text, binary files (images, fonts) as base64.
    /// </summary>
    public static string WriteLocalWidget(string id, IReadOnlyDictionary<string, string> files, bool overwrite)
    {
        if (!WidgetManifest.IdPattern().IsMatch(id)) throw new InvalidOperationException($"Invalid widget id '{id}': use 2-40 lowercase letters, digits and dashes");
        if (!files.ContainsKey("widget.json")) throw new InvalidOperationException("files must include widget.json");
        var target = Path.Combine(AppPaths.CommunityDir, id);
        if (Directory.Exists(target) && !overwrite) throw new InvalidOperationException($"Widget '{id}' already exists; pass overwrite=true to replace it");

        var manifest = WidgetManifest.Parse(files["widget.json"]);
        if (manifest.Id != id) throw new InvalidOperationException($"widget.json id is '{manifest.Id}', expected '{id}'");
        if (!files.ContainsKey(manifest.Entry)) throw new InvalidOperationException($"Entry file '{manifest.Entry}' is missing from files");

        var staging = Path.Combine(Path.GetTempPath(), $"umbra-{id}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            long total = 0;
            foreach (var (rel, content) in files)
            {
                if (!IsSafeRelativePath(rel)) throw new InvalidOperationException($"Unsafe or disallowed file path '{rel}'");
                byte[] data;
                try { data = BinaryExtensions.Contains(Path.GetExtension(rel)) ? Convert.FromBase64String(content) : System.Text.Encoding.UTF8.GetBytes(content); }
                catch (FormatException) { throw new InvalidOperationException($"'{rel}' is a binary file and must be base64"); }
                total += data.Length;
                if (total > MaxWidgetBytes) throw new InvalidOperationException("Widget is larger than 5 MB");
                var dest = Path.Combine(staging, rel.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                File.WriteAllBytes(dest, data);
            }
            Commit(staging, id);
            Log.Write($"Wrote local widget {id} ({files.Count} files)");
            return target;
        }
        finally
        {
            try { Directory.Delete(staging, recursive: true); } catch { }
        }
    }

    /// <summary>Replaces the widget's community folder with a fully validated staging folder.</summary>
    static void Commit(string staging, string id)
    {
        var target = Path.Combine(AppPaths.CommunityDir, id);
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
        CopyDirectory(staging, target);
    }

    public static void Remove(string id)
    {
        if (!WidgetManifest.IdPattern().IsMatch(id)) return;
        var target = Path.Combine(AppPaths.CommunityDir, id);
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
        WidgetStore.DeleteAll(id);
        Log.Write($"Removed community widget {id}");
    }

    /// <summary>Relative, forward-slash, no "..", no drive letters, allowed file types only.</summary>
    internal static bool IsSafeRelativePath(string rel)
    {
        if (string.IsNullOrWhiteSpace(rel) || rel.Contains('\\') || rel.Contains(':') || rel.StartsWith('/')) return false;
        if (rel.Split('/').Any(p => p is "" or "." or "..")) return false;
        return AllowedExtensions.Contains(Path.GetExtension(rel));
    }

    static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
        {
            var dest = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.Copy(file, dest, overwrite: true);
        }
    }

    /// <summary>Semantic-ish version compare ("1.2.0" &gt; "1.10.0" is handled numerically).</summary>
    public static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v) => v.Split('.', '-').Take(3).Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        var pa = Parts(a); var pb = Parts(b);
        for (int i = 0; i < 3; i++)
        {
            var x = i < pa.Length ? pa[i] : 0; var y = i < pb.Length ? pb[i] : 0;
            if (x != y) return x.CompareTo(y);
        }
        return 0;
    }
}
