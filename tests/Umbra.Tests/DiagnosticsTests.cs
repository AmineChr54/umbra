namespace Umbra.Tests;

public class DiagnosticsTests
{
    static Diagnostics.Snapshot Sample(string proxy = "system", params string[] log) => new(
        "1.2.3", false, true, "Windows 11 Pro 24H2 (build 26200.1), x64", "130.0.1",
        new[] { new Diagnostics.MonitorLine(2560, 1440, 144, true), new Diagnostics.MonitorLine(1920, 1080, 96, false) },
        false, proxy, new[] { new Diagnostics.WidgetLine("sp500", "1.4.0", "community") }, log);

    [Fact]
    public void Report_lists_the_basics_and_the_log()
    {
        var text = Diagnostics.Format(Sample("system", "line one", "line two"));
        Assert.Contains("**Umbra:** 1.2.3, installed, safe mode on", text);
        Assert.Contains("**Windows:** Windows 11 Pro 24H2 (build 26200.1), x64", text);
        Assert.Contains("**WebView2 runtime:** 130.0.1", text);
        Assert.Contains("2560x1440 at 150% (primary); 1920x1080 at 100%", text);
        Assert.Contains("**GPU acceleration:** off", text);
        Assert.Contains("**Enabled widgets (1):** sp500 1.4.0 (community)", text);
        Assert.Contains("Last 2 log lines", text);
        Assert.Contains("line one" + Environment.NewLine + "line two", text);
    }

    [Theory]
    [InlineData("system", "system default")]
    [InlineData("none", "none (direct connection)")]
    [InlineData("https://user:pw@proxy.corp.example:8080", "custom proxy set")]
    public void Proxy_never_shows_its_address(string setting, string expected)
    {
        Assert.Equal(expected, Diagnostics.ProxyKind(setting));
        var text = Diagnostics.Format(Sample(Diagnostics.ProxyKind(setting)));
        Assert.DoesNotContain("corp.example", text);
        Assert.DoesNotContain("pw@", text);
    }

    [Fact]
    public void Windows_11_is_named_by_its_build_number()
    {
        Assert.StartsWith("Windows 11 Pro 24H2 (build 26200.1000)", Diagnostics.WindowsText("Windows 10 Pro", "24H2", "26200", 1000));
        Assert.StartsWith("Windows 10 Pro 22H2 (build 19045)", Diagnostics.WindowsText("Windows 10 Pro", "22H2", "19045", null));
        Assert.StartsWith("Windows", Diagnostics.WindowsText(null, null, null, null));
    }

    [Fact]
    public void Log_paths_are_replaced_and_the_user_name_is_gone()
    {
        var roots = new[]
        {
            (@"C:\Users\alice\AppData\Roaming", "%APPDATA%"),
            (@"C:\Users\alice\AppData\Local", "%LOCALAPPDATA%"),
            (@"C:\Users\alice", "%USERPROFILE%"),
            ("https://proxy.corp.example:8080", "<proxy>"),
        };
        var scrubbed = Diagnostics.ScrubLog(new[]
        {
            @"10:00  Widget failed: C:\Users\alice\AppData\Roaming\Umbra\widgets\x\widget.json",
            @"10:01  read c:\users\ALICE\AppData\Local\Umbra\WebView2 and C:/Users/alice/Desktop/a.txt",
            @"10:02  other profile D:\Users\bob\Documents\x.json",
            "10:03  fetch via https://proxy.corp.example:8080 failed",
        }, roots);

        Assert.Equal(@"10:00  Widget failed: %APPDATA%\Umbra\widgets\x\widget.json", scrubbed[0]);
        Assert.Equal(@"10:01  read %LOCALAPPDATA%\Umbra\WebView2 and %USERPROFILE%/Desktop/a.txt", scrubbed[1]);
        Assert.Equal(@"10:02  other profile %USERPROFILE%\Documents\x.json", scrubbed[2]);
        Assert.Equal("10:03  fetch via <proxy> failed", scrubbed[3]);
        Assert.All(scrubbed, l => Assert.DoesNotContain("alice", l, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Url_queries_and_fragments_are_stripped_and_user_and_machine_names_hidden()
    {
        var scrubbed = Diagnostics.ScrubLog(new[]
        {
            "10:00  GET https://api.example.com/v1/quote?symbol=X&key=SECRET#frag failed",
            "10:01  (http://host:8080/a/b?token=SECRET) and \"https://x.test/p?k=SECRET\"",
            "10:02  host DESKTOP-ABC123 user carol",
        }, Array.Empty<(string, string)>(), new[] { ("carol", "<user>"), ("DESKTOP-ABC123", "<machine>") });

        Assert.Equal("10:00  GET https://api.example.com/v1/quote failed", scrubbed[0]);
        Assert.Equal("10:01  (http://host:8080/a/b) and \"https://x.test/p\"", scrubbed[1]);
        Assert.Equal("10:02  host <machine> user <user>", scrubbed[2]);
        Assert.All(scrubbed, l => Assert.DoesNotContain("SECRET", l));
    }

    [Fact]
    public void Very_long_log_lines_are_cut()
    {
        var line = Diagnostics.ScrubLog(new[] { new string('x', 5000) }, Array.Empty<(string, string)>()).Single();
        Assert.True(line.Length < 400);
    }

    [Fact]
    public void Issue_link_prefills_version_and_windows_only()
    {
        var snap = Sample();
        var url = Diagnostics.IssueUrl("AmineChr54/umbra", snap.Version, Diagnostics.IssueWindows(snap));
        Assert.StartsWith("https://github.com/AmineChr54/umbra/issues/new?template=bug.yml&version=1.2.3&windows=", url);
        Assert.Contains(Uri.EscapeDataString("Windows 11 Pro 24H2 (build 26200.1), x64, 2560x1440 at 150% (primary)"), url);
        Assert.DoesNotContain("log", url);
    }
}
