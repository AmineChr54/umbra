using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>A timelapse request the host refuses (bad numbers, no permission, camera unavailable). The message is shown to the widget.</summary>
public sealed class TimelapseException(string message) : Exception(message);

/// <summary>
/// The arithmetic of one timelapse (<c>umbra.timelapse</c>): a webcam still every <see cref="Interval"/>, played back at
/// <see cref="Fps"/> for a video of <see cref="Length"/>. Pure, so it is unit tested; <see cref="TimelapseService"/> runs it.
/// </summary>
public sealed record TimelapsePlan(TimeSpan Interval, TimeSpan Length, int Fps)
{
    /// <summary>No recording session runs longer than this; the service stops (and renders) at the cap.</summary>
    public static readonly TimeSpan MaxSession = TimeSpan.FromHours(12);
    public const double MinIntervalSeconds = 1, MaxIntervalSeconds = 3600, MaxLengthSeconds = 3600;
    public const int MinFps = 1, MaxFps = 60;
    /// <summary>At most this many stills per video (2 min at 30 fps): keeps the stills folder and the render bounded.</summary>
    public const int MaxFrames = 3600;
    /// <summary>Disk budget per still (a 1280x720 JPEG is about 100-250 KB) and for the video itself.</summary>
    public const long StillBytes = 400_000, VideoReserveBytes = 200_000_000;
    /// <summary>Recording stops (and renders) when the stills drive has less than this left.</summary>
    public const long MinFreeBytes = 300_000_000;

    /// <summary>Free space needed before a session may start: every still plus room for the video.</summary>
    public long DiskNeeded => Frames * StillBytes + VideoReserveBytes;

    /// <summary>Stills needed for the requested video length (rounded up to a whole frame).</summary>
    public int Frames => (int)Math.Ceiling(Length.TotalSeconds * Fps - 1e-9);

    /// <summary>Recording time from the first still to the last (the first is taken at once).</summary>
    public TimeSpan Session => Interval * (Frames - 1);

    /// <summary>Validates widget-supplied numbers. Everything out of range is refused rather than clamped, so the widget learns why.</summary>
    public static TimelapsePlan Create(double intervalSeconds, double lengthSeconds, double fps)
    {
        if (!double.IsFinite(intervalSeconds) || intervalSeconds < MinIntervalSeconds || intervalSeconds > MaxIntervalSeconds)
            throw new TimelapseException($"interval must be between {MinIntervalSeconds} and {MaxIntervalSeconds} seconds");
        if (!double.IsFinite(lengthSeconds) || lengthSeconds <= 0 || lengthSeconds > MaxLengthSeconds)
            throw new TimelapseException($"length must be more than 0 and at most {MaxLengthSeconds} seconds of video");
        if (!double.IsFinite(fps) || fps != Math.Floor(fps) || fps < MinFps || fps > MaxFps)
            throw new TimelapseException($"fps must be a whole number between {MinFps} and {MaxFps}");
        var plan = new TimelapsePlan(TimeSpan.FromSeconds(intervalSeconds), TimeSpan.FromSeconds(lengthSeconds), (int)fps);
        if (plan.Frames > MaxFrames)
            throw new TimelapseException($"That needs {plan.Frames} stills; the maximum is {MaxFrames}. Use a shorter video or a lower fps.");
        if (plan.Session > MaxSession)
            throw new TimelapseException($"That needs {plan.Frames} stills, {plan.Session.TotalHours:0.#} h of recording; the maximum is {MaxSession.TotalHours:0} h. Use a shorter interval or a shorter video.");
        return plan;
    }

    /// <summary>
    /// When the next still is due after the one due at <paramref name="previousDue"/>. Normally one interval later; when
    /// the PC slept or the camera stalled past a whole interval, the schedule restarts at <paramref name="now"/> instead of
    /// taking a burst of catch-up stills (the video keeps its frame count; recording simply ends later, within the 12 h cap).
    /// </summary>
    public static DateTime NextDue(DateTime previousDue, TimeSpan interval, DateTime now)
    {
        var next = previousDue + interval;
        return now > next + interval ? now : next;
    }

