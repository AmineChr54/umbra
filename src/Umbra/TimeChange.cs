using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Helpers for "the system time or time zone changed" (umbra.onTimeChanged in the SDK). The host drops .NET's cached
/// zone data first, so anything it reads afterwards sees the new zone.
/// </summary>
static class TimeChange
{
    /// <summary>Reloads the zone from Windows and returns its identity (zone id plus current UTC offset), to tell a real zone change from other settings changes.</summary>
    public static string Signature()
    {
        TimeZoneInfo.ClearCachedData();
        var zone = TimeZoneInfo.Local;
        return $"{zone.Id}|{zone.GetUtcOffset(DateTime.UtcNow).Ticks}";
    }

    /// <summary>True when the zone moved since <paramref name="last"/>; a first reading (null) is never a change.</summary>
    public static bool ZoneChanged(string? last, string current) => last is not null && last != current;

    /// <summary>The message widgets receive; the page decides what to recompute.</summary>
    public static JsonObject Message() => new() { ["type"] = "timeChanged" };
}
