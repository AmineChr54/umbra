namespace Umbra;

/// <summary>
/// Makes a top-level window behave like a desktop widget:
///  - owned by Progman (the desktop shell window), so "Show desktop" (Win+D) leaves it visible;
///  - tool window + no-activate, so it never shows in Alt+Tab/taskbar or steals focus;
///  - forced to the bottom of the z-order on every position change, so apps always cover it.
/// </summary>
static class DesktopPin
{
    /// <summary>Broadcast by Explorer when it (re)starts; the desktop windows are new, so the owner has to be set again.</summary>
    public static readonly int TaskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");

    public static void Apply(IntPtr hwnd)
    {
        var ex = (long)Native.GetWindowLongPtr(hwnd, Native.GWL_EXSTYLE);
        ex = (ex | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE) & ~Native.WS_EX_APPWINDOW;
        Native.SetWindowLongPtr(hwnd, Native.GWL_EXSTYLE, (IntPtr)ex);

        var progman = Native.FindWindow("Progman", null);
        if (progman != IntPtr.Zero)
            Native.SetWindowLongPtr(hwnd, Native.GWLP_HWNDPARENT, progman);

        SendToBottom(hwnd);
    }

    public static void SendToBottom(IntPtr hwnd) =>
        Native.SetWindowPos(hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);

    /// <summary>True while Peek holds the widgets above other windows; <see cref="KeepAtBottom"/> then lets z-order changes through.</summary>
    public static volatile bool Peeking;

    /// <summary>Raises a widget above other windows without activating it (Peek).</summary>
    public static void Raise(IntPtr hwnd) =>
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);

    /// <summary>Ends a peek for one widget: back to normal z-order, then to the bottom.</summary>
    public static void Lower(IntPtr hwnd)
    {
        Native.SetWindowPos(hwnd, Native.HWND_NOTOPMOST, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        SendToBottom(hwnd);
    }

    /// <summary>Call from WndProc on WM_WINDOWPOSCHANGING: rewrites any z-order change to "bottom".</summary>
    public static unsafe void KeepAtBottom(IntPtr lParam)
    {
        if (Peeking) return;
        var pos = (Native.WINDOWPOS*)lParam;
        if ((pos->flags & Native.SWP_NOZORDER) == 0)
            pos->hwndInsertAfter = Native.HWND_BOTTOM;
    }

    /// <summary>Win11 rounded corners + a hairline border, drawn by DWM (crisp at any DPI).</summary>
    public static void RoundCorners(IntPtr hwnd)
    {
        Native.SetDwm(hwnd, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
        Native.SetDwm(hwnd, Native.DWMWA_WINDOW_CORNER_PREFERENCE, Native.DWMWCP_ROUND);
        Native.SetDwm(hwnd, Native.DWMWA_BORDER_COLOR, Native.ColorRef(38, 40, 46));
    }
}
