extern alias cli;

using System.Text;
using System.Text.Json.Nodes;
using CommandLine = cli::Umbra.Cli.CommandLine;
using McpServer = cli::Umbra.Cli.McpServer;

namespace Umbra.Tests;

public class ThemeTests
{
    public ThemeTests() => TestEnv.Init();

    static string Json(string id, string tokens = "\"--accent\": \"#ff8a3d\"", string extra = "") =>
        $$"""{ "id": "{{id}}", "name": "T", "description": "d", "author": "a", "version": "1.0.0"{{extra}}, "tokens": { {{tokens}} } }""";

    static string NewId() => "theme-" + Guid.NewGuid().ToString("N")[..8];

    [Theory]
    [InlineData("--accent", "#fff", true)]
    [InlineData("--accent", "#8b93ffcc", true)]
    [InlineData("--line", "rgba(255, 255, 255, 0.07)", true)]
    [InlineData("--line", "rgb(255 255 255 / 0.5)", true)]
    [InlineData("--text", "hsl(210, 40%, 96%)", true)]
    [InlineData("--radius-m", "12px", true)]
    [InlineData("--radius-l", "1.5rem", true)]
    [InlineData("--accent", "red", false)]
    [InlineData("--accent", "url(https://evil.example/x.png)", false)]
    [InlineData("--accent", "#fff; background: url(x)", false)]
    [InlineData("--accent", "#fff}body{display:none", false)]
    [InlineData("--accent", "var(--text)", false)]
    [InlineData("--accent", "rgb(0,0,0) !important", false)]
    [InlineData("--radius-m", "100px", false)]
    [InlineData("--radius-m", "12", false)]
    [InlineData("--radius-m", "calc(1px)", false)]
    [InlineData("--font", "Arial", false)]
    [InlineData("--evil", "#fff", false)]
    [InlineData("accent", "#fff", false)]
    public void Token_names_and_values_are_validated(string name, string value, bool ok) =>
        Assert.Equal(ok, Theme.IsValidToken(name, value));

    [Fact]
    public void Parse_reads_a_valid_theme_and_builds_only_validated_css()
    {
        var t = Theme.Parse(Json("ember", "\"--accent\": \"#ff8a3d\", \"--radius-m\": \"4px\""));
        Assert.Equal("ember", t.Id);
        Assert.Equal(":root{--accent:#ff8a3d;--radius-m:4px;}", t.ToCss());
    }

    [Fact]
    public void Default_theme_has_no_overrides_and_unknown_ids_fall_back_to_it()
    {
        Assert.Equal("", Theme.Default.ToCss());
        Assert.Equal("", Theme.CssFor("default"));
        Assert.Equal("", Theme.CssFor("no-such-theme"));
        Assert.Equal("", Theme.CssFor(null));
    }

    [Theory]
    [InlineData("{ not json")]
    [InlineData("[]")]
    [InlineData("""{ "id": "x" }""")]
    public void Parse_rejects_malformed_files(string text) => Assert.Throws<InvalidOperationException>(() => Theme.Parse(text));

