namespace Umbra;

/// <summary>What a widget window does about a failed web process (Windows: <c>WebView2Crash.Classify</c>).</summary>
enum CrashReaction
{
    /// <summary>Only log it (a hung renderer too: it may recover on its own, and a reload would lose widget state; GPU, utility and sandbox processes restart on their own; a frame crash leaves the page up).</summary>
    Ignore,
    /// <summary>The page's renderer exited: reload the page.</summary>
    Reload,
    /// <summary>The browser process died: the whole WebView2 (and its environment) has to be created again.</summary>
    RecreateBrowser,
}

/// <summary>
/// Recovery policy for a failed widget web process, one instance per widget window: at most
/// <see cref="MaxRecoveries"/> automatic recoveries per <see cref="Window"/>, so a crash loop ends in a
/// "This widget stopped working" page instead of burning CPU. Pure logic (the window supplies the clock) so it is testable.
/// </summary>
sealed class CrashRecovery
{
    public const int MaxRecoveries = 3;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    readonly Queue<long> _at = new();

    /// <summary>Spends one recovery if the budget allows (<paramref name="nowMs"/> is a monotonic millisecond clock); false means give up.</summary>
    public bool TryAcquire(long nowMs)
    {
        while (_at.Count > 0 && nowMs - _at.Peek() >= (long)Window.TotalMilliseconds) _at.Dequeue();
        if (_at.Count >= MaxRecoveries) return false;
        _at.Enqueue(nowMs);
        return true;
    }

    /// <summary>Recoveries used inside the current window (after the last <see cref="TryAcquire"/>).</summary>
    public int Used => _at.Count;

    /// <summary>The user pressed Reload on the error page: start over with a full budget.</summary>
    public void Reset() => _at.Clear();

    // ---------- widgets that gave up (shown on Settings > Data & privacy) ----------

    static readonly HashSet<string> Stopped = new();

    public static void SetStopped(string instance, bool stopped)
    {
        lock (Stopped) { if (stopped) Stopped.Add(instance); else Stopped.Remove(instance); }
    }

    /// <summary>True while any copy of the widget shows the "stopped working" page.</summary>
    public static bool IsStopped(string widgetId)
    {
        lock (Stopped) return Stopped.Any(i => InstanceId.WidgetOf(i) == widgetId);
    }

    /// <summary>Log line prefix that Data &amp; privacy counts (see <see cref="Backup.Privacy"/>).</summary>
    public const string LogMarker = "widget process failed";

    /// <summary>
    /// Matches only a log line the host wrote itself: <c>yyyy-MM-dd HH:mm:ss  [instance] widget process failed</c> at the start of
    /// the line, so a widget-controlled string inside another log line cannot forge a crash. Group 1 is the instance id.
    /// </summary>
    public static readonly System.Text.RegularExpressions.Regex LogLine = new(
        @"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}  \[([^\]]+)\] " + System.Text.RegularExpressions.Regex.Escape(LogMarker) + ":",
        System.Text.RegularExpressions.RegexOptions.Compiled);
}
