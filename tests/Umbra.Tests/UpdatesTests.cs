namespace Umbra.Tests;

public class UpdatesTests
{
    [Theory]
    [InlineData("1.2.1", "1.2.0", 1)]
    [InlineData("1.10.0", "1.9.9", 1)]
    [InlineData("v2.0.0", "1.99.99", 1)]
    [InlineData("1.2.0", "1.2.0", 0)]
    [InlineData("1.2.0", "v1.2.0+abc", 0)]
    [InlineData("1.1.9", "1.2.0", -1)]
    [InlineData("1.2.0-beta.1", "1.2.0", -1)]
    [InlineData("1.2.0-beta.2", "1.2.0-beta.10", -1)]
    public void Compare_orders_semantic_versions(string a, string b, int expected) =>
        Assert.Equal(expected, Updates.Compare(a, b));

    [Fact]
    public void Compare_rejects_garbage()
    {
        Assert.Null(Updates.Compare("latest", "1.0.0"));
        Assert.False(Updates.IsNewer("1.0.0", "nonsense"));
        Assert.True(Updates.IsNewer("1.2.0", "1.3.0"));
        Assert.False(Updates.IsNewer("1.3.0", "1.3.0"));
    }

    static string Release(string tag = "v1.3.0", string name = "UmbraSetup-1.3.0.exe", bool draft = false, bool pre = false)
    {
        var url = $"https://github.com/AmineChr54/umbra/releases/download/{tag}/{name}";
        return $$"""
            { "tag_name": "{{tag}}", "draft": {{draft.ToString().ToLower()}}, "prerelease": {{pre.ToString().ToLower()}},
              "html_url": "https://github.com/AmineChr54/umbra/releases/tag/{{tag}}", "body": "notes",
              "assets": [ { "name": "other.zip", "browser_download_url": "https://github.com/AmineChr54/umbra/releases/download/{{tag}}/other.zip" },
                          { "name": "{{name}}", "browser_download_url": "{{url}}" } ] }
            """;
    }

    [Fact]
    public void ParseRelease_finds_the_installer()
    {
        var r = Updates.ParseRelease(Release())!;
        Assert.Equal("1.3.0", r.Version);
        Assert.Equal("UmbraSetup-1.3.0.exe", r.AssetName);
        Assert.Equal("notes", r.Notes);
    }

    [Fact]
    public void ParseRelease_ignores_drafts_prereleases_and_bad_input()
    {
        Assert.Null(Updates.ParseRelease(Release(draft: true)));
        Assert.Null(Updates.ParseRelease(Release(pre: true)));
        Assert.Null(Updates.ParseRelease(Release(tag: "v1.3.0-rc1")));
        Assert.Null(Updates.ParseRelease(Release(name: "UmbraSetup-1.4.0.exe")));
        Assert.Null(Updates.ParseRelease("not json"));
        Assert.Null(Updates.ParseRelease("[]"));
        Assert.Null(Updates.ParseRelease("""{ "tag_name": "v1.3.0", "assets": [] }"""));
    }

    [Theory]
    [InlineData("http://github.com/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://evil.example/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://github.com.evil.example/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://github.com/Other/repo/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://github.com:8443/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://user@github.com/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe")]
    [InlineData("https://github.com/AmineChr54/umbra/releases/download/v1.3.0/Other.exe")]
    public void Installer_urls_must_be_https_github_release_downloads(string url) =>
        Assert.False(Updates.IsValidInstaller(url, "UmbraSetup-1.3.0.exe", "1.3.0"));

    [Theory]
    [InlineData("UmbraSetup-1.3.1.exe")]
    [InlineData("umbrasetup-1.3.0.exe")]
    [InlineData("UmbraSetup-1.3.0.msi")]
    [InlineData("UmbraSetup-1.3.exe")]
    [InlineData("x/UmbraSetup-1.3.0.exe")]
    public void Installer_names_must_match_the_release_version(string name) =>
        Assert.False(Updates.IsValidInstaller($"https://github.com/AmineChr54/umbra/releases/download/v1.3.0/{name}", name, "1.3.0"));

