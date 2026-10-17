using Microsoft.Win32;
using Xunit;

namespace Umbra.Tests;

public class PowerPolicyTests
{
    [Fact]
    public void Energy_saver_stretches_the_interval_only_when_allowed()
    {
        Assert.Equal(240, PowerPolicy.Refresh(60, energySaver: true, slowOnEnergySaver: true));
        Assert.Equal(60, PowerPolicy.Refresh(60, energySaver: true, slowOnEnergySaver: false));
        Assert.Equal(60, PowerPolicy.Refresh(60, energySaver: false, slowOnEnergySaver: true));
    }

    [Fact]
    public void Slowing_down_on_energy_saver_is_on_by_default()
    {
        Assert.True(new GeneralSettings().SlowOnEnergySaver);
    }

    [Theory]
    [InlineData(0, true)]   // display off
    [InlineData(1, false)]  // on
    [InlineData(2, false)]  // dimmed
    public void Only_display_state_zero_means_off(int state, bool off) => Assert.Equal(off, PowerPolicy.DisplayOff(state));

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    public void Saver_status_is_non_zero_when_on(int state, bool on) => Assert.Equal(on, PowerPolicy.SaverOn(state));

    [Fact]
    public void Only_lock_and_unlock_change_the_locked_state()
    {
        Assert.True(PowerPolicy.LockChange(SessionSwitchReason.SessionLock));
        Assert.False(PowerPolicy.LockChange(SessionSwitchReason.SessionUnlock));
        Assert.Null(PowerPolicy.LockChange(SessionSwitchReason.ConsoleConnect));
        Assert.Null(PowerPolicy.LockChange(SessionSwitchReason.RemoteDisconnect));
    }
}
