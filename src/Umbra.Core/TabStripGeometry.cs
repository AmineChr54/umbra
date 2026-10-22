namespace Umbra;

/// <summary>Where a group's tab strip goes: just above the widget, or inside its top edge when the screen has no room above.</summary>
static class TabStripGeometry
{
    public const int Cell = 30, Pad = 3, Gap = 2, Bar = Cell + 2 * Pad, Space = 3, Inset = 6;

    public static Size SizeFor(int count, float k)
    {
        var n = Math.Max(1, count);
        return new Size((int)Math.Round((n * Cell + (n - 1) * Gap + 2 * Pad) * k), (int)Math.Round(Bar * k));
    }

    /// <summary>Strip bounds for a widget at <paramref name="target"/> (physical pixels); <paramref name="above"/> is false for the inside fallback.</summary>
    public static Rectangle Place(Rectangle target, Rectangle workArea, float k, int count, out bool above)
    {
        var size = SizeFor(count, k);
        size.Width = Math.Min(size.Width, Math.Max(size.Height, target.Width));
        var top = target.Y - size.Height - (int)Math.Round(Space * k);
        above = top >= workArea.Y;
        if (!above) top = target.Y + (int)Math.Round(Inset * k);
        var x = above ? target.X : target.X + (int)Math.Round(Inset * k);
        return new Rectangle(x, top, size.Width, size.Height);
    }
}