    /// <summary>
    /// How long still <paramref name="index"/> is shown in the video: the gap between its start and the next one's, with
    /// both rounded to 100 ns ticks, so <paramref name="count"/> stills add up to exactly count / fps seconds (no drift).
    /// </summary>
    public TimeSpan ClipDuration(int index) => TimeSpan.FromTicks(StartTicks(index + 1) - StartTicks(index));

    long StartTicks(int index) => (long)Math.Round((double)index * TimeSpan.TicksPerSecond / Fps, MidpointRounding.AwayFromZero);

    /// <summary>Video length for <paramref name="frames"/> stills (shorter than <see cref="Length"/> when stopped early).</summary>
    public TimeSpan VideoLength(int frames) => TimeSpan.FromTicks(StartTicks(frames));

    /// <summary>"Timelapse 2026-10-24 14-05.mp4", or "... (2).mp4" and up when that name is taken.</summary>
    public static string OutputPath(string folder, DateTime localStart, Func<string, bool> exists)
    {
        var stem = $"Timelapse {localStart:yyyy-MM-dd HH-mm}";
        var path = Path.Combine(folder, stem + ".mp4");
        for (var n = 2; exists(path); n++) path = Path.Combine(folder, $"{stem} ({n}).mp4");
        return path;
    }

    /// <summary>The still file for frame <paramref name="index"/> inside a session folder (zero-padded, so they sort).</summary>
    public static string FramePath(string sessionDir, int index) => Path.Combine(sessionDir, $"{index:D6}.jpg");

    public JsonObject ToJson() => new()
    {
        ["intervalSeconds"] = Interval.TotalSeconds,
        ["lengthSeconds"] = Length.TotalSeconds,
        ["fps"] = Fps,
        ["frames"] = Frames,
        ["sessionSeconds"] = Session.TotalSeconds,
    };
}

/// <summary>
/// Which clicks may start the camera: a physical left-button press that began on the widget (WM_PARENTNOTIFY for a press
/// on the page, WM_MOUSEACTIVATE for one on the host's own surface; both report the button and neither can come from the
/// page), within the last 2 s, outside edit mode, and not followed by the host's right-click menu.
/// Right-clicks, edit-mode drags and resizes therefore never count. Pure, so it is unit tested.
/// </summary>
static class ClickGate
{
    public const int WM_LBUTTONDOWN = 0x0201;
    public const long WindowMs = 2000;

    /// <summary>The mouse message inside WM_MOUSEACTIVATE's lParam (high word) is a left-button press.</summary>
    public static bool IsLeftPress(IntPtr lParam) => (int)(((long)lParam >> 16) & 0xFFFF) == WM_LBUTTONDOWN;

    /// <summary>The event inside WM_PARENTNOTIFY's wParam (low word) is a left-button press on a child window.</summary>
    public static bool IsLeftPressNotify(IntPtr wParam) => (int)((long)wParam & 0xFFFF) == WM_LBUTTONDOWN;

    /// <param name="leftPressAt">Tick of the last left press outside edit mode.</param>
    /// <param name="menuAt">Tick the host menu last opened on this widget.</param>
    public static bool Allows(long leftPressAt, long menuAt, long now, bool editMode) =>
        !editMode && now - leftPressAt is >= 0 and <= WindowMs && menuAt < leftPressAt;
}

/// <summary>
/// The one-time camera approval per widget id, in the style of command approvals: asked with a host-drawn prompt only
/// after a physical click on that widget, one prompt at a time, at most one per <see cref="MinPromptInterval"/> per widget,
/// and not after <see cref="MaxDenials"/> refusals. Stored in approvals.json (<see cref="CommandApprovals.ApproveCamera"/>);
/// automation can only read it, Settings can revoke it, and it is dropped when the widget stops declaring permissions.camera.
/// </summary>
sealed class CameraConsent(CommandApprovals approvals, Func<string, Task<bool>> prompt, Func<DateTime>? now = null)
{
    public const int MaxDenials = 3;
    public TimeSpan MinPromptInterval { get; set; } = TimeSpan.FromSeconds(20);

