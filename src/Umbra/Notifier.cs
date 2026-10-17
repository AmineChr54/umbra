namespace Umbra;

/// <summary>
/// Rules for <c>umbra.notify</c>: a widget needs <c>permissions.notifications</c> and the user's per-widget switch, is
/// limited to <see cref="MaxPerWindow"/> notifications per <see cref="Window"/>, and the text is length-capped.
/// </summary>
public sealed class Notifier
{
    public const int MaxPerWindow = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);
    public const int MaxTitle = 80, MaxBody = 200;

    readonly Dictionary<string, Queue<DateTime>> _sent = new();

    /// <summary>True (and the attempt is recorded) when <paramref name="instance"/> may notify at <paramref name="now"/>.</summary>
    public bool TryAcquire(string instance, DateTime now)
    {
        if (!_sent.TryGetValue(instance, out var q)) _sent[instance] = q = new Queue<DateTime>();
        while (q.Count > 0 && now - q.Peek() >= Window) q.Dequeue();
        if (q.Count >= MaxPerWindow) return false;
        q.Enqueue(now);
        return true;
    }

    /// <summary>Single-line, trimmed, capped text; control characters become spaces.</summary>
    public static string Clean(string? s, int max)
    {
        s = new string((s ?? "").Select(c => char.IsControl(c) ? ' ' : c).ToArray()).Trim();
        return s.Length <= max ? s : s[..(max - 1)] + "…";
    }
}
