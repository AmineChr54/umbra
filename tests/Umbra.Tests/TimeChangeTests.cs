namespace Umbra.Tests;

public class TimeChangeTests
{
    [Fact]
    public void Signature_names_the_local_zone_and_is_stable()
    {
        var a = TimeChange.Signature();
        Assert.StartsWith(TimeZoneInfo.Local.Id + "|", a);
        Assert.Equal(a, TimeChange.Signature());
    }

    [Fact]
    public void Only_a_different_signature_counts_as_a_zone_change()
    {
        Assert.False(TimeChange.ZoneChanged(null, "Europe/Berlin|36000000000"));
        Assert.False(TimeChange.ZoneChanged("Europe/Berlin|36000000000", "Europe/Berlin|36000000000"));
        Assert.True(TimeChange.ZoneChanged("Europe/Berlin|36000000000", "Asia/Tokyo|324000000000"));
        Assert.True(TimeChange.ZoneChanged("Europe/Berlin|36000000000", "Europe/Berlin|72000000000"));
    }

    [Fact]
    public void Message_is_the_type_the_sdk_listens_for()
    {
        var m = TimeChange.Message();
        Assert.Equal("timeChanged", m["type"]!.GetValue<string>());
        Assert.Single(m);
    }
}
