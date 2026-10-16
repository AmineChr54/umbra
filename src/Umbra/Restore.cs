namespace Umbra;

/// <summary>
/// Startup migration for widgets that used to ship inside the app (the S&amp;P 500 card) and are now installed
/// from the community catalog: enabled widgets in settings.json whose folder is gone are fetched again.
/// </summary>
static class Restore
{
    /// <summary>At most this many widgets are restored per start.</summary>
    public const int MaxPerStart = 5;

    /// <summary>
    /// Widget ids to reinstall: enabled first copies in <paramref name="settings"/> that have no discovered manifest.
    /// With <paramref name="catalogIds"/> set, ids that are not in the catalog are skipped. Capped at <paramref name="max"/>.
    /// </summary>
    public static List<string> ToRestore(Settings settings, IEnumerable<WidgetManifest> manifests,
        IReadOnlyCollection<string>? catalogIds = null, int max = MaxPerStart)
    {
        var have = manifests.Select(m => m.Id).ToHashSet();
        return settings.Widgets
            .Where(kv => kv.Value.Enabled
                         && !InstanceId.IsExtra(kv.Key)
                         && WidgetManifest.IdPattern().IsMatch(kv.Key)
                         && !have.Contains(kv.Key)
                         && (catalogIds is null || catalogIds.Contains(kv.Key)))
            .Select(kv => kv.Key)
            .Take(max)
            .ToList();
    }
}
