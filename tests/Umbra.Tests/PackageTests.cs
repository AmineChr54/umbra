using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>The .umbrawidget package (Community.WritePackage / PrepareLocal) and the manifest contract (manifestVersion, minUmbraVersion).</summary>
public class PackageTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), $"umbra-pkg-tests-{Guid.NewGuid():N}");

    public PackageTests() { TestEnv.Init(); Directory.CreateDirectory(_dir); }

    public void Dispose() { try { Directory.Delete(_dir, recursive: true); } catch { } }

    static string Manifest(string id, string extra = "") =>
        $$"""{ "id": "{{id}}", "name": "Pkg {{id}}", "version": "1.0.0"{{extra}} }""";

    string Folder(string id, string manifest, params (string Name, string Content)[] files)
    {
        var dir = Path.Combine(_dir, Guid.NewGuid().ToString("N"), id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "widget.json"), manifest);
        File.WriteAllText(Path.Combine(dir, "index.html"), "<!doctype html><p>hi</p>");
        foreach (var (name, content) in files)
        {
            var p = Path.Combine(dir, name.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(p)!);
            File.WriteAllText(p, content);
        }
        return dir;
    }

    static string Installed(string id) => Path.Combine(AppPaths.CommunityDir, id);

    [Fact]
    public void Missing_manifestVersion_means_1_and_is_compatible()
    {
        var m = WidgetManifest.Parse(Manifest("mv-missing"));
        Assert.Equal(1, m.ManifestVersion);
        Assert.Null(m.MinUmbraVersion);
        Assert.Null(m.Incompatibility());
    }

    [Theory]
    [InlineData(""", "manifestVersion": 0""")]
    [InlineData(", \"minUmbraVersion\": \"2.0\"")]
    [InlineData(", \"minUmbraVersion\": \"v2.0.0\"")]
    public void Bad_contract_fields_are_rejected(string extra) =>
        Assert.Throws<JsonException>(() => WidgetManifest.Parse(Manifest("mv-bad", extra)));

    [Fact]
    public void Newer_manifestVersion_or_minUmbraVersion_asks_to_update_Umbra()
    {
        var newer = WidgetManifest.Incompatibility(WidgetManifest.SupportedManifestVersion + 1, null, "1.8.0");
        Assert.Contains("Update Umbra", newer);
        var min = WidgetManifest.Incompatibility(1, "1.9.0", "1.8.0");
        Assert.Contains("1.9.0", min);
        Assert.Contains("Update Umbra", min);
        Assert.Null(WidgetManifest.Incompatibility(1, "1.8.0", "1.8.0"));
        Assert.Null(WidgetManifest.Incompatibility(1, "1.7.9", "1.8.0"));
    }

    [Fact]
    public void Install_of_a_widget_for_a_newer_Umbra_is_refused_and_writes_nothing()
    {
        foreach (var (id, extra) in new[] { ("mv-two", """, "manifestVersion": 2"""), ("mv-min", """, "minUmbraVersion": "999.0.0" """) })
        {
            var ex = Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(Folder(id, Manifest(id, extra))));
            Assert.Contains("Update Umbra", ex.Message);
            Assert.False(Directory.Exists(Installed(id)));
        }
    }

    [Fact]
    public void Discover_skips_a_widget_for_a_newer_Umbra()
    {
        var root = Path.Combine(_dir, "discover");
        foreach (var (id, extra) in new[] { ("mv-ok", ""), ("mv-future", """, "manifestVersion": 9""") })
        {
            Directory.CreateDirectory(Path.Combine(root, id));
            File.WriteAllText(Path.Combine(root, id, "widget.json"), Manifest(id, extra));
        }
        var found = WidgetManifest.Discover(root, WidgetSource.Community).Select(m => m.Id).ToList();
        Assert.Equal(new[] { "mv-ok" }, found);
    }

    [Fact]
    public void Catalog_entries_for_a_newer_Umbra_are_flagged_and_never_offered_as_updates()
    {
        Assert.Null(Community.CatalogIncompatibility(JsonNode.Parse("""{ "id": "x", "version": "2.0.0" }""")));
        var future = JsonNode.Parse("""{ "id": "x", "version": "2.0.0", "minUmbraVersion": "999.0.0" }""");
        Assert.Contains("Update Umbra", Community.CatalogIncompatibility(future));
        var installed = new WidgetManifest { Id = "x", Version = "1.0.0", Source = WidgetSource.Community };
        Assert.False(Community.IsUpdate(future, installed));
        Assert.True(Community.IsUpdate(JsonNode.Parse("""{ "id": "x", "version": "2.0.0", "manifestVersion": 1 }"""), installed));
    }

    [Fact]
    public void Every_catalog_widget_declares_a_supported_manifestVersion()
    {
        var root = AppContext.BaseDirectory;
        while (root is not null && !File.Exists(Path.Combine(root, "Umbra.slnx"))) root = Path.GetDirectoryName(root);
        Assert.NotNull(root);
        foreach (var file in Directory.GetFiles(Path.Combine(root!, "widgets"), "widget.json", SearchOption.AllDirectories))
        {
            var m = WidgetManifest.Parse(File.ReadAllText(file));
            Assert.Equal(1, m.ManifestVersion);
            Assert.True(JsonNode.Parse(File.ReadAllText(file))!["manifestVersion"] is not null, $"{file} has no manifestVersion");
            Assert.Null(m.Incompatibility());
        }
    }

    [Fact]
    public void Pack_is_deterministic_and_round_trips_through_install()
    {
        var id = "pkg-round";
        var folder = Folder(id, Manifest(id), ("b/z.css", "z{}"), ("a.js", "1"), ("img/p.svg", "<svg/>"));
        var first = Path.Combine(_dir, "first" + Community.PackageExtension);
        var again = Path.Combine(_dir, "again" + Community.PackageExtension);
        Community.WritePackage(folder, first);
        Thread.Sleep(20);
        Community.WritePackage(folder, again);
        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(again));

        using (var zip = ZipFile.OpenRead(first))
        {
            var names = zip.Entries.Select(e => e.FullName).ToList();
            Assert.Equal(names.Order(StringComparer.Ordinal), names);
            Assert.Contains("widget.json", names); // at the root, no wrapper folder
        }

        using (var p = Community.PrepareLocal(first)) { p.Require(accepted: false); p.Commit(); }
        var repacked = Path.Combine(_dir, "repacked" + Community.PackageExtension);
        Community.WritePackage(Installed(id), repacked);
        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(repacked));
        Community.Remove(id);
    }

    [Fact]
    public void Pack_refuses_a_bad_folder_and_writes_no_file()
    {
        var id = "pkg-bad";
        var folder = Folder(id, Manifest(id), ("run.exe", "MZ"));
        var outPath = Path.Combine(_dir, "bad" + Community.PackageExtension);
        Assert.Throws<InvalidOperationException>(() => Community.WritePackage(folder, outPath));
        Assert.Empty(Directory.GetFiles(_dir, "bad*"));

        var wrongId = Folder("pkg-other", Manifest("pkg-mismatch"));
        Assert.Throws<InvalidOperationException>(() => Community.WritePackage(wrongId, outPath));
        Assert.False(File.Exists(outPath));
    }

    [Fact]
    public void A_umbrawidget_package_must_have_widget_json_at_the_root()
    {
        var id = "pkg-wrapped";
        var path = Path.Combine(_dir, "wrapped" + Community.PackageExtension);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
            foreach (var (name, content) in new[] { ($"{id}/widget.json", Manifest(id)), ($"{id}/index.html", "") })
            {
                using var s = zip.CreateEntry(name).Open();
                s.Write(Encoding.UTF8.GetBytes(content));
            }
        var ex = Assert.Throws<InvalidOperationException>(() => Community.PrepareLocal(path));
        Assert.Contains("wrapper", ex.Message);
        Assert.False(Directory.Exists(Installed(id)));

        // The same layout as a plain .zip is still accepted (Send to > Compressed folder).
        var asZip = Path.ChangeExtension(path, ".zip");
        File.Copy(path, asZip);
        using var ok = Community.PrepareLocal(asZip);
        Assert.Equal(id, ok.Manifest.Id);
    }
}