    readonly Func<DateTime> _now = now ?? (() => DateTime.UtcNow);
    readonly object _gate = new();
    readonly Dictionary<string, (DateTime Last, int Denials)> _prompts = new();
    bool _open;

    public CommandApprovals Approvals => approvals;

    /// <summary>Returns when the widget may use the camera; throws a <see cref="TimelapseException"/> saying why not.</summary>
    /// <param name="userClick">A physical left click on the widget just now (<see cref="ClickGate"/>).</param>
    public async Task EnsureAsync(WidgetManifest m, bool userClick)
    {
        if (!m.Permissions.Camera) throw new TimelapseException("This widget has no permissions.camera");
        if (!userClick) throw new TimelapseException("Click the widget first: the camera starts only from a physical click");
        if (approvals.CameraApproved(m.Id)) return;
        lock (_gate)
        {
            if (_open) throw new TimelapseException("A camera prompt is already open");
            var (last, denials) = _prompts.GetValueOrDefault(m.Id);
            if (denials >= MaxDenials) throw new TimelapseException("You refused the camera for this widget several times; restart Umbra to be asked again");
            if (last != default && _now() - last < MinPromptInterval) throw new TimelapseException("Please wait a moment before asking again");
            _open = true;
            _prompts[m.Id] = (_now(), denials);
        }
        bool allowed;
        try { allowed = await prompt(m.Name); }
        finally { lock (_gate) _open = false; }
        lock (_gate)
        {
            var (last, denials) = _prompts[m.Id];
            _prompts[m.Id] = (last, allowed ? 0 : denials + 1);
        }
        if (!allowed)
        {
            Log.Write($"[{m.Id}] camera refused by the user");
            throw new TimelapseException("The camera was not allowed (refused, or no answer within 2 minutes)");
        }
        approvals.ApproveCamera(m.Id);
    }
}

/// <summary>
/// Where a widget's timelapse videos go: the user's Videos\Umbra Timelapses unless the user picked another folder with
/// the host's folder dialog. Kept in %APPDATA%\Umbra\timelapse.json (not settings.json, so no page can write it).
/// </summary>
sealed class TimelapseFolders(string path)
{
    static TimelapseFolders? _shared;
    public static TimelapseFolders Shared => _shared ??= new(Path.Combine(AppPaths.DataDir, "timelapse.json"));

    public static string Default => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "Umbra Timelapses");

    /// <summary>What the page may learn about a folder: its last segment ("Umbra Timelapses"), never the full path.</summary>
    public static string Label(string folder)
    {
        var trimmed = folder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var name = Path.GetFileName(trimmed);
        return string.IsNullOrEmpty(name) ? trimmed : name;
    }

    readonly object _gate = new();

    Dictionary<string, string> Load()
    {
        try
        {
            if (File.Exists(path)) return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path)) ?? new();
        }
        catch (Exception ex) { Log.Write($"timelapse.json unreadable: {ex.Message}"); }
        return new();
    }

    /// <summary>The folder for this widget id; the default when none was chosen or the chosen one is gone.</summary>
    public string Get(string widgetId)
    {
        lock (_gate)
            return Load().TryGetValue(widgetId, out var f) && Path.IsPathFullyQualified(f) && Directory.Exists(f) ? f : Default;
    }

    /// <summary>Only the host's folder dialog calls this, with a folder the user picked.</summary>
    public void Set(string widgetId, string folder)
    {
        lock (_gate)
        {
            var all = Load();
            all[widgetId] = folder;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(all));
        }
    }
}
