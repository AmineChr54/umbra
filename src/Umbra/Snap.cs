namespace Umbra;

/// <summary>Pure snapping maths for moving a widget in edit mode (grid, screen edges, other widgets' edges).</summary>
public static class Snap
{
    public const int MaxGrid = 200;

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
