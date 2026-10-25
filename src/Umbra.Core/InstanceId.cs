using System.Text.RegularExpressions;

namespace Umbra;

/// <summary>
/// A widget can run several times. The first copy keeps the plain widget id ("sp500", so old settings and
/// stored data stay valid); extra copies are "sp500#2", "sp500#3"... Settings, windows and umbra.store data
/// are all keyed by this instance id.
/// </summary>
public static partial class InstanceId
{
    public const int MaxInstances = 20;

    [GeneratedRegex("^(?<id>[a-z0-9][a-z0-9-]{1,39})(?:#(?<n>[2-9]|[1-9][0-9]))?$")]
    private static partial Regex Pattern();

    public static bool IsValid(string instance) => Pattern().IsMatch(instance);

    /// <summary>The widget (folder) id behind an instance id; the input unchanged when it has no suffix.</summary>
    public static string WidgetOf(string instance)
    {
        var m = Pattern().Match(instance);
        return m.Success ? m.Groups["id"].Value : instance;
    }

    /// <summary>2 and up for extra copies, 1 for the first copy.</summary>
    public static int NumberOf(string instance)
    {
        var m = Pattern().Match(instance);
        return m.Success && m.Groups["n"].Success ? int.Parse(m.Groups["n"].Value) : 1;
    }

    public static bool IsExtra(string instance) => NumberOf(instance) > 1;

    /// <summary>A label for one copy of a widget: its name, plus the copy number for extra copies ("Clock (2)").</summary>
    public static string Label(WidgetManifest m, string instance) =>
        IsExtra(instance) ? $"{m.Name} ({NumberOf(instance)})" : m.Name;

    public static string Make(string widgetId, int number) => number <= 1 ? widgetId : $"{widgetId}#{number}";

    /// <summary>A file-name-safe form ("sp500#2" becomes "sp500__2"; ids never contain underscores).</summary>
    public static string FileName(string instance) => instance.Replace("#", "__");
}
