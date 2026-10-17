using System.Text.Json.Nodes;
using Xunit;
using Umbra;

namespace Umbra.Tests;

public class PrefsTests
{
    [Theory]
    [InlineData("", "system")]
    [InlineData("System", "system")]
    [InlineData("none", "none")]
    [InlineData("proxy.example:8080", "https://proxy.example:8080")]
    [InlineData("http://10.0.0.1:3128/", "http://10.0.0.1:3128")]
    public void Proxy_parses(string input, string expected)
    {
        Assert.True(Prefs.TryParseProxy(input, out var n, out _));
        Assert.Equal(expected, n);
    }

    [Theory]
    [InlineData("ftp://x")]
    [InlineData("https://user:pw@x:1")]
    [InlineData("https://x/path")]
    [InlineData("https://")]
    public void Proxy_rejects(string input)
    {
        Assert.False(Prefs.TryParseProxy(input, out _, out var err));
        Assert.NotEmpty(err);
    }

    [Fact]
    public void Log_levels_filter()
    {
        Assert.False(Log.ShouldWrite("errors", "Umbra started", false));
        Assert.True(Log.ShouldWrite("errors", "Could not save settings", false));
        Assert.True(Log.ShouldWrite("normal", "Umbra started", false));
        Assert.False(Log.ShouldWrite("normal", "detail", true));
        Assert.True(Log.ShouldWrite("verbose", "detail", true));
    }

    [Fact]
    public void Appearance_css_is_a_plain_root_rule()
    {
        Assert.Equal("", Prefs.AppearanceCss(new GeneralSettings()));
        var css = Prefs.AppearanceCss(new GeneralSettings { CornerRadius = "sharp", AnimationSpeed = "calm" });
        Assert.Equal(":root{--radius-s:2px;--radius-m:3px;--radius-l:4px;--motion-scale:2;}", css);
        Assert.False(Prefs.MotionOn(new GeneralSettings { AnimationSpeed = "off" }));
    }

    [Fact]
    public void WebView_arguments()
    {
        Assert.Null(Prefs.WebViewArguments(new GeneralSettings()));
        Assert.Equal("--disable-gpu --proxy-server=https://p:1", Prefs.WebViewArguments(new GeneralSettings { HardwareAcceleration = false, Proxy = "https://p:1" }));
        Assert.Equal("--no-proxy-server", Prefs.WebViewArguments(new GeneralSettings { Proxy = "none" }));
    }

    [Fact]
    public void ApplyGeneral_validates()
    {
        var g = new GeneralSettings();
        Prefs.ApplyGeneral(JsonNode.Parse("""{"cornerRadius":"round","logLevel":"verbose","startupDelaySeconds":30,"proxy":"none","defaultScale":9}""")!.AsObject(), g);
        Assert.Equal("round", g.CornerRadius);
        Assert.Equal("verbose", g.LogLevel);
        Assert.Equal(30, g.StartupDelaySeconds);
        Assert.Equal("none", g.Proxy);
        Assert.Equal(3.0, g.DefaultScale);
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyGeneral(JsonNode.Parse("""{"logLevel":"loud"}""")!.AsObject(), g));
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyGeneral(JsonNode.Parse("""{"startupDelaySeconds":999}""")!.AsObject(), g));
    }

    [Fact]
    public void ApplyWidget_sets_and_clears_overrides()
    {
        var ws = new WidgetSettings();
        Prefs.ApplyWidget(JsonNode.Parse("""{"refreshSeconds":120,"opacity":0.8}""")!.AsObject(), ws);
        Assert.Equal(120, Prefs.EffectiveRefresh(ws, new GeneralSettings { RefreshSeconds = 60 }));
        Assert.Equal(0.8, ws.Opacity);
        Prefs.ApplyWidget(JsonNode.Parse("""{"refreshSeconds":null,"opacity":1}""")!.AsObject(), ws);
        Assert.Null(ws.RefreshSeconds);
        Assert.Null(ws.Opacity);
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyWidget(JsonNode.Parse("""{"opacity":0.05}""")!.AsObject(), ws));
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyWidget(JsonNode.Parse("""{"refreshSeconds":5}""")!.AsObject(), ws));
    }
}
