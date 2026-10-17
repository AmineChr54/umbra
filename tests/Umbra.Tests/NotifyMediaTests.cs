namespace Umbra.Tests;

public class NotifyMediaTests
{
    [Fact]
    public void Notifier_limits_five_per_ten_minutes_per_widget()
    {
        var n = new Notifier();
        var t = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 5; i++) Assert.True(n.TryAcquire("a", t.AddSeconds(i)));
        Assert.False(n.TryAcquire("a", t.AddMinutes(5)));
        Assert.True(n.TryAcquire("b", t.AddMinutes(5)));
        Assert.True(n.TryAcquire("a", t.AddMinutes(10)));
    }

    [Fact]
    public void Clean_flattens_and_caps_text()
    {
        Assert.Equal("a b", Notifier.Clean("a\nb  ", 10));
        Assert.Equal(5, Notifier.Clean(new string('x', 50), 5).Length);
    }

    [Fact]
    public void Manifest_validates_media_and_notifications()
    {
        var m = WidgetManifest.Parse("""{ "id": "np", "name": "N", "permissions": { "media": ["read", "control"], "notifications": true } }""");
        Assert.True(m.Permissions.Notifications);
        Assert.Equal(2, m.Permissions.Media.Count);
        Assert.Throws<InvalidOperationException>(() =>
            WidgetManifest.Parse("""{ "id": "np", "name": "N", "permissions": { "media": ["record"] } }"""));
    }

    [Fact]
    public void Media_sniffs_images_and_commands()
    {
        Assert.Equal("image/png", MediaService.SniffImage([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0]));
        Assert.Equal("image/jpeg", MediaService.SniffImage([0xFF, 0xD8, 0xFF, 0xE0]));
        Assert.Null(MediaService.SniffImage("<svg onload=x>"u8));
        Assert.True(MediaService.IsCommand("next"));
        Assert.False(MediaService.IsCommand("shutdown"));
    }
}
