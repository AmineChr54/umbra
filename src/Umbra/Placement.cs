using System.Runtime.InteropServices;

namespace Umbra;

/// <summary>One monitor as placement sees it (pure data, so the maths can be unit tested).</summary>
public readonly record struct MonitorInfo(string Name, Rectangle Bounds, Rectangle WorkArea, bool Primary);

/// <summary>Per-monitor placement and the fullscreen test. Pure functions; <see cref="Monitors"/> reads the live screens.</summary>
public static class Placement
{
    public static List<MonitorInfo> Monitors() =>
        Screen.AllScreens.Select(s => new MonitorInfo(s.DeviceName, s.Bounds, s.WorkingArea, s.Primary)).ToList();

    /// <summary>The monitor a window mostly sits on (the one containing its centre, else the largest overlap, else primary).</summary>
    public static MonitorInfo? Find(IReadOnlyList<MonitorInfo> screens, Rectangle rect)
    {
        var centre = new Point(rect.X + rect.Width / 2, rect.Y + rect.Height / 2);
        foreach (var s in screens) if (s.Bounds.Contains(centre)) return s;
        MonitorInfo? best = null;
        long bestArea = 0;
        foreach (var s in screens)
        {
            var i = Rectangle.Intersect(s.Bounds, rect);
            long area = (long)i.Width * i.Height;
            if (i.Width > 0 && i.Height > 0 && area > bestArea) { best = s; bestArea = area; }
        }
        return best ?? screens.Where(s => s.Primary).Select(s => (MonitorInfo?)s).FirstOrDefault();
    }

    /// <summary>
    /// A stable text for a monitor setup: each monitor's device name, resolution and top-left position (so the arrangement
    /// counts), primary marked with "*", sorted by name so the order Windows lists them in doesn't matter. Work areas are
    /// left out on purpose (moving the taskbar is not a new setup). Empty when there are no monitors.
    /// </summary>
    public static string Fingerprint(IReadOnlyList<MonitorInfo> screens) =>
        string.Join(';', screens.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .Select(s => $"{s.Name.ToUpperInvariant()}={s.Bounds.Width}x{s.Bounds.Height}@{s.Bounds.X},{s.Bounds.Y}{(s.Primary ? "*" : "")}"));

    /// <summary>How many monitors a <see cref="Fingerprint"/> describes.</summary>
    public static int FingerprintMonitors(string fingerprint) =>
        string.IsNullOrEmpty(fingerprint) ? 0 : fingerprint.Split(';').Length;

    /// <summary>True when the device name belongs to a connected monitor.</summary>
    public static bool Has(IReadOnlyList<MonitorInfo> screens, string name) =>
        screens.Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Where the window goes: the saved monitor plus its offset from that monitor's top-left corner. A monitor that is
    /// gone falls back to the primary one with the same offset. The result is pulled inside the work area, so the
    /// widget always survives a monitor change or unplug.
    /// </summary>
    public static Point Resolve(IReadOnlyList<MonitorInfo> screens, string? monitor, int relX, int relY, Size size)
    {
        if (screens.Count == 0) return new Point(relX, relY);
        var m = screens.FirstOrDefault(s => monitor is not null && string.Equals(s.Name, monitor, StringComparison.OrdinalIgnoreCase));
        if (m.Name is null) m = screens.FirstOrDefault(s => s.Primary);
        if (m.Name is null) m = screens[0];
        var w = m.WorkArea;
        var x = m.Bounds.X + relX;
        var y = m.Bounds.Y + relY;
        x = Math.Max(w.Left, Math.Min(x, w.Right - size.Width));
        y = Math.Max(w.Top, Math.Min(y, w.Bottom - size.Height));
        return new Point(x, y);
    }

    /// <summary>
    /// SHQueryUserNotificationState: 2 = busy (a fullscreen app), 3 = Direct3D fullscreen (a game),
    /// 4 = presentation mode. The other states (screensaver, quiet time, normal) are not a fullscreen app.
    /// </summary>
    public static bool IsFullscreenState(int state) => state is 2 or 3 or 4;

    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

    /// <summary>True while a fullscreen app or game is in the foreground (false if Windows can't say).</summary>
    public static bool FullscreenAppActive() =>
        SHQueryUserNotificationState(out var s) == 0 && IsFullscreenState(s);
}
