namespace Umbra.Tests;

public class PlacementTests
{
    static readonly MonitorInfo Main = new(@"\\.\DISPLAY1", new Rectangle(0, 0, 1920, 1080), new Rectangle(0, 0, 1920, 1040), true);
    static readonly MonitorInfo Side = new(@"\\.\DISPLAY2", new Rectangle(1920, 0, 1280, 1024), new Rectangle(1920, 0, 1280, 1024), false);
    static readonly Size Size = new(300, 200);

    [Fact]
    public void Resolve_puts_the_widget_at_its_offset_on_the_saved_monitor() =>
        Assert.Equal(new Point(1920 + 100, 50), Placement.Resolve(new[] { Main, Side }, Side.Name, 100, 50, Size));

    [Fact]
    public void Resolve_falls_back_to_primary_when_the_monitor_is_unplugged() =>
        Assert.Equal(new Point(100, 50), Placement.Resolve(new[] { Main }, Side.Name, 100, 50, Size));

    [Fact]
    public void Resolve_pulls_the_widget_inside_a_smaller_monitor() =>
        Assert.Equal(new Point(1920 + 1280 - 300, 1024 - 200), Placement.Resolve(new[] { Main, Side }, Side.Name, 2000, 2000, Size));

    [Fact]
    public void Find_picks_the_monitor_under_the_window_centre()
    {
        Assert.Equal(Side.Name, Placement.Find(new[] { Main, Side }, new Rectangle(2000, 100, 300, 200))!.Value.Name);
        Assert.Equal(Main.Name, Placement.Find(new[] { Main, Side }, new Rectangle(10, 10, 300, 200))!.Value.Name);
    }

    [Theory]
    [InlineData(1, false)]
    [InlineData(2, true)]
    [InlineData(3, true)]
    [InlineData(4, true)]
    [InlineData(5, false)]
    [InlineData(7, false)]
    public void Only_fullscreen_notification_states_hide_widgets(int state, bool expected) =>
        Assert.Equal(expected, Placement.IsFullscreenState(state));

    [Fact]
    public void Peek_is_a_hotkey_action_and_a_control_command()
    {
        Assert.True(Hotkey.IsAction("peek"));
        Assert.Contains(Protocol.Commands, c => c.Cmd == "peek");
    }

    [Fact]
    public void New_settings_default_to_off_and_five_seconds()
    {
        var g = new GeneralSettings();
        Assert.False(g.HideOnFullscreen);
        Assert.Equal(5, g.PeekSeconds);
    }
}
