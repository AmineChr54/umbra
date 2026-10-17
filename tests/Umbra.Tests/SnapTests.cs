namespace Umbra.Tests;

public class SnapTests
{
    static readonly Rectangle Screen = new(0, 0, 1920, 1040);
    static readonly Rectangle[] None = Array.Empty<Rectangle>();

    static Snap.Result Run(Rectangle r, int gap, params Rectangle[] others) =>
        Snap.Compute(r, 0, true, gap, new[] { Screen }, others, 10);

    [Fact]
    public void Dropping_next_to_a_widget_leaves_exactly_the_gap()
    {
        var other = new Rectangle(500, 100, 300, 200); // right edge 800, bottom edge 300
        Assert.Equal(12, Run(new Rectangle(808, 103, 200, 100), 12, other).Rect.Left - other.Right); // right of it
        Assert.Equal(12, other.Left - Run(new Rectangle(393, 103, 100, 100), 12, other).Rect.Right); // left of it
        Assert.Equal(12, Run(new Rectangle(500, 305, 100, 100), 12, other).Rect.Top - other.Bottom); // below it
        Assert.Equal(12, other.Top - Run(new Rectangle(500, -7, 100, 100), 12, other).Rect.Bottom); // above it
    }

    [Fact]
    public void A_gap_of_zero_touches_the_neighbour_like_before()
    {
        var other = new Rectangle(100, 100, 300, 200);
        var r = Run(new Rectangle(405, 103, 200, 100), 0, other);
        Assert.Equal(new Point(400, 100), r.Rect.Location);
    }

    [Fact]
    public void Widgets_that_are_not_side_by_side_do_not_ask_for_a_gap()
    {
        var other = new Rectangle(100, 100, 300, 200);
        // 408 is within reach of the gap line (412), but the widgets do not overlap vertically.
        var r = Run(new Rectangle(408, 700, 200, 100), 12, other);
        Assert.Equal(408, r.Rect.Left);
    }

    [Fact]
    public void Centers_line_up_with_a_widget_and_the_screen()
    {
        var other = new Rectangle(100, 100, 300, 200); // center x = 250
        var r = Run(new Rectangle(145, 600, 200, 100), 12, other); // center x = 245
        Assert.Equal(250, r.Rect.Left + r.Rect.Width / 2);
        var onScreen = Run(new Rectangle(865, 500, 200, 100), 12); // center 965 vs the screen's 960
        Assert.Equal(960, onScreen.Rect.Left + onScreen.Rect.Width / 2);
    }

    [Fact]
    public void Guides_describe_what_was_snapped_to()
    {
        var other = new Rectangle(100, 100, 300, 200);
        var r = Run(new Rectangle(408, 103, 200, 100), 12, other);
        // Two vertical lines for the gap (the neighbour's edge and ours) and a horizontal one for the shared top edge.
        Assert.Contains(new Snap.Guide(true, other.Right, 100, 300), r.Guides);
        Assert.Contains(new Snap.Guide(true, other.Right + 12, 100, 300), r.Guides);
        Assert.Contains(r.Guides, g => !g.Vertical && g.Pos == 100);
    }

    [Fact]
    public void No_guides_when_nothing_snapped_or_only_the_grid_did()
    {
        Assert.Empty(Run(new Rectangle(500, 400, 300, 200), 12).Guides);
        var grid = Snap.Compute(new Rectangle(507, 403, 100, 100), 20, true, 12, new[] { Screen }, None, 10);
        Assert.Equal(new Point(500, 400), grid.Rect.Location);
        Assert.Empty(grid.Guides);
    }

    [Fact]
    public void Screen_edge_guides_stay_as_long_as_the_widget()
    {
        var r = Run(new Rectangle(7, 500, 300, 200), 12);
        Assert.Equal(0, r.Rect.Left);
        Assert.Contains(new Snap.Guide(true, 0, 500, 700), r.Guides);
    }

    [Fact]
    public void Turning_edges_off_turns_off_gap_and_centers()
    {
        var other = new Rectangle(100, 100, 300, 200);
        var r = Snap.Compute(new Rectangle(408, 103, 200, 100), 0, false, 12, new[] { Screen }, new[] { other }, 10);
        Assert.Equal(new Rectangle(408, 103, 200, 100), r.Rect);
        Assert.Empty(r.Guides);
    }
}
