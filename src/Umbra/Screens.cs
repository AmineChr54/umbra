using System.Runtime.InteropServices;

namespace Umbra;

/// <summary>The live Windows monitors and fullscreen state, as the pure <see cref="Placement"/> maths expects them.</summary>
static class Screens
{
    public static List<MonitorInfo> All() =>
        Screen.AllScreens.Select(s => new MonitorInfo(s.DeviceName, s.Bounds, s.WorkingArea, s.Primary)).ToList();

    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

    /// <summary>True while a fullscreen app or game is in the foreground (false if Windows can't say).</summary>
    public static bool FullscreenAppActive() =>
        SHQueryUserNotificationState(out var s) == 0 && Placement.IsFullscreenState(s);
}
