extern alias cli;

using CommandLine = cli::Umbra.Cli.CommandLine;

namespace Umbra.Tests;

public class LayoutSafeModeTests
{
    static readonly Rectangle Screen = new(0, 0, 1920, 1040);

    [Fact]
    public void Snap_aligns_to_the_screen_edge_within_the_threshold()
    {
        var r = Snap.Move(new Rectangle(7, 5, 300, 200), 0, true, new[] { Screen }, Array.Empty<Rectangle>(), 10);
        Assert.Equal(new Point(0, 0), r.Location);
    }

    [Fact]
    public void Snap_leaves_far_away_widgets_alone()
    {
        var r = Snap.Move(new Rectangle(500, 400, 300, 200), 0, true, new[] { Screen }, Array.Empty<Rectangle>(), 10);
        Assert.Equal(new Rectangle(500, 400, 300, 200), r);
    }

    [Fact]
    public void Snap_sticks_to_the_edge_of_another_widget()
    {
        var other = new Rectangle(100, 100, 300, 200);
        var r = Snap.Move(new Rectangle(405, 103, 200, 100), 0, true, new[] { Screen }, new[] { other }, 10);
        Assert.Equal(new Point(400, 100), r.Location);
    }

    [Fact]
    public void Snap_uses_the_grid_and_can_turn_edges_off()
    {
        var r = Snap.Move(new Rectangle(7, 53, 100, 100), 20, false, new[] { Screen }, Array.Empty<Rectangle>(), 10);
        Assert.Equal(new Point(0, 60), r.Location);
        var off = Snap.Move(new Rectangle(7, 5, 100, 100), 0, false, new[] { Screen }, Array.Empty<Rectangle>(), 10);
        Assert.Equal(new Point(7, 5), off.Location);
    }

    [Fact]
    public void Snap_toggle_flips_the_master_switch_and_keeps_the_grid()
    {
        var g = new GeneralSettings { SnapGrid = 20, SnapEdges = false };
        Assert.True(Snap.IsActive(g));
        Assert.False(Snap.Toggle(g));
        Assert.False(Snap.IsActive(g));
        Assert.Equal(20, g.SnapGrid);
        Assert.True(Snap.Toggle(g));
        Assert.True(Snap.IsActive(g));
    }

    [Fact]
    public void Snap_toggle_on_with_nothing_configured_turns_edge_snapping_on()
    {
        var g = new GeneralSettings { SnapGrid = 0, SnapEdges = false };
        Assert.False(Snap.IsActive(g));
        Assert.True(Snap.Toggle(g));
        Assert.True(g.SnapEdges);
        Assert.True(Snap.IsActive(g));
    }

    [Fact]
    public void Layout_captures_and_applies_placement_without_touching_options()
    {
        var settings = new Settings();
        settings.Widgets["clock"] = new WidgetSettings { Enabled = true, X = 10, Y = 20, Scale = 1.5 };
        settings.Widgets["clock"].Options["size"] = 3;
        var layouts = new Layouts();
        {
            layouts.Set("Work", settings);
            settings.Widgets["clock"].Enabled = false;
            settings.Widgets["clock"].X = 999;
            settings.Widgets["clock"].Options["size"] = 9;
            Assert.Equal(1, layouts.Apply("work", settings)); // names are case-insensitive
            var ws = settings.Widgets["clock"];
            Assert.True(ws.Enabled);
            Assert.Equal(10, ws.X);
            Assert.Equal(1.5, ws.Scale);
            Assert.Equal(9, (int)ws.Options["size"]!);
            Assert.Throws<KeyNotFoundException>(() => layouts.Apply("nope", settings));
        }
    }

    [Theory]
    [InlineData("Study", true)]
    [InlineData("a-b_c 2", true)]
    [InlineData("", false)]
    [InlineData("../x", false)]
    public void Layout_names_are_validated(string name, bool ok) => Assert.Equal(ok, Layouts.IsValidName(name));

    [Fact]
    public async Task Commands_are_registered_and_mapped()
    {
        Assert.Contains(Protocol.Commands, c => c.Cmd == "safe-mode");
        Assert.Contains(Protocol.Commands, c => c.Cmd == "layouts");
        var none = (Func<string, System.Text.Json.Nodes.JsonObject, Task<System.Text.Json.Nodes.JsonObject>>)((_, _) => Task.FromResult(new System.Text.Json.Nodes.JsonObject()));
        var (c1, a1) = await CommandLine.TranslateAsync(new[] { "safe-mode", "on" }, none);
        Assert.Equal(("safe-mode", """{"on":true}"""), (c1, a1.ToJsonString()));
        var (c2, a2) = await CommandLine.TranslateAsync(new[] { "layouts", "save", "My", "Work" }, none);
        Assert.Equal(("layouts", """{"op":"save","name":"My Work"}"""), (c2, a2.ToJsonString()));
        var (c3, a3) = await CommandLine.TranslateAsync(new[] { "layouts", "rename", "Layout 1", "Docked" }, none);
        Assert.Equal(("layouts", """{"op":"rename","name":"Layout 1","to":"Docked"}"""), (c3, a3.ToJsonString()));
        await Assert.ThrowsAsync<ArgumentException>(() => CommandLine.TranslateAsync(new[] { "layouts", "rename", "Layout 1" }, none));
    }
}
