using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Per-widget key/value storage (umbra.store in the SDK): %APPDATA%\Umbra\data\&lt;id&gt;.json.
/// Widgets share one origin, so localStorage is not private to a widget; this is.
/// Values are any JSON. Each widget is capped at <see cref="MaxBytes"/>; writes are atomic.
/// </summary>
static class WidgetStore
{
    public const int MaxBytes = 1024 * 1024;
    public const int MaxKeyLength = 200;

    static readonly object Gate = new();

    static string DataDir
    {
        get
        {
            var d = Path.Combine(AppPaths.DataDir, "data");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    static string FileFor(string id)
    {
        if (!InstanceId.IsValid(id)) throw new InvalidOperationException($"Invalid widget id '{id}'");
        return Path.Combine(DataDir, $"{InstanceId.FileName(id)}.json");
    }

    static void CheckKey(string key)
    {
        if (string.IsNullOrEmpty(key) || key.Length > MaxKeyLength)
            throw new InvalidOperationException($"Keys must be 1-{MaxKeyLength} characters");
    }

    /// <summary>Everything the widget has stored (a copy).</summary>
    public static JsonObject All(string id)
    {
        lock (Gate) return Load(id);
    }

    /// <summary>The stored value, or found = false when the key was never set.</summary>
    public static (bool Found, JsonNode? Value) Get(string id, string key)
    {
        CheckKey(key);
        lock (Gate)
        {
            var data = Load(id);
            return data.TryGetPropertyValue(key, out var v) ? (true, v?.DeepClone()) : (false, null);
        }
    }

    public static void Set(string id, string key, JsonNode? value)
    {
        CheckKey(key);
        lock (Gate)
        {
            var data = Load(id);
            data[key] = value?.DeepClone();
            Save(id, data);
        }
    }

    /// <summary>Returns true when the key existed.</summary>
    public static bool Remove(string id, string key)
    {
        CheckKey(key);
        lock (Gate)
        {
            var data = Load(id);
            if (!data.Remove(key)) return false;
            Save(id, data);
            return true;
        }
    }

    public static string[] Keys(string id)
    {
        lock (Gate) return Load(id).Select(kv => kv.Key).ToArray();
    }

    /// <summary>Deletes all of a widget's data (on uninstall, or umbractl data --clear).</summary>
    public static void Delete(string id)
    {
        lock (Gate)
        {
            var file = FileFor(id);
            if (File.Exists(file)) File.Delete(file);
        }
    }

    internal static bool IsCopyOf(string fileName, string widgetId) =>
        fileName.StartsWith(widgetId + "__") && System.Text.RegularExpressions.Regex.IsMatch(fileName[(widgetId.Length + 2)..], @"^[0-9]+$");

    /// <summary>Instance ids ("sp500#2") of every extra-copy data file on disk.</summary>
    public static List<string> CopyIds()
    {
        lock (Gate)
            return Directory.GetFiles(DataDir, "*__*.json").Select(f => Path.GetFileNameWithoutExtension(f).Replace("__", "#"))
                .Where(i => InstanceId.IsValid(i) && InstanceId.IsExtra(i)).ToList();
    }

    /// <summary>Deletes the data of a widget and of all its extra copies (on uninstall).</summary>
    public static void DeleteAll(string widgetId)
    {
        if (!WidgetManifest.IdPattern().IsMatch(widgetId)) return;
        lock (Gate)
        {
            foreach (var file in Directory.GetFiles(DataDir, $"{widgetId}*.json"))
            {
                var name = Path.GetFileNameWithoutExtension(file);
                if (name == widgetId || IsCopyOf(name, widgetId))
                    File.Delete(file);
            }
        }
    }

    static JsonObject Load(string id)
    {
        var file = FileFor(id);
        if (!File.Exists(file)) return new JsonObject();
        try
        {
            return JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? new JsonObject();
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            // Keep the unreadable file for inspection instead of silently overwriting it.
            var bad = file + ".corrupt";
            try { File.Move(file, bad, overwrite: true); } catch { }
            Log.Write($"[{id}] stored data unreadable, moved to {Path.GetFileName(bad)}: {ex.Message}");
            return new JsonObject();
        }
    }

    static void Save(string id, JsonObject data)
    {
        var json = data.ToJsonString();
        if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxBytes)
            throw new InvalidOperationException($"Storage limit reached: a widget can store up to {MaxBytes / 1024} KB");
        var file = FileFor(id);
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, file, overwrite: true);
    }
}
