namespace Umbra;

/// <summary>Pure sizing rules for widget windows (kept free of WinForms state so they can be unit tested).</summary>
public static class WidgetGeometry
{
    /// <summary>Changing a widget by hand needs edit mode and an unlocked widget.</summary>
    public static bool CanArrange(bool editMode, bool locked) => editMode && !locked;

    /// <summary>Smallest part of a nudged widget that must stay inside a work area, in logical pixels.</summary>
    public const int NudgeKeepVisible = 32;

    /// <summary>
    /// One arrow-key step along an axis (dir is -1 or +1), in physical pixels: 1 px, or with Shift 10 px, or to the next
    /// grid line in that direction when the snap grid is on. The grid lines are the same ones <see cref="Snap"/> uses.
    /// </summary>
    public static int NudgeTo(int pos, int dir, bool big, int grid)
    {
        dir = Math.Sign(dir);
        if (!big) return pos + dir;
        if (grid <= 0) return pos + 10 * dir;
        var g = Math.Min(grid, Snap.MaxGrid);
        return dir > 0 ? (int)(Math.Floor(pos / (double)g) + 1) * g : (int)(Math.Ceiling(pos / (double)g) - 1) * g;
    }

    /// <summary>True when at least <paramref name="keep"/> px (or the whole side, if shorter) of the rectangle lies in one work area on each axis, so the widget can still be grabbed.</summary>
    public static bool KeepsOnScreen(Rectangle r, IReadOnlyList<Rectangle> workAreas, int keep)
    {
        foreach (var w in workAreas)
        {
            var i = Rectangle.Intersect(w, r);
            if (i.Width >= Math.Min(keep, r.Width) && i.Height >= Math.Min(keep, r.Height) && i.Width > 0 && i.Height > 0) return true;
        }
        return false;
    }

    /// <summary>Total area of the rectangle that lies inside the work areas.</summary>
    static long VisibleArea(Rectangle r, IReadOnlyList<Rectangle> workAreas)
    {
        long sum = 0;
        foreach (var w in workAreas) { var i = Rectangle.Intersect(w, r); if (i.Width > 0 && i.Height > 0) sum += (long)i.Width * i.Height; }
        return sum;
    }

    /// <summary>
    /// Whether a nudge from <paramref name="from"/> to <paramref name="to"/> is allowed: the result keeps enough on screen,
    /// or at least does not show less than before (so a widget that is partly or fully off screen can be nudged back).
    /// </summary>
    public static bool NudgeAllowed(Rectangle from, Rectangle to, IReadOnlyList<Rectangle> workAreas, int keep) =>
        KeepsOnScreen(to, workAreas, keep) || VisibleArea(to, workAreas) >= VisibleArea(from, workAreas);

    /// <summary>Window size for a scale: manifest size (logical pixels) x monitor DPI x scale.</summary>
    public static Size ScaledSize(int width, int height, int dpi, double scale) => new(
        (int)Math.Round(width * dpi / 96.0 * scale),
        (int)Math.Round(height * dpi / 96.0 * scale));

    /// <summary>The scale a window width stands for at a DPI.</summary>
    public static double ScaleForWidth(int manifestWidth, int dpi, int windowWidth) => windowWidth / (manifestWidth * dpi / 96.0);

    /// <summary>The size a dragged rectangle snaps to: manifest aspect ratio, the larger stretch wins, clamped to the scale range.</summary>
    public static Size KeepAspect(int width, int height, int dpi, int dragWidth, int dragHeight)
    {
        var one = ScaledSize(width, height, dpi, 1);
        var s = Math.Max(dragWidth / (double)one.Width, dragHeight / (double)one.Height);
        return ScaledSize(width, height, dpi, Math.Clamp(s, WidgetSettings.MinScale, WidgetSettings.MaxScale));
    }
}
