using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// An extra widget copy that was just removed, kept in memory so "Remove" in the widget menu can be undone
/// (settings and stored data). One level only, never saved: it is gone when Umbra exits.
/// </summary>
sealed record RemovedCopy(string Instance, string Label, WidgetSettings Settings, JsonObject Data)
{
    /// <summary>False once the same instance id was taken again (a new copy reused the number) or the widget is at its copy limit.</summary>
    public bool CanRestore(Settings current) =>
        InstanceId.IsValid(Instance) && InstanceId.IsExtra(Instance) && !current.Widgets.ContainsKey(Instance)
        && current.Instances(InstanceId.WidgetOf(Instance)).Count < InstanceId.MaxInstances;

    /// <summary>Puts the copy's settings back (position, size, options); the caller restores the data file and the window.</summary>
    public void Restore(Settings current)
    {
        if (!CanRestore(current)) throw new InvalidOperationException($"'{Instance}' can't be restored");
        current.Widgets[Instance] = Settings;
    }
}
