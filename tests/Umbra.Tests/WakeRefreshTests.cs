namespace Umbra.Tests;

public class WakeRefreshTests
{
    static readonly DateTime T0 = new(2026, 1, 1, 12, 0, 0);
    static DateTime At(double seconds) => T0.AddSeconds(seconds);

    [Fact]
    public void A_request_fires_once_after_its_delay()
    {
        var c = new RefreshCoalescer();
        var due = c.Request("resume", TimeSpan.FromSeconds(3), T0);

        Assert.Equal(At(3), due);
        Assert.Null(c.Take(At(2.9)));
        Assert.Equal("resume", c.Take(At(3)));
        Assert.Null(c.Take(At(4))); // consumed
        Assert.Null(c.Due);
    }

    [Fact]
    public void Triggers_close_together_become_one_refresh_naming_both()
    {
        var c = new RefreshCoalescer();
        c.Request("resume", TimeSpan.FromSeconds(3), T0);
        c.Request("network", TimeSpan.FromSeconds(2), At(1));
        c.Request("network", TimeSpan.FromSeconds(2), At(1.5)); // flapping adapter

        Assert.Equal("resume + network", c.Take(At(3)));
        Assert.Null(c.Take(At(10)));
    }

    [Fact]
    public void A_request_inside_the_gap_is_deferred_not_dropped()
    {
        var c = new RefreshCoalescer();
        c.Request("resume", TimeSpan.FromSeconds(3), T0);
        Assert.NotNull(c.Take(At(3)));

        var due = c.Request("network", TimeSpan.FromSeconds(2), At(5)); // Wi-Fi up 2 s after the first refresh

        Assert.Equal(At(3) + RefreshCoalescer.MinGap, due);
        Assert.Null(c.Take(At(12.9)));
        Assert.Equal("network", c.Take(At(13)));
    }

    [Fact]
    public void Never_two_refreshes_closer_than_the_gap()
    {
        var c = new RefreshCoalescer();
        var last = (DateTime?)null;
        for (var s = 0.0; s < 120; s += 0.5)
        {
            if (s % 1.5 == 0) c.Request("network", TimeSpan.FromSeconds(2), At(s));
            if (c.Take(At(s)) is null) continue;
            if (last is { } l) Assert.True(At(s) - l >= RefreshCoalescer.MinGap);
            last = At(s);
        }
        Assert.NotNull(last);
    }

    [Fact]
    public void A_request_after_the_gap_uses_its_own_delay()
    {
        var c = new RefreshCoalescer();
        c.Request("resume", TimeSpan.FromSeconds(3), T0);
        c.Take(At(3));

        Assert.Equal(At(60) + WakeRefresh.UnlockDelay, c.Request("unlock", WakeRefresh.UnlockDelay, At(60)));
    }
}
