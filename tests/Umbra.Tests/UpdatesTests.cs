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
}
