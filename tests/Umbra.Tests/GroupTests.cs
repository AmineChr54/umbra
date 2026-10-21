using Umbra;
using Xunit;

namespace Umbra.Tests;

public class GroupTests
{
    static Settings With(params string[] ids)
    {
        var s = new Settings();
        foreach (var id in ids) s.Widgets[id] = new WidgetSettings();
        return s;
    }

    [Fact]
    public void Only_the_active_tab_is_shown()
    {
        var s = With("a", "b", "c");
        var g = Groups.Create(s, "Mix", "a");
        Groups.Join(s, g, "b");
        Assert.True(Groups.IsShownTab(s, "a"));
        Assert.False(Groups.IsShownTab(s, "b"));
        Assert.True(Groups.IsShownTab(s, "c")); // ungrouped widgets are unaffected
    }

    [Fact]
    public void An_instance_is_in_one_group_at_most()
    {
        var s = With("a", "b");
        var g1 = Groups.Create(s, "One", "a");
        var g2 = Groups.Create(s, "Two", "b");
        Groups.Join(s, g2, "a");
        Assert.False(s.Groups.ContainsKey(g1)); // emptied, so removed
        Assert.Equal(new[] { "b", "a" }, s.Groups[g2].Members);
    }

    [Fact]
    public void Activating_a_tab_moves_the_slot_to_it()
    {
        var s = With("a", "b");
        s.Widgets["a"].X = 100; s.Widgets["a"].Y = 50; s.Widgets["a"].Width = 300; s.Widgets["a"].Height = 200;
        var g = Groups.Create(s, "G", "a");
        Groups.Join(s, g, "b");
        Assert.Equal(100, s.Widgets["b"].X); // joined into the visible slot
        s.Widgets["a"].X = 400; // dragged
        Groups.Activate(s, g, "b");
        Assert.Equal(400, s.Widgets["b"].X);
        Assert.Equal(300, s.Widgets["b"].Width);
        Assert.Equal("b", s.Groups[g].Active);
    }

    [Fact]
    public void Step_wraps_around_both_ways()
    {
        var s = With("a", "b", "c");
        var g = Groups.Create(s, "G", "a");
        Groups.Join(s, g, "b");
        Groups.Join(s, g, "c");
        Assert.Equal("b", Groups.Step(s, g, 1));
        Assert.Equal("c", Groups.Step(s, g, 1));
        Assert.Equal("a", Groups.Step(s, g, 1));
        Assert.Equal("c", Groups.Step(s, g, -1));
    }

    [Fact]
    public void Prune_drops_missing_members_empty_groups_and_repairs_active()
    {
        var s = With("a", "b");
        var g = Groups.Create(s, "G", "a");
        Groups.Join(s, g, "b");
        s.Widgets.Remove("a"); // the copy was removed
        Assert.True(Groups.Prune(s));
        Assert.Equal(new[] { "b" }, s.Groups[g].Members);
        Assert.Equal("b", s.Groups[g].Active);
        s.Widgets.Remove("b");
        Groups.Prune(s);
        Assert.Empty(s.Groups);
    }

    [Fact]
    public void Cycle_seconds_are_clamped_and_zero_means_off()
    {
        var s = With("a");
        var g = Groups.Create(s, "G", "a");
        s.Groups[g].CycleSeconds = 1;
        Groups.Prune(s);
        Assert.Equal(Groups.MinCycle, s.Groups[g].CycleSeconds);
        s.Groups[g].CycleSeconds = 0;
        Groups.Prune(s);
        Assert.Equal(0, s.Groups[g].CycleSeconds);
    }

    [Fact]
    public void Reorder_and_leave()
    {
        var s = With("a", "b", "c");
        var g = Groups.Create(s, "G", "a");
        Groups.Join(s, g, "b");
        Groups.Join(s, g, "c");
        Groups.Reorder(s, g, "c", 0);
        Assert.Equal(new[] { "c", "a", "b" }, s.Groups[g].Members);
        Groups.Leave(s, "a");
        Assert.Equal(new[] { "c", "b" }, s.Groups[g].Members);
        Assert.Throws<KeyNotFoundException>(() => Groups.Join(s, "nope", "a"));
    }

    [Fact]
    public void Groups_survive_a_json_round_trip_and_old_files_have_none()
    {
        var s = With("a", "b");
        var g = Groups.Create(s, "Work", "a");
        Groups.Join(s, g, "b");
        var back = Settings.FromJson(s.ToJson());
        Assert.Equal("Work", back.Groups[g].Name);
        Assert.Equal(new[] { "a", "b" }, back.Groups[g].Members);
        Assert.Empty(Settings.FromJson(System.Text.Json.Nodes.JsonNode.Parse("{\"widgets\":{}}")!).Groups);
    }
}

public class TabStripTests
{
    [Fact]
    public void Strip_sits_just_above_the_widget_when_there_is_room()
    {
        var work = new Rectangle(0, 0, 1920, 1040);
        var r = TabStripGeometry.Place(new Rectangle(500, 300, 400, 300), work, 1f, 3, out var above);
        Assert.True(above);
        Assert.Equal(500, r.X);
        Assert.Equal(300 - TabStripGeometry.Space, r.Bottom);
        Assert.Equal(3 * TabStripGeometry.Cell + 2 * TabStripGeometry.Gap + 2 * TabStripGeometry.Pad, r.Width);
    }

    [Fact]
    public void Strip_drops_inside_the_top_edge_at_the_top_of_the_screen_and_scales_with_dpi()
    {
        var work = new Rectangle(0, 0, 1920, 1040);
        var r = TabStripGeometry.Place(new Rectangle(100, 10, 400, 300), work, 1.5f, 2, out var above);
        Assert.False(above);
        Assert.True(r.Y > 10 && r.Y < 10 + 20);
        Assert.Equal((int)Math.Round(TabStripGeometry.Bar * 1.5f), r.Height);
    }
}

public class WidgetIconTests
{
    [Fact]
    public void Manifest_reads_the_optional_icon()
    {
        var json = "{\"id\":\"demo\",\"name\":\"Demo\",\"description\":\"d\",\"author\":\"a\",\"version\":\"1.0.0\",\"icon\":\"icon.png\"}";
        Assert.Equal("icon.png", WidgetManifest.Parse(json).Icon);
        Assert.Null(WidgetManifest.Parse(json.Replace(",\"icon\":\"icon.png\"", "")).Icon);
    }
}
