
namespace Umbra;

/// <summary>
/// Read-only machine totals for <c>umbra.system()</c>: CPU load, memory and network throughput. Numbers only: no process,
/// adapter or user names. A widget gets only the kinds it declared in <c>permissions.system</c>.
/// </summary>
public static class SystemMetrics
{
    public static readonly string[] Kinds = ["cpu", "memory", "network"];

    /// <summary>Throws when the list holds anything but the known kinds.</summary>
    public static void Validate(IEnumerable<string> kinds)
    {
        foreach (var k in kinds)
            if (!Kinds.Contains(k)) throw new InvalidOperationException($"permissions.system: unknown metric '{k}' (allowed: {string.Join(", ", Kinds)})");
    }
}