    [Fact]
    public void Parse_rejects_bad_ids_unknown_keys_and_tokens()
    {
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("Bad Id")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", extra: ", \"css\": \"body{}\"")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", "\"--evil\": \"#fff\"")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", "\"--accent\": \"url(https://x/y)\"")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", "")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", extra: ", \"preview\": \"../p.png\"")));
        Assert.Throws<InvalidOperationException>(() => Theme.Parse(Json("fine-id", extra: ", \"preview\": \"x.html\"")));
    }

    [Fact]
    public void CommitTheme_installs_a_valid_theme_and_it_can_be_discovered_and_removed()
    {
        var id = NewId();
        Community.CommitTheme(id, new Dictionary<string, byte[]> { ["theme.json"] = Encoding.UTF8.GetBytes(Json(id)) });
        Assert.Contains(Theme.DiscoverAll(), t => t.Id == id);
        Assert.Equal(":root{--accent:#ff8a3d;}", Theme.CssFor(id));

        Community.RemoveTheme(id);
        Assert.DoesNotContain(Theme.DiscoverAll(), t => t.Id == id);
        Assert.Equal("", Theme.CssFor(id));
    }

    [Fact]
    public void CommitTheme_refuses_a_mismatched_or_invalid_theme_and_writes_nothing()
    {
        var id = NewId();
        Assert.Throws<InvalidOperationException>(() =>
            Community.CommitTheme(id, new Dictionary<string, byte[]> { ["theme.json"] = Encoding.UTF8.GetBytes(Json("other-id")) }));
        Assert.Throws<InvalidOperationException>(() =>
            Community.CommitTheme(id, new Dictionary<string, byte[]> { ["theme.json"] = Encoding.UTF8.GetBytes(Json(id, "\"--accent\": \"url(x)\"")) }));
        Assert.Throws<InvalidOperationException>(() =>
            Community.CommitTheme(id, new Dictionary<string, byte[]> { ["theme.json"] = Encoding.UTF8.GetBytes(Json(id, extra: ", \"preview\": \"p.png\"")) }));
        Assert.Throws<InvalidOperationException>(() =>
            Community.CommitTheme(id, new Dictionary<string, byte[]>()));
        Assert.False(Directory.Exists(Path.Combine(Theme.Dir, id)));
    }

    [Fact]
    public async Task Install_from_a_local_catalog_rejects_unsafe_file_paths()
    {
        var entry = new JsonObject { ["id"] = NewId(), ["files"] = new JsonArray("theme.json", "../evil.json") };
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.InstallThemeAsync(entry));
        var script = new JsonObject { ["id"] = NewId(), ["files"] = new JsonArray("theme.json", "run.js") };
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.InstallThemeAsync(script));
        var builtin = new JsonObject { ["id"] = "default", ["files"] = new JsonArray("theme.json") };
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.InstallThemeAsync(builtin));
    }

    [Fact]
    public void Listing_merges_installed_and_catalog_and_drops_unsafe_catalog_tokens()
    {
        var id = NewId();
        Community.CommitTheme(id, new Dictionary<string, byte[]> { ["theme.json"] = Encoding.UTF8.GetBytes(Json(id)) });
        var remote = NewId();
        var catalog = new JsonArray(
            new JsonObject { ["id"] = id, ["version"] = "1.1.0", ["files"] = new JsonArray("theme.json") },
            new JsonObject
            {
                ["id"] = remote, ["name"] = "R", ["version"] = "1.0.0", ["files"] = new JsonArray("theme.json"),
                ["tokens"] = new JsonObject { ["--accent"] = "#123456", ["--bg"] = "url(https://evil.example/p.png)", ["--evil"] = "#fff" },
            });

        var list = Theme.Listing(catalog).OfType<JsonObject>().ToList();
        Assert.Equal("default", list[0]["id"]!.GetValue<string>());
        Assert.True(list.Single(t => t["id"]!.GetValue<string>() == id)["updateAvailable"]!.GetValue<bool>());
        var r = list.Single(t => t["id"]!.GetValue<string>() == remote);
        Assert.False(r["installed"]!.GetValue<bool>());
        Assert.Null(r["files"]);
        var tokens = r["tokens"]!.AsObject();
        Assert.Equal("#123456", tokens["--accent"]!.GetValue<string>());
        Assert.False(tokens.ContainsKey("--bg"));
        Assert.False(tokens.ContainsKey("--evil"));
        Community.RemoveTheme(id);
    }

    [Fact]
    public void Settings_default_to_the_default_theme()
    {
        Assert.Equal("default", new Settings().General.Theme);
        Assert.Equal("ember", Settings.FromJson(new Settings { General = { Theme = "ember" } }.ToJson()).General.Theme);
    }

    [Fact]
    public void Widget_manifests_are_themeable_unless_they_opt_out()
    {
        const string basic = """{ "id": "demo", "name": "D", "description": "d", "author": "a", "version": "1.0.0" }""";
        Assert.True(WidgetManifest.Parse(basic).Themeable);
        Assert.False(WidgetManifest.Parse(basic.Replace("\"version\"", "\"themeable\": false, \"version\"")).Themeable);
    }

    [Fact]
    public void The_repo_themes_in_the_catalog_are_all_valid()
    {
        var root = AppContext.BaseDirectory;
        while (root is not null && !Directory.Exists(Path.Combine(root, "themes"))) root = Path.GetDirectoryName(root);
        Assert.NotNull(root);
        var dirs = Directory.GetDirectories(Path.Combine(root!, "themes"));
        Assert.NotEmpty(dirs);
        foreach (var dir in dirs)
        {
            var t = Theme.Parse(File.ReadAllText(Path.Combine(dir, "theme.json")));
            Assert.Equal(Path.GetFileName(dir), t.Id);
        }
    }

    [Fact]
    public async Task Cli_maps_theme_commands_and_mcp_exposes_tools()
    {
        static Task<JsonObject> NoSend(string c, JsonObject a) => Task.FromResult(Protocol.Ok(null));
        var (c1, a1) = await CommandLine.TranslateAsync(new[] { "theme" }, NoSend);
        Assert.Equal("theme", c1); Assert.Empty(a1);
        var (c2, a2) = await CommandLine.TranslateAsync(new[] { "theme", "ember" }, NoSend);
        Assert.Equal("theme", c2); Assert.Equal("ember", a2["id"]!.GetValue<string>());
        Assert.Equal("themes", (await CommandLine.TranslateAsync(new[] { "themes" }, NoSend)).Cmd);
        var (c3, a3) = await CommandLine.TranslateAsync(new[] { "install-theme", "ember" }, NoSend);
        Assert.Equal("install-theme", c3); Assert.Equal("ember", a3["id"]!.GetValue<string>());
        Assert.Equal("remove-theme", (await CommandLine.TranslateAsync(new[] { "remove-theme", "ember" }, NoSend)).Cmd);

        var cmds = Protocol.Commands.Select(c => c.Cmd).ToList();
        Assert.All(new[] { "theme", "themes", "install-theme", "remove-theme" }, c => Assert.Contains(c, cmds));
        Assert.All(new[] { "theme", "list_themes", "install_theme", "remove_theme" }, n => Assert.Contains(n, McpServer.ToolNames));
    }
}