    [Fact]
    public void Valid_installer_and_protocol_entries()
    {
        Assert.True(Updates.IsValidInstaller("https://github.com/AmineChr54/umbra/releases/download/v1.3.0/UmbraSetup-1.3.0.exe", "UmbraSetup-1.3.0.exe", "1.3.0"));
        Assert.Contains(Protocol.Commands, c => c.Cmd == "check-update");
        Assert.True(new GeneralSettings().CheckForUpdates);
    }

    [Theory]
    [InlineData("github.com", true)]
    [InlineData("objects.githubusercontent.com", true)]
    [InlineData("release-assets.githubusercontent.com", true)]
    [InlineData("evilgithubusercontent.com", false)]
    [InlineData("githubusercontent.com.evil.example", false)]
    [InlineData("example.com", false)]
    public void Download_hosts_are_allow_listed(string host, bool ok) => Assert.Equal(ok, Updates.IsAllowedDownloadHost(host));

    [Fact]
    public void Digest_must_match_sha256()
    {
        var hex = new string('a', 64);
        Assert.True(Updates.DigestMatches("sha256:" + hex.ToUpper(), hex));
        Assert.False(Updates.DigestMatches("sha256:" + new string('b', 64), hex));
        Assert.False(Updates.DigestMatches(null, hex));
        Assert.False(Updates.DigestMatches("sha1:" + hex, hex));
    }

    [Fact]
    public void ParseRelease_keeps_the_asset_digest()
    {
        var json = Release().Replace("\"name\": \"UmbraSetup-1.3.0.exe\"", "\"name\": \"UmbraSetup-1.3.0.exe\", \"digest\": \"sha256:" + new string('c', 64) + "\"");
        Assert.Equal("sha256:" + new string('c', 64), Updates.ParseRelease(json)!.Digest);
        Assert.Null(Updates.ParseRelease(Release())!.Digest);
    }

    [Theory]
    [InlineData("1.4.0", "1.5.0", true)]
    [InlineData("1.9.9", "1.10.0", true)]
    [InlineData("1.5.0", "1.5.0", false)]
    [InlineData("1.5.0", "1.4.0", false)]
    [InlineData("", "1.5.0", false)]   // first install: nothing to announce
    [InlineData(null, "1.5.0", false)]
    [InlineData("garbage", "1.5.0", false)]
    public void ShouldAnnounce_only_after_a_real_update(string? lastSeen, string current, bool expected) =>
        Assert.Equal(expected, Updates.ShouldAnnounce(lastSeen, current));

    [Theory]
    [InlineData("", "1.5.0", "1.5.0")]      // first install records the running version
    [InlineData("1.4.0", "1.5.0", "1.5.0")] // update
    [InlineData("1.5.0", "1.5.0", "1.5.0")]
    [InlineData("1.5.0", "1.4.0", "1.5.0")] // a downgrade must not make the next upgrade announce again
    [InlineData("garbage", "1.5.0", "1.5.0")]
    public void NextLastSeen_never_goes_backwards(string lastSeen, string current, string expected) =>
        Assert.Equal(expected, Updates.NextLastSeen(lastSeen, current));

    [Fact]
    public void Announcing_happens_once_per_version()
    {
        var seen = "1.4.0";
        var shown = 0;
        foreach (var run in new[] { "1.5.0", "1.5.0", "1.5.0", "1.6.0", "1.6.0" })
        {
            if (Updates.ShouldAnnounce(seen, run)) shown++;
            seen = Updates.NextLastSeen(seen, run);
        }
        Assert.Equal(2, shown);
    }

    [Fact]
    public void Release_notes_urls_are_fixed_github_addresses()
    {
        Assert.Equal("https://api.github.com/repos/AmineChr54/umbra/releases/tags/v1.5.0", Updates.ReleaseByTagApi("1.5.0"));
        Assert.Equal("https://github.com/AmineChr54/umbra/releases/tag/v1.5.0", Updates.ReleasePageUrl("1.5.0"));
    }

    [Fact]
    public void Settings_keep_the_last_seen_version_in_the_file()
    {
        var s = new Settings();
        Assert.Equal("", s.General.LastSeenVersion);
        s.General.LastSeenVersion = "1.5.0";
        Assert.Equal("1.5.0", Settings.FromJson(s.ToJson()).General.LastSeenVersion);
    }
}
