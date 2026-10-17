using System.Net.NetworkInformation;
using Microsoft.Win32;

namespace Umbra;

/// <summary>
/// Pure scheduling for event-driven refreshes: requests are coalesced into one refresh and two refreshes are never
/// closer than <see cref="MinGap"/>. A request that arrives inside the gap is deferred to its end rather than dropped,
/// so a "network is back" right after the resume refresh still gets its retry.
/// </summary>
sealed class RefreshCoalescer
{
    public static readonly TimeSpan MinGap = TimeSpan.FromSeconds(10);

    DateTime? _last;
    DateTime? _due;
    readonly List<string> _reasons = new();

    /// <summary>Registers a trigger that wants a refresh after <paramref name="delay"/>; returns when it is due.</summary>
    public DateTime Request(string reason, TimeSpan delay, DateTime now)
    {
        var due = now + delay;
        if (_last is { } l && due < l + MinGap) due = l + MinGap;
        if (_due is null || due < _due) _due = due;
        if (!_reasons.Contains(reason)) _reasons.Add(reason);
        return _due.Value;
    }

    /// <summary>Returns the joined trigger names once the request is due (and starts the gap), otherwise null.</summary>
    public string? Take(DateTime now)
    {
        if (_due is null || now < _due) return null;
        var reasons = string.Join(" + ", _reasons);
        _reasons.Clear();
        _due = null;
        _last = now;
        return reasons;
    }

    /// <summary>When the pending refresh is due, or null when nothing is waiting.</summary>
    public DateTime? Due => _due;
}

/// <summary>
/// Refreshes the widgets when the PC wakes from sleep, the network comes back, or the session is unlocked after a
/// while, so they don't show stale data (or a stale error) until the next timer tick. Self-contained: App only
/// constructs it with a "refresh all" callback and disposes it.
/// </summary>
sealed class WakeRefresh : IDisposable
{
    /// <summary>Wi-Fi often isn't up yet right after resume; wait a little before the first attempt.</summary>
    internal static readonly TimeSpan ResumeDelay = TimeSpan.FromSeconds(3);
    internal static readonly TimeSpan NetworkDelay = TimeSpan.FromSeconds(2);
    internal static readonly TimeSpan UnlockDelay = TimeSpan.FromSeconds(1);

    readonly SynchronizationContext _ui;
    readonly Action<string> _refreshAll;
    readonly Func<int> _intervalSeconds;
    readonly RefreshCoalescer _coalescer = new();
    readonly System.Windows.Forms.Timer _timer = new();
    DateTime? _lockedAt;

    /// <param name="ui">The UI thread's context; the system events arrive on other threads.</param>
    /// <param name="refreshAll">Runs on the UI thread with the trigger names.</param>
    /// <param name="intervalSeconds">The refresh interval; an unlock refreshes only after a lock at least this long.</param>
    public WakeRefresh(SynchronizationContext ui, Action<string> refreshAll, Func<int> intervalSeconds)
    {
        _ui = ui;
        _refreshAll = refreshAll;
        _intervalSeconds = intervalSeconds;
        _timer.Tick += (_, _) => Fire();
        SystemEvents.PowerModeChanged += OnPower;
        SystemEvents.SessionSwitch += OnSession;
        NetworkChange.NetworkAvailabilityChanged += OnNetwork;
    }

    // These events arrive on system threads; everything they trigger runs on the UI thread.
    void OnPower(object? s, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Resume) _ui.Post(_ => Request("resume", ResumeDelay), null);
    }

    void OnNetwork(object? s, NetworkAvailabilityEventArgs e)
    {
        if (e.IsAvailable) _ui.Post(_ => Request("network", NetworkDelay), null);
    }

    void OnSession(object? s, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionLock) _ui.Post(_ => _lockedAt = DateTime.Now, null);
        else if (e.Reason == SessionSwitchReason.SessionUnlock) _ui.Post(_ => Unlocked(), null);
    }

    void Unlocked()
    {
        var since = _lockedAt;
        _lockedAt = null;
        if (since is { } t && (DateTime.Now - t).TotalSeconds >= _intervalSeconds()) Request("unlock", UnlockDelay);
    }

    void Request(string reason, TimeSpan delay)
    {
        var now = DateTime.Now;
        Arm(_coalescer.Request(reason, delay, now), now);
    }

    void Arm(DateTime due, DateTime now)
    {
        _timer.Stop();
        _timer.Interval = (int)Math.Clamp((due - now).TotalMilliseconds, 1, int.MaxValue);
        _timer.Start();
    }

    void Fire()
    {
        _timer.Stop();
        var now = DateTime.Now;
        if (_coalescer.Take(now) is { } reasons) _refreshAll(reasons);
        else if (_coalescer.Due is { } due) Arm(due, now); // the timer fired a few ms early
    }

    public void Dispose()
    {
        SystemEvents.PowerModeChanged -= OnPower;
        SystemEvents.SessionSwitch -= OnSession;
        NetworkChange.NetworkAvailabilityChanged -= OnNetwork;
        _timer.Dispose();
    }
}
