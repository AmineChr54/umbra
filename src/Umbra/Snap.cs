namespace Umbra;

/// <summary>Pure snapping maths for moving a widget in edit mode (grid, screen edges, other widgets' edges).</summary>
public static class Snap
{
    public const int MaxGrid = 200;

    /// <summary>Whether moving a widget snaps at all: the master switch is on and a grid or edge snapping is configured.</summary>
    public static bool IsActive(GeneralSettings g) => g.SnapEnabled && (g.SnapGrid > 0 || g.SnapEdges);

    /// <summary>
    /// Flips snapping on or off (the edit-mode pill). Turning it on when the grid and edges are both off would change
    /// nothing, so edge snapping is switched on too. Returns the new state.
    /// </summary>
    public static bool Toggle(GeneralSettings g)
    {
        if (IsActive(g)) { g.SnapEnabled = false; return false; }
        g.SnapEnabled = true;
        if (g.SnapGrid <= 0 && !g.SnapEdges) g.SnapEdges = true;
        return true;
    }

    /// <summary>Returns the rectangle moved by the smallest offset within <paramref name="threshold"/> that lines it up per axis; size is untouched.</summary>
    public static Rectangle Move(Rectangle r, int grid, bool edges, IReadOnlyList<Rectangle> areas, IReadOnlyList<Rectangle> others, int threshold)
    {
        var xs = new List<int>();
        var ys = new List<int>();
        if (edges)
        {
            foreach (var a in areas.Concat(others))
            {
                xs.Add(a.Left); xs.Add(a.Right); ys.Add(a.Top); ys.Add(a.Bottom);
            }
        }
        var dx = Best(r.Left, r.Right, xs, grid, threshold);
        var dy = Best(r.Top, r.Bottom, ys, grid, threshold);
        return new Rectangle(r.X + dx, r.Y + dy, r.Width, r.Height);
    }

    static int Best(int lo, int hi, List<int> lines, int grid, int threshold)
    {
        int best = 0, bestAbs = int.MaxValue;
        void Try(int d)
        {
            if (Math.Abs(d) <= threshold && Math.Abs(d) < bestAbs) { best = d; bestAbs = Math.Abs(d); }
        }
        foreach (var l in lines) { Try(l - lo); Try(l - hi); }
        if (grid > 0)
        {
            var g = Math.Min(grid, MaxGrid);
            Try((int)Math.Round(lo / (double)g) * g - lo);
        }
        return bestAbs == int.MaxValue ? 0 : best;
    }
}
