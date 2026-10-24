using System.IO.Compression;
using System.Text;

namespace Umbra.Tests;

/// <summary>"Install from file" (Settings > Browse, umbractl install-local): folder and zip installs, zip-slip and the catalog rules.</summary>
public class LocalInstallTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), $"umbra-local-tests-{Guid.NewGuid():N}");

    public LocalInstallTests() { TestEnv.Init(); Directory.CreateDirectory(_dir); }

    public void Dispose() { try { Directory.Delete(_dir, recursive: true); } catch { } }

    static string Manifest(string id, string permissions = "{}") =>
        $$"""{ "id": "{{id}}", "name": "Local {{id}}", "version": "1.0.0", "permissions": {{permissions}} }""";

    string Zip(params (string Name, string Content)[] entries) => ZipWith(entries.Select(e => (e.Name, Encoding.UTF8.GetBytes(e.Content), 0)).ToArray());

    string ZipWith((string Name, byte[] Data, int UnixMode)[] entries, string ext = ".zip")
    {
        var path = Path.Combine(_dir, Guid.NewGuid().ToString("N") + ext);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
            foreach (var (name, data, mode) in entries)
            {
                var e = zip.CreateEntry(name);
                if (mode != 0) e.ExternalAttributes = mode << 16;
                using var s = e.Open();
                s.Write(data);
            }
        return path;
    }

    static string Installed(string id) => Path.Combine(AppPaths.CommunityDir, id);

    static void AssertRejected(string path, string id, string because)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(path));
        Assert.Contains(because, ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(Directory.Exists(Installed(id)), "nothing may be written to the widgets folder");
    }

    [Fact]
    public void A_zip_with_widget_json_at_the_top_installs()
    {
        var id = "local-flat";
        var zip = Zip(("widget.json", Manifest(id)), ("index.html", "<html></html>"), ("img/a.svg", "<svg/>"));
        using (var p = Community.PrepareLocal(zip))
        {
            Assert.Equal(id, p.Manifest.Id);
            Assert.False(p.NeedsApproval);
            Assert.False(Directory.Exists(Installed(id)), "PrepareLocal must not write the widget");
            p.Commit();
        }
        Assert.True(File.Exists(Path.Combine(Installed(id), "img", "a.svg")));
        Community.Remove(id);
    }

    [Fact]
    public void A_zip_of_the_folder_strips_the_top_folder_and_checks_its_name()
    {
        var id = "local-nested";
        var zip = Zip(($"{id}/widget.json", Manifest(id)), ($"{id}/index.html", "<html></html>"));
        using (var p = Community.PrepareLocal(zip)) p.Commit();
        Assert.True(File.Exists(Path.Combine(Installed(id), "widget.json")));
        Community.Remove(id);

        AssertRejected(Zip(("other-name/widget.json", Manifest("local-x")), ("other-name/index.html", "")), "local-x", "must match");
    }

    [Fact]
    public void A_umbrawidget_file_is_a_zip()
    {
        var id = "local-ext";
        var path = ZipWith(new[] { ("widget.json", Encoding.UTF8.GetBytes(Manifest(id)), 0), ("index.html", Encoding.UTF8.GetBytes("<html></html>"), 0) }, ".umbrawidget");
        using var p = Community.PrepareLocal(path);
        Assert.Equal(id, p.Manifest.Id);
    }

    [Fact]
    public void A_folder_installs_and_its_name_must_equal_the_id()
    {
        var id = "local-folder";
        var folder = Path.Combine(_dir, id);
        Directory.CreateDirectory(Path.Combine(folder, "lib"));
        File.WriteAllText(Path.Combine(folder, "widget.json"), Manifest(id));
        File.WriteAllText(Path.Combine(folder, "index.html"), "<html></html>");
        File.WriteAllText(Path.Combine(folder, "lib", "x.js"), "1");
        using (var p = Community.PrepareLocal(folder)) p.Commit();
        Assert.True(File.Exists(Path.Combine(Installed(id), "lib", "x.js")));
        Community.Remove(id);

        var wrong = Path.Combine(_dir, "wrong-name");
        Directory.CreateDirectory(wrong);
        File.WriteAllText(Path.Combine(wrong, "widget.json"), Manifest("local-y"));
        File.WriteAllText(Path.Combine(wrong, "index.html"), "");
        AssertRejected(wrong, "local-y", "must match");
    }

    [Theory]
    [InlineData("../evil.js")]
    [InlineData("img/../../evil.js")]
    [InlineData(@"..\evil.js")]
    [InlineData("/abs.js")]
    [InlineData(@"\abs.js")]
    [InlineData("C:/Windows/evil.js")]
    [InlineData("C:evil.js")]
    [InlineData("//server/share/evil.js")]
    [InlineData("./index2.html")]
    public void Zip_slip_entries_are_refused_and_nothing_is_written(string name)
    {
        var id = "local-slip";
        var zip = Zip(("widget.json", Manifest(id)), ("index.html", "<html></html>"), (name, "alert(1)"));
        AssertRejected(zip, id, "unsafe");
        Assert.False(File.Exists(Path.Combine(Path.GetTempPath(), "evil.js")));
    }

    [Fact]
    public void A_symlink_entry_is_refused()
    {
        var id = "local-link";
        const int symlink = 0xA000 | 0x1FF;
        var zip = ZipWith(new[] { ("widget.json", Encoding.UTF8.GetBytes(Manifest(id)), 0), ("index.html", Encoding.UTF8.GetBytes(""), 0), ("link.js", Encoding.UTF8.GetBytes("C:/Windows/win.ini"), symlink) });
        AssertRejected(zip, id, "links are not allowed");
    }

    [Fact]
    public void A_disallowed_file_type_is_refused()
    {
        var id = "local-exe";
        AssertRejected(Zip(("widget.json", Manifest(id)), ("index.html", ""), ("run.exe", "MZ")), id, "disallowed");
        AssertRejected(Zip(("widget.json", Manifest(id)), ("index.html", ""), ("run.bat", "del")), id, "disallowed");
    }

    [Fact]
    public void A_widget_over_5_MB_is_refused()
    {
        var id = "local-big";
        var big = new byte[3 * 1024 * 1024];
        var zip = ZipWith(new[] { ("widget.json", Encoding.UTF8.GetBytes(Manifest(id)), 0), ("index.html", Encoding.UTF8.GetBytes(""), 0), ("a.png", big, 0), ("b.png", big, 0) });
        AssertRejected(zip, id, "5 MB");
    }

    [Fact]
    public void A_missing_or_invalid_manifest_or_entry_is_refused()
    {
        AssertRejected(Zip(("index.html", "")), "x", "widget.json");
        AssertRejected(Zip(("widget.json", Manifest("local-noentry"))), "local-noentry", "entry file");
        AssertRejected(Zip(("widget.json", "{ not json"), ("index.html", "")), "x", "invalid");
        AssertRejected(Zip(("widget.json", Manifest("Bad_Id")), ("index.html", "")), "Bad_Id", "id");
    }

    [Fact]
    public void Duplicate_entries_are_refused()
    {
        var id = "local-dup";
        AssertRejected(Zip(("widget.json", Manifest(id)), ("index.html", "a"), ("index.html", "b")), id, "twice");
    }

    [Fact]
    public void Something_that_is_not_a_zip_or_folder_is_refused()
    {
        var txt = Path.Combine(_dir, "notes.txt");
        File.WriteAllText(txt, "hi");
        Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(txt));
        Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(Path.Combine(_dir, "missing.zip")));
    }

    [Theory]
    [InlineData("local-pfx")]
    [InlineData("local-pfx/")]
    public void A_file_named_like_the_top_folder_is_refused(string odd)
    {
        var id = "local-pfx";
        var zip = ZipWith(new[]
        {
            ($"{id}/widget.json", Encoding.UTF8.GetBytes(Manifest(id)), 0),
            ($"{id}/index.html", Encoding.UTF8.GetBytes(""), 0),
            (odd, Encoding.UTF8.GetBytes("x"), 0), // has data, so it is not a plain folder entry
        });
        AssertRejected(zip, id, "unsafe");
    }

    [Fact]
    public void A_single_entry_that_expands_past_5_MB_is_refused()
    {
        var id = "local-bomb";
        var zip = ZipWith(new[] { ("widget.json", Encoding.UTF8.GetBytes(Manifest(id)), 0), ("index.html", Encoding.UTF8.GetBytes(""), 0), ("big.png", new byte[6 * 1024 * 1024], 0) });
        Assert.True(new FileInfo(zip).Length < 100_000, "the zip itself is small");
        AssertRejected(zip, id, "5 MB");
    }

    [Fact]
    public void A_corrupt_zip_is_refused_cleanly()
    {
        var path = Path.Combine(_dir, "broken.zip");
        File.WriteAllText(path, "not a zip");
        var ex = Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(path));
        Assert.Contains("Could not read", ex.Message);
    }

    [Fact]
    public void A_folder_containing_a_junction_is_refused()
    {
        var id = "local-junction";
        var folder = Path.Combine(_dir, id);
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "widget.json"), Manifest(id));
        File.WriteAllText(Path.Combine(folder, "index.html"), "");
        var outside = Path.Combine(_dir, "outside");
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "secret.txt"), "s");
        // A junction needs no admin rights or developer mode, unlike a symlink.
        using (var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe", $"/c mklink /J \"{Path.Combine(folder, "lib")}\" \"{outside}\"") { CreateNoWindow = true, UseShellExecute = false })!)
            p.WaitForExit();
        Assert.True(Directory.Exists(Path.Combine(folder, "lib")), "junction was created");
        AssertRejected(folder, id, "links are not allowed");
    }

    [Fact]
    public void A_local_install_is_recorded_and_never_offered_a_catalog_update()
    {
        var id = "local-src";
        using (var p = Community.PrepareLocal(Zip(("widget.json", Manifest(id)), ("index.html", "")))) p.Commit();
        Assert.True(Community.IsLocalInstall(id));
        var installed = WidgetManifest.Parse(File.ReadAllText(Path.Combine(Installed(id), "widget.json")));
        installed.Source = WidgetSource.Community;
        var newer = new System.Text.Json.Nodes.JsonObject { ["id"] = id, ["version"] = "9.0.0" };
        Assert.False(Community.IsUpdate(newer, installed));
        Assert.Empty(Community.Outdated(new[] { newer }, new[] { installed }));
        Community.Remove(id);
    }

    [Fact]
    public async Task An_explicit_catalog_install_switches_a_local_copy_back_to_catalog_updates()
    {
        var id = "local-back";
        using (var p = Community.PrepareLocal(Zip(("widget.json", Manifest(id)), ("index.html", "")))) p.Commit();
        var entry = new System.Text.Json.Nodes.JsonObject { ["id"] = id, ["files"] = new System.Text.Json.Nodes.JsonArray("widget.json", "index.html") };
        Func<string, Task<byte[]>> catalog = rel => Task.FromResult(Encoding.UTF8.GetBytes(rel.EndsWith("widget.json") ? Manifest(id) : "catalog"));
        using (var p = await Community.PrepareAsync(entry, catalog)) p.Commit();
        Assert.False(Community.IsLocalInstall(id));
        Community.Remove(id);
    }

    // ---------- "private": true (#229) ----------

    [Fact]
    public void The_private_flag_is_parsed_and_defaults_to_false()
    {
        Assert.True(WidgetManifest.Parse("""{ "id": "p1", "name": "P", "private": true }""").Private);
        Assert.False(WidgetManifest.Parse("""{ "id": "p1", "name": "P" }""").Private);
    }

    [Fact]
    public void A_private_widget_is_never_offered_a_catalog_update()
    {
        var entry = new System.Text.Json.Nodes.JsonObject { ["id"] = "p1", ["version"] = "9.0.0" };
        var priv = WidgetManifest.Parse("""{ "id": "p1", "name": "P", "version": "1.0.0", "private": true }""");
        priv.Source = WidgetSource.Community;
        var pub = WidgetManifest.Parse("""{ "id": "p1", "name": "P", "version": "1.0.0" }""");
        pub.Source = WidgetSource.Community;
        Assert.False(Community.IsUpdate(entry, priv));
        Assert.True(Community.IsUpdate(entry, pub));
        Assert.Empty(Community.Outdated(new[] { entry }, new[] { priv }));
    }

    [Fact]
    public async Task A_catalog_widget_cannot_replace_a_private_one()
    {
        var id = "local-private";
        var zip = Zip(("widget.json", """{ "id": "local-private", "name": "Mine", "version": "1.0.0", "private": true }"""), ("index.html", "mine"));
        using (var p = Community.PrepareLocal(zip)) p.Commit();

        var entry = new System.Text.Json.Nodes.JsonObject { ["id"] = id, ["files"] = new System.Text.Json.Nodes.JsonArray("widget.json", "index.html") };
        Func<string, Task<byte[]>> catalog = rel => Task.FromResult(Encoding.UTF8.GetBytes(rel.EndsWith("widget.json") ? """{ "id": "local-private", "name": "Theirs", "version": "2.0.0" }""" : "theirs"));
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareAsync(entry, catalog));
        Assert.Contains("private", ex.Message);
        Assert.Equal("mine", File.ReadAllText(Path.Combine(Installed(id), "index.html")));
        Community.Remove(id);
    }

    [Fact]
    public void The_private_buddy_widget_in_the_repo_installs_from_its_folder()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !Directory.Exists(Path.Combine(dir, "private-widgets"))) dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);
        using var p = Community.PrepareLocal(Path.Combine(dir!, "private-widgets", "buddy"));
        Assert.Equal("buddy", p.Manifest.Id);
        Assert.True(p.Manifest.Private);
        Assert.True(p.NeedsApproval, "its relay host needs the user's accept");
    }

    [Fact]
    public void Declared_access_needs_an_accept_even_on_a_fresh_install()
    {
        var id = "local-access";
        var zip = Zip(("widget.json", Manifest(id, """{ "hosts": ["api.example.com"], "notifications": true }""")), ("index.html", ""));
        using var p = Community.PrepareLocal(zip);
        Assert.True(p.NeedsApproval);
        var ex = Assert.Throws<PermissionsChangedException>(() => p.Require(accepted: false));
        Assert.Contains("api.example.com", ex.Message);
        p.Require(accepted: true);
        Assert.False(Directory.Exists(Installed(id)), "declining (or not committing) leaves no files");
    }
}
