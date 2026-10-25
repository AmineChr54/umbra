using System.Text;
using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>An update that adds hosts, system/media/notification access or commands is never applied without the user's accept.</summary>
public class PermissionDiffTests
{
    public PermissionDiffTests() => TestEnv.Init();

    static WidgetManifest M(string permissions = "{}", string version = "1.0.0", string id = "demo") =>
        WidgetManifest.Parse($$"""{ "id": "{{id}}", "name": "Demo", "version": "{{version}}", "permissions": {{permissions}} }""");

    [Fact]
    public void Changelog_is_first_line_without_control_chars_and_capped()
    {
        var m = Cl("Fixed" + (char)7 + " bug" + (char)10 + "Second line");
        Assert.Equal("Fixed bug", m.Changelog);
        var big = Cl(new string((char)120, 900));
        Assert.Equal(500, big.Changelog!.Length);
    }

    static WidgetManifest Cl(string c) => WidgetManifest.Parse(new JsonObject { ["id"] = "demo", ["name"] = "D", ["version"] = "1.0.0", ["changelog"] = c }.ToJsonString());

    [Fact]
    public void Same_permissions_have_no_diff() =>
        Assert.True(PermissionDiff.Compute(M("""{ "hosts": ["a.example.com"], "notifications": true }"""), M("""{ "hosts": ["a.example.com"], "notifications": true }""", "1.1.0")).IsEmpty);

    [Fact]
    public void Added_hosts_system_media_and_notifications_are_listed()
    {
        var d = PermissionDiff.Compute(
            M("""{ "hosts": ["a.example.com"], "media": ["read"] }"""),
            M("""{ "hosts": ["A.example.com", "api.example.org"], "system": ["cpu"], "media": ["read", "control"], "notifications": true }"""));
        Assert.Equal(new[] { "api.example.org" }, d.Hosts);       // host names compare case-insensitively
        Assert.Equal(new[] { "cpu" }, d.System);
        Assert.Equal(new[] { "control" }, d.Media);
        Assert.True(d.Notifications);
        Assert.False(d.IsEmpty);
        Assert.Equal(4, d.Describe().Count);
    }

    [Fact]
    public void Removing_permissions_is_not_a_diff() =>
        Assert.True(PermissionDiff.Compute(M("""{ "hosts": ["a.example.com", "b.example.com"], "system": ["cpu"], "notifications": true }"""), M("""{ "hosts": ["a.example.com"] }""")).IsEmpty);

    [Fact]
    public void New_or_changed_commands_are_listed_but_unchanged_ones_are_not()
    {
        var old = M("""{ "commands": [{ "id": "a", "run": ["claude", "-p", "Hi"] }, { "id": "b", "run": ["git", "status"] }] }""");
        var now = M("""
            { "commands": [{ "id": "a", "run": ["claude", "-p", "Hi"], "description": "only the text changed" },
                           { "id": "b", "run": ["git", "push"] }, { "id": "c", "run": ["git", "fetch"] }] }
            """);
        var d = PermissionDiff.Compute(old, now);
        Assert.Equal(new[] { "b", "c" }, d.Commands.Select(c => c.Id));
    }

    [Fact]
    public void A_missing_installed_copy_means_everything_is_new()
    {
        var d = PermissionDiff.Compute(null, M("""{ "hosts": ["a.example.com"] }"""));
        Assert.Equal(new[] { "a.example.com" }, d.Hosts);
        Assert.Contains("a.example.com", d.Describe()[0]);
    }

    // ---------- Community.PrepareAsync: the gate in front of the install ----------

    static JsonObject Entry(string id) => new() { ["id"] = id, ["files"] = new JsonArray("widget.json", "index.html") };

    static Func<string, Task<byte[]>> Catalog(string id, string widgetJson) => rel => Task.FromResult(
        Encoding.UTF8.GetBytes(rel == $"{id}/widget.json" ? widgetJson : "<html></html>"));

    static string Json(string id, string version, string permissions, string? changelog = null) =>
        $$"""{ "id": "{{id}}", "name": "Gate", "version": "{{version}}", {{(changelog is null ? "" : $"\"changelog\": \"{changelog}\",")}} "permissions": {{permissions}} }""";

    static string Installed(string id) => File.ReadAllText(Path.Combine(AppPaths.CommunityDir, id, "widget.json"));

    [Fact]
    public async Task A_fresh_install_needs_no_extra_approval()
    {
        var id = $"gate-{Guid.NewGuid():N}"[..12];
        using var p = await Community.PrepareAsync(Entry(id), Catalog(id, Json(id, "1.0.0", """{ "hosts": ["a.example.com"] }""")));
        Assert.False(p.NeedsApproval);
        p.Require(false);
        p.Commit();
        Assert.Contains("1.0.0", Installed(id));
        Community.Remove(id);
    }

