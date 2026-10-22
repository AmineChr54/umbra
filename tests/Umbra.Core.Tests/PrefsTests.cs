using System.Globalization;
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
        Prefs.ApplyWidget(JsonNode.Parse("""{"refreshSeconds":null,"opacity":null}""")!.AsObject(), ws);
        Assert.Null(ws.RefreshSeconds);
        Assert.Null(ws.Opacity);
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyWidget(JsonNode.Parse("""{"opacity":0.05}""")!.AsObject(), ws));
        Assert.ThrowsAny<Exception>(() => Prefs.ApplyWidget(JsonNode.Parse("""{"refreshSeconds":5}""")!.AsObject(), ws));
    }

    [Fact]
    public void Global_defaults_apply_until_a_widget_overrides_them()
    {
        var s = new Settings();
        Prefs.ApplyGeneral(JsonNode.Parse("""{"defaultOpacity":0.7,"defaultNotifications":true,"defaultScale":0.85}""")!.AsObject(), s.General);
        var ws = s.For(new WidgetManifest { Id = "demo" });
        Prefs.FollowDefaultScale(s);
        Assert.Equal(0.85, ws.Scale);
        Assert.Equal(0.7, Prefs.EffectiveOpacity(ws, s.General));
        Assert.True(Prefs.EffectiveNotifications(ws, s.General));
        Prefs.ApplyWidget(JsonNode.Parse("""{"opacity":0.5,"notifications":false}""")!.AsObject(), ws);
        Assert.Equal(0.5, Prefs.EffectiveOpacity(ws, s.General));
        Assert.False(Prefs.EffectiveNotifications(ws, s.General));
        ws.UseDefaultScale = false; // picked by hand
        s.General.DefaultScale = 1.5;
        Prefs.FollowDefaultScale(s);
        Assert.Equal(0.85, ws.Scale);
        Assert.Throws<Control.CommandException>(() => Prefs.ApplyGeneral(JsonNode.Parse("""{"defaultOpacity":0.01}""")!.AsObject(), s.General));
    }

    [Fact]
    public void Size_is_validated_and_new_installs_start_at_085()
    {
        var g = new GeneralSettings();
        Assert.Equal(0.85, g.DefaultScale);
        Assert.Equal(1.0, g.Size);
        Prefs.ApplyGeneral(JsonNode.Parse("""{"size":1.25}""")!.AsObject(), g);
        Assert.Equal(1.25, g.Size);
        Assert.Throws<Control.CommandException>(() => Prefs.ApplyGeneral(JsonNode.Parse("""{"size":2}""")!.AsObject(), g));
        Assert.Equal(0.5, Prefs.ClampSize(0));
        Assert.Equal(1.0, Prefs.ClampSize(double.NaN));
        var old = Settings.FromJson(JsonNode.Parse("""{"general":{"defaultScale":1}}""")!);
        Assert.Equal(1.0, old.General.DefaultScale); // an upgraded profile keeps what it had
    }

    [Fact]
    public void Old_settings_keep_their_values_as_overrides()
    {
        var old = Settings.FromJson(JsonNode.Parse("""{"widgets":{"a":{"scale":1.4,"opacity":0.9,"notifications":true}}}""")!);
        var ws = old.Widgets["a"];
        Assert.False(ws.UseDefaultScale);
        Prefs.FollowDefaultScale(old);
        Assert.Equal(1.4, ws.Scale);
        Assert.Equal(0.9, ws.Opacity);
        Assert.True(ws.Notifications);
        Assert.Equal(1.0, old.General.DefaultOpacity);
        Assert.False(Settings.FromJson(old.ToJson()).Widgets["a"].UseDefaultScale);
    }

    [Theory]
    [InlineData("#8B93FF", "#8b93ff")]
    [InlineData("abc", "#aabbcc")]
    [InlineData("", "")]
    public void Color_normalises(string input, string expected)
    {
        Assert.True(Prefs.TryColor(input, out var n));
        Assert.Equal(expected, n);
    }

    [Theory]
    [InlineData("red")]
    [InlineData("#12345")]
    [InlineData("#gggggg")]
    [InlineData("url(x)")]
    [InlineData("#fff;}body{display:none")]
    public void Color_rejects(string input) => Assert.False(Prefs.TryColor(input, out _));

    [Fact]
    public void General_appearance_validates_and_generates_css()
    {
        var g = new GeneralSettings();
        Prefs.ApplyGeneral(JsonNode.Parse("""{"accent":"#112233","lightText":true,"uiFont":"consolas","fontScale":1.2,"borderEnabled":false,"borderColor":"#445566"}""")!.AsObject(), g);
        var css = Prefs.AppearanceCss(g);
        Assert.Contains("--accent:#112233;", css);
        Assert.Contains("--text:#ffffff;", css);
        Assert.Contains("--font:Consolas,", css);
        Assert.Contains("--font-scale:1.2;", css);
        Assert.False(g.BorderEnabled);
        Assert.Matches(@"(?i)^:root\{(?:--[a-z0-9-]+:[#a-z0-9.,%() \/-]+;)+\}$", css);
        foreach (var bad in new[] { """{"accent":"red"}""", """{"uiFont":"Evil; x"}""", """{"fontScale":5}""", """{"borderColor":"url(x)"}""" })
            Assert.ThrowsAny<Exception>(() => Prefs.ApplyGeneral(JsonNode.Parse(bad)!.AsObject(), new GeneralSettings()));
    }

    [Theory]
    [InlineData("windows")]
    [InlineData(" Windows ")]
    public void Accent_windows_is_accepted_and_normalised(string input)
    {
        var g = new GeneralSettings();
        Prefs.ApplyGeneral(JsonNode.Parse($$"""{"accent":"{{input}}"}""")!.AsObject(), g);
        Assert.Equal("windows", g.Accent);
    }

    [Fact]
    public void Windows_accent_drives_the_accent_tokens()
    {
        var g = new GeneralSettings { Accent = "windows" };
        var sys = Prefs.FromWindows((0x00, 0x78, 0xD4), (0x60, 0xCD, 0xFF));
        var css = Prefs.AppearanceCss(g, sys);
        Assert.Contains($"--accent:{sys.Accent};--accent-strong:{sys.Strong};", css);
        Assert.Matches(@"(?i)^:root\{(?:--[a-z0-9-]+:[#a-z0-9.,%() \/-]+;)+\}$", css);
        Assert.Equal(sys.Accent, Prefs.ResolveAccent(g, sys));
        // Without a readable system color the theme wins, and a picked color ignores the system one.
        Assert.Equal("", Prefs.AppearanceCss(g, null));
        Assert.Equal("", Prefs.ResolveAccent(g, null));
        Assert.Equal("#112233", Prefs.ResolveAccent(new GeneralSettings { Accent = "#112233" }, sys));
    }

    [Fact]
    public void Dark_windows_accent_is_lightened_to_stay_readable_on_black()
    {
        var pair = Prefs.FromWindows((0x00, 0x00, 0x30), (0x00, 0x00, 0x20));
        Assert.NotEqual("#000030", pair.Accent);
        Assert.True(Contrast(pair.Accent) >= 4.4, pair.Accent);
        Assert.True(Contrast(pair.Strong) >= Contrast(pair.Accent), $"{pair.Strong} vs {pair.Accent}");
        // A bright accent is left alone.
        Assert.Equal("#0078d4", Prefs.FromWindows((0x00, 0x78, 0xD4), (0x60, 0xCD, 0xFF)).Accent);
    }

    /// <summary>WCAG contrast ratio of a "#rrggbb" color against black.</summary>
    static double Contrast(string hex)
    {
        static double Lin(string h) { var x = Convert.ToInt32(h, 16) / 255.0; return x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4); }
        var l = 0.2126 * Lin(hex[1..3]) + 0.7152 * Lin(hex[3..5]) + 0.0722 * Lin(hex[5..7]);
        return (l + 0.05) / 0.05;
    }

    [Fact]
    public void ReduceTransparency_makes_tints_solid_and_windows_opaque()
    {
        var g = new GeneralSettings { ReduceTransparency = true };
        var css = Prefs.AppearanceCss(g);
        Assert.DoesNotContain("rgba", css);
        Assert.Equal(1.0, Prefs.ClampOpacity(0.5, true));
        Assert.Equal(0.5, Prefs.ClampOpacity(0.5));
    }

    [Fact]
    public void Border_off_uses_no_color()
    {
        Prefs.Configure(new GeneralSettings { BorderEnabled = false });
        Assert.Equal(unchecked((int)0xFFFFFFFE), Prefs.BorderColorRef); // DWMWA_COLOR_NONE
        Prefs.Configure(new GeneralSettings { BorderColor = "#010203" });
        Assert.Equal(0x030201, Prefs.BorderColorRef); // COLORREF 0x00BBGGRR
        Prefs.Configure(new GeneralSettings());
    }

    [Theory]
    [InlineData("de-DE", "de-DE")]
    [InlineData("fr-FR", "fr-FR")]
    [InlineData("sr-Latn-RS", "sr-Latn-RS")]
    [InlineData("", "en-US")]
    public void Locale_is_the_bcp47_region_format(string culture, string expected) =>
        Assert.Equal(expected, Prefs.LocaleOf(CultureInfo.GetCultureInfo(culture)));

    [Fact]
    public void Hour12_follows_the_short_time_pattern()
    {
        Assert.False(Prefs.Hour12Of(CultureInfo.GetCultureInfo("de-DE")));
        Assert.False(Prefs.Hour12Of(CultureInfo.GetCultureInfo("fr-FR")));
        Assert.True(Prefs.Hour12Of(CultureInfo.GetCultureInfo("en-US")));
        var custom = (CultureInfo)CultureInfo.GetCultureInfo("en-US").Clone();
        custom.DateTimeFormat.ShortTimePattern = "HH:mm";
        Assert.False(Prefs.Hour12Of(custom));
        custom.DateTimeFormat.ShortTimePattern = "'at' h:mm tt";
        Assert.True(Prefs.Hour12Of(custom));
    }

    [Fact]
    public void ShowWhen_is_validated_and_evaluated()
    {
        var ws = new WidgetSettings();
        Prefs.ApplyWidget(JsonNode.Parse("""{"startHidden":true,"showWhen":{"from":"22:00","to":"06:00","onAc":true}}""")!.AsObject(), ws);
        Assert.True(ws.StartHidden);
        Assert.Equal("22:00", ws.ShowWhen!.From);
        Func<string, bool> none = _ => false;
        Assert.True(Prefs.RulesAllow(ws.ShowWhen, new TimeSpan(23, 0, 0), true, none));
        Assert.True(Prefs.RulesAllow(ws.ShowWhen, new TimeSpan(5, 0, 0), true, none));
        Assert.False(Prefs.RulesAllow(ws.ShowWhen, new TimeSpan(12, 0, 0), true, none));
        Assert.False(Prefs.RulesAllow(ws.ShowWhen, new TimeSpan(23, 0, 0), false, none));
        Assert.True(Prefs.RulesAllow(null, TimeSpan.Zero, false, none));
        Assert.False(Prefs.RulesAllow(new ShowRules { Monitor = "X" }, TimeSpan.Zero, true, none));
        Assert.True(Prefs.RulesAllow(new ShowRules { Monitor = "X" }, TimeSpan.Zero, true, _ => true));
        Prefs.ApplyWidget(JsonNode.Parse("""{"showWhen":null}""")!.AsObject(), ws);
        Assert.Null(ws.ShowWhen);
        foreach (var bad in new[] { """{"showWhen":{"from":"25:00","to":"06:00"}}""", """{"showWhen":{"from":"08:00"}}""", """{"showWhen":5}""" })
            Assert.ThrowsAny<Exception>(() => Prefs.ApplyWidget(JsonNode.Parse(bad)!.AsObject(), new WidgetSettings()));
    }
}
