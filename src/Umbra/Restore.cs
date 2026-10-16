using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// One-time startup migration for widgets that used to ship inside the app and are now catalog widgets:
/// a fixed legacy list is fetched again, once, for users who had them enabled. Removing a widget deletes its
/// settings entry, so nothing the user removed is ever reinstalled.
/// </summary>
static class Restore
{
    /// <summary>The only ids ever restored (never arbitrary catalog ids).</summary>
    public static readonly string[] LegacyIds = { "sp500" };

    /// <summary>Legacy ids that are enabled in settings and have no manifest. Empty once the migration is marked done.</summary>
    public static List<string> ToRestore(Settings settings, IEnumerable<WidgetManifest> manifests)
    {
        if (settings.General.LegacyRestoreDone) return new();
        var have = manifests.Select(m => m.Id).ToHashSet();
        return LegacyIds
            .Where(id => settings.Widgets.TryGetValue(id, out var ws) && ws.Enabled && !have.Contains(id))
            .ToList();
    }

    /// <summary>Result of one restore attempt: what was installed, and whether the migration can be marked done.</summary>
    public sealed record Result(List<string> Installed, bool Done);

    /// <summary>
    /// One attempt. <paramref name="pending"/> is called before the download and again right before each install
    /// (it must read live state, on the UI thread). Done is false when the catalog or an install failed, so the
    /// next start retries.
    /// </summary>
    public static async Task<Result> RunAsync(Func<Task<List<string>>> pending, Func<Task<JsonArray>> fetchCatalog,
        Func<JsonNode, Task> install, Action<string> log)
    {
        var installed = new List<string>();
        if ((await pending()).Count == 0) return new(installed, true);
        JsonArray catalog;
        try { catalog = await fetchCatalog(); }
        catch (Exception ex)
        {
            log($"Restore skipped, could not load the catalog: {ex.Message}");
            return new(installed, false);
        }
        var entries = new Dictionary<string, JsonNode>();
        foreach (var e in catalog)
            if (e?["id"] is JsonValue v && v.TryGetValue<string>(out var id)) entries.TryAdd(id, e);

        var ok = true;
        foreach (var id in LegacyIds)
        {
            if (!(await pending()).Contains(id)) continue; // present again, disabled or removed meanwhile
            if (!entries.TryGetValue(id, out var entry)) { log($"Restore of {id}: not in the catalog"); ok = false; continue; }
            try { await install(entry); installed.Add(id); }
            catch (Exception ex) { log($"Restore of {id} failed to install: {ex.Message}"); ok = false; }
        }
        return new(installed, ok);
    }

    /// <summary>Ids (settings keys, store copies) whose widget has no manifest and is not about to be restored.</summary>
    public static List<string> Orphans(IEnumerable<string> ids, IReadOnlyCollection<string> widgetIds, ISet<string> restoring) =>
        ids.Where(i => !widgetIds.Contains(InstanceId.WidgetOf(i)) && !restoring.Contains(InstanceId.WidgetOf(i))).ToList();
}