    [Fact]
    public async Task An_update_that_adds_access_is_refused_until_accepted_and_changes_nothing()
    {
        var id = $"gate-{Guid.NewGuid():N}"[..12];
        using (var first = await Community.PrepareAsync(Entry(id), Catalog(id, Json(id, "1.0.0", """{ "hosts": ["a.example.com"] }"""))))
            first.Commit();

        var v2 = Json(id, "1.1.0", """{ "hosts": ["a.example.com", "b.example.com"], "notifications": true }""", "Adds alerts");
        using (var p = await Community.PrepareAsync(Entry(id), Catalog(id, v2)))
        {
            Assert.True(p.NeedsApproval);
            Assert.Equal("Adds alerts", p.Manifest.Changelog);
            var ex = Assert.Throws<PermissionsChangedException>(() => p.Require(false));
            Assert.Contains("b.example.com", ex.Message);
            Assert.Contains("1.0.0", Installed(id));                // refusing left the old version in place
        }

        using (var p = await Community.PrepareAsync(Entry(id), Catalog(id, v2)))
        {
            p.Require(true);
            p.Commit();
        }
        Assert.Contains("1.1.0", Installed(id));
        Community.Remove(id);
    }

    [Fact]
    public async Task Update_all_skips_an_update_that_adds_access_and_applies_one_that_does_not()
    {
        var id = $"gate-{Guid.NewGuid():N}"[..12];
        using (var first = await Community.PrepareAsync(Entry(id), Catalog(id, Json(id, "1.0.0", """{ "hosts": ["a.example.com"] }"""))))
            first.Commit();

        var closed = new List<string>();
        var wider = Json(id, "1.1.0", """{ "hosts": ["a.example.com", "evil.example.com"] }""");
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Community.UpdateWithoutNewAccessAsync(Entry(id), closed.Add, Catalog(id, wider)));
        Assert.Contains("Skipped", ex.Message);
        Assert.Contains("evil.example.com", ex.Message);
        Assert.Empty(closed);                                    // the running widget was not touched
        Assert.Contains("1.0.0", Installed(id));

        await Community.UpdateWithoutNewAccessAsync(Entry(id), closed.Add, Catalog(id, Json(id, "1.1.0", """{ "hosts": [] }""")));
        Assert.Equal(new[] { id }, closed);
        Assert.Contains("1.1.0", Installed(id));
        Community.Remove(id);
    }

    [Fact]
    public async Task An_update_that_adds_nothing_applies_directly()
    {
        var id = $"gate-{Guid.NewGuid():N}"[..12];
        using (var first = await Community.PrepareAsync(Entry(id), Catalog(id, Json(id, "1.0.0", """{ "hosts": ["a.example.com", "b.example.com"] }"""))))
            first.Commit();
        using var p = await Community.PrepareAsync(Entry(id), Catalog(id, Json(id, "1.1.0", """{ "hosts": ["a.example.com"] }""")));
        Assert.False(p.NeedsApproval);
        p.Require(false);
        p.Commit();
        Assert.Contains("1.1.0", Installed(id));
        Community.Remove(id);
    }

    [Fact]
    public async Task InstallAsync_defaults_to_not_accepting()
    {
        // InstallAsync downloads from the catalog base; a file:// folder stands in for GitHub.
        var id = $"gate-{Guid.NewGuid():N}"[..12];
        var root = Path.Combine(Path.GetTempPath(), $"umbra-cat-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, id));
        try
        {
            File.WriteAllText(Path.Combine(root, id, "index.html"), "<html></html>");
            void Publish(string version, string permissions) => File.WriteAllText(Path.Combine(root, id, "widget.json"), Json(id, version, permissions));
            var old = Environment.GetEnvironmentVariable("UMBRA_CATALOG_BASE");
            Environment.SetEnvironmentVariable("UMBRA_CATALOG_BASE", new Uri(root).AbsoluteUri);
            try
            {
                Publish("1.0.0", "{}");
                await Community.InstallAsync(Entry(id));
                Publish("1.1.0", """{ "hosts": ["new.example.com"] }""");
                await Assert.ThrowsAsync<PermissionsChangedException>(() => Community.InstallAsync(Entry(id)));
                Assert.Contains("1.0.0", Installed(id));
                await Community.InstallAsync(Entry(id), acceptPermissions: true);
                Assert.Contains("1.1.0", Installed(id));
            }
            finally { Environment.SetEnvironmentVariable("UMBRA_CATALOG_BASE", old); }
        }
        finally
        {
            Community.Remove(id);
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
