namespace Umbra;

/// <summary>Pure snapping maths for moving a widget in edit mode (grid, screen edges and centers, other widgets' edges, centers and an even gap).</summary>
public static class Snap
{
    public const int MaxGrid = 200;
    /// <summary>Largest configurable gap between neighbours, in logical pixels.</summary>
    public const int MaxGap = 100;

    /// <summary>One alignment guide to draw: a vertical line at x = <see cref="Pos"/> (or horizontal at y) from <see cref="Start"/> to <see cref="End"/>.</summary>
    public readonly record struct Guide(bool Vertical, int Pos, int Start, int End);

    /// <summary>The snapped rectangle plus the guides that explain why it moved (empty when nothing but the grid snapped).</summary>
    public sealed record Result(Rectangle Rect, IReadOnlyList<Guide> Guides);

    enum Own { Lo, Mid, Hi }

    /// <summary>A line of the dragged rectangle (<see cref="Own"/>) that wants to sit at <see cref="To"/>; <see cref="Mark"/> is the neighbour's edge when keeping a gap.</summary>
    readonly record struct Cand(Own Own, int To, Rectangle Src, bool Area, int? Mark);

    /// <summary>Whether moving a widget snaps at all: the master switch is on and a grid or edge snapping is configured.</summary>
    public static bool IsActive(GeneralSettings g) => g.SnapEnabled && (g.SnapGrid > 0 || g.SnapEdges);

    /// <summary>The accepted <see cref="GeneralSettings.SnapMode"/> values; the first is the default.</summary>
    public static readonly string[] Modes = { "shift", "always" };

    /// <summary>True when snapping is on in "always" mode (Shift skips); anything else, including unknown text, is the default "shift" mode.</summary>
    public static bool IsAlways(GeneralSettings g) => string.Equals(g.SnapMode?.Trim(), "always", StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether a drag snaps right now: snapping is configured and Shift is held ("shift" mode) or not held ("always" mode).</summary>
    public static bool SnapsWhileDragging(GeneralSettings g, bool shiftHeld) => IsActive(g) && (IsAlways(g) ? !shiftHeld : shiftHeld);

    /// <summary>Grid for an arrow-key nudge: Shift (a big step) uses it when snapping is configured; in "always" mode a big step uses it too, as before. Small steps never do.</summary>
    public static int NudgeGrid(GeneralSettings g, bool big) => IsActive(g) && (big || IsAlways(g)) ? g.SnapGrid : 0;

    /// <summary>Pill hint for the current mode.</summary>
    public static string Hint(GeneralSettings g) => IsAlways(g) ? "Shift skips snapping" : "Hold Shift to snap";

    /// <summary>Pill chip text: on/off in "always" mode, "Shift" or "off" in "shift" mode.</summary>
    public static string Label(GeneralSettings g) => IsActive(g) ? (IsAlways(g) ? "Snap: on" : "Snap: Shift") : "Snap: off";

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
    public static Rectangle Move(Rectangle r, int grid, bool edges, IReadOnlyList<Rectangle> areas, IReadOnlyList<Rectangle> others, int threshold) =>
        Compute(r, grid, edges, 0, areas, others, threshold).Rect;

    /// <summary>
    /// Like <see cref="Move"/>, and also: centers line up with screen and widget centers, and with <paramref name="gap"/> &gt; 0
    /// (physical pixels) a widget next to another one keeps exactly that gap instead of touching it.
    /// </summary>
    public static Result Compute(Rectangle r, int grid, bool edges, int gap, IReadOnlyList<Rectangle> areas, IReadOnlyList<Rectangle> others, int threshold)
    {
        var xc = Candidates(r, true, edges, gap, areas, others, threshold);
        var yc = Candidates(r, false, edges, gap, areas, others, threshold);
        var dx = Best(r, true, xc, grid, threshold, out var xhits);
        var dy = Best(r, false, yc, grid, threshold, out var yhits);
        var moved = new Rectangle(r.X + dx, r.Y + dy, r.Width, r.Height);

        var guides = new List<Guide>();
        AddGuides(guides, moved, true, xhits);
        AddGuides(guides, moved, false, yhits);
        return new Result(moved, guides.Distinct().ToList());
    }

    static int Lo(Rectangle q, bool x) => x ? q.Left : q.Top;
    static int Hi(Rectangle q, bool x) => x ? q.Right : q.Bottom;
    static int Mid(Rectangle q, bool x) => Lo(q, x) + (Hi(q, x) - Lo(q, x)) / 2;
    static int At(Rectangle q, bool x, Own o) => o switch { Own.Lo => Lo(q, x), Own.Hi => Hi(q, x), _ => Mid(q, x) };

    static List<Cand> Candidates(Rectangle r, bool x, bool edges, int gap, IReadOnlyList<Rectangle> areas, IReadOnlyList<Rectangle> others, int threshold)
    {
        var list = new List<Cand>();
        if (!edges) return list;
        foreach (var a in areas) Align(list, a, x, true);
        foreach (var o in others)
        {
            Align(list, o, x, false);
            if (gap <= 0)
            {
                list.Add(new(Own.Lo, Hi(o, x), o, false, null)); // touching
                list.Add(new(Own.Hi, Lo(o, x), o, false, null));
            }
            else if (Lo(r, !x) <= Hi(o, !x) + threshold && Hi(r, !x) >= Lo(o, !x) - threshold)
            {
                // Only widgets we are actually next to (their spans overlap across the other axis) ask for a gap.
                list.Add(new(Own.Lo, Hi(o, x) + gap, o, false, Hi(o, x)));
                list.Add(new(Own.Hi, Lo(o, x) - gap, o, false, Lo(o, x)));
            }
        }
        return list;
    }

    static void Align(List<Cand> list, Rectangle s, bool x, bool area)
    {
        list.Add(new(Own.Lo, Lo(s, x), s, area, null));
        list.Add(new(Own.Mid, Mid(s, x), s, area, null));
        list.Add(new(Own.Hi, Hi(s, x), s, area, null));
    }

    static int Best(Rectangle r, bool x, List<Cand> cands, int grid, int threshold, out List<Cand> hits)
    {
        int best = 0, bestAbs = int.MaxValue;
        void Try(int d)
        {
            if (Math.Abs(d) <= threshold && Math.Abs(d) < bestAbs) { best = d; bestAbs = Math.Abs(d); }
        }
        foreach (var c in cands) Try(c.To - At(r, x, c.Own));
        if (grid > 0)
        {
            var g = Math.Min(grid, MaxGrid);
            Try((int)Math.Round(Lo(r, x) / (double)g) * g - Lo(r, x));
        }
        hits = bestAbs == int.MaxValue ? new() : cands.Where(c => c.To - At(r, x, c.Own) == best).ToList();
        return bestAbs == int.MaxValue ? 0 : best;
    }

    /// <summary>One line per satisfied target, spanning the dragged widget and the thing it lines up with (two lines for a gap: both facing edges).</summary>
    static void AddGuides(List<Guide> guides, Rectangle moved, bool x, List<Cand> hits)
    {
        foreach (var c in hits)
        {
            // Screen edges would draw a line down the whole display; only the widget's own span for those.
            var (start, end) = c.Area && c.Own != Own.Mid
                ? (Lo(moved, !x), Hi(moved, !x))
                : (Math.Min(Lo(moved, !x), Lo(c.Src, !x)), Math.Max(Hi(moved, !x), Hi(c.Src, !x)));
            guides.Add(new Guide(x, c.To, start, end));
            if (c.Mark is int m) guides.Add(new Guide(x, m, start, end));
        }
    }
}
