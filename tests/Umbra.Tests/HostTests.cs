using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>Points AppPaths at a throwaway folder so tests never touch the real %APPDATA%\Umbra.</summary>
static class TestEnv
{
    public static readonly string DataDir = Path.Combine(Path.GetTempPath(), $"umbra-tests-{Guid.NewGuid():N}");
    static TestEnv() => Environment.SetEnvironmentVariable("UMBRA_DATA_DIR", DataDir);
    public static void Init() { _ = DataDir; }
}

public class WidgetManifestTests
{
    public WidgetManifestTests() => TestEnv.Init();

    const string Sample = """
        { "id": "demo", "name": "Demo", "description": "d", "author": "a", "version": "1.2.3",
          "permissions": { "hosts": ["api.example.com"] },
          "options": { "zeta": { "label": "Z", "type": "text", "default": "z" },
                       "alpha": { "label": "A", "type": "toggle", "default": true } } }
        """;

    [Fact]
    public void Parse_keeps_option_order_and_defaults()
    {
        var m = WidgetManifest.Parse(Sample);
        Assert.Equal("demo", m.Id);
        Assert.Equal("index.html", m.Entry);
        Assert.Equal(new[] { "zeta", "alpha" }, m.OptionOrder);
        Assert.Equal("z", m.DefaultOptions()["zeta"]!.GetValue<string>());
        Assert.True(m.DefaultOptions()["alpha"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("https://api.example.com/v1?q=1", true)]
    [InlineData("https://API.EXAMPLE.COM/x", true)]
    [InlineData("http://api.example.com/v1", false)]
    [InlineData("https://evil.com/?api.example.com", false)]
    [InlineData("https://api.example.com.evil.com/", false)]
    [InlineData("not a url", false)]
    public void AllowsUrl_requires_https_and_a_declared_host(string url, bool allowed) =>
        Assert.Equal(allowed, WidgetManifest.Parse(Sample).AllowsUrl(url));

    [Fact]
    public void Discover_skips_invalid_ids_and_broken_json()
    {
        var root = Path.Combine(TestEnv.DataDir, "discover-" + Guid.NewGuid().ToString("N"));
        void Write(string folder, string json) { Directory.CreateDirectory(Path.Combine(root, folder)); File.WriteAllText(Path.Combine(root, folder, "widget.json"), json); }
        Write("good", """{ "id": "good", "name": "Good" }""");
        Write("bad-id", """{ "id": "Bad Id!", "name": "Bad" }""");
        Write("broken", "{ not json");
        Directory.CreateDirectory(Path.Combine(root, "no-manifest"));

        var found = WidgetManifest.Discover(root, WidgetSource.Community);
        Assert.Equal(new[] { "good" }, found.Select(m => m.Id));
        Assert.Equal(WidgetSource.Community, found[0].Source);
    }

    [Fact]
    public void Catalog_manifests_in_the_repo_parse()
    {
        var widgets = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "widgets"));
        var found = WidgetManifest.Discover(widgets, WidgetSource.Community);
        Assert.Contains(found, m => m.Id == "sp500");
        Assert.All(found, m => Assert.Equal(m.Id, m.Folder));
    }

    [Fact]
    public void Discovery_with_an_empty_or_missing_widget_folder_finds_nothing()
    {
        var empty = Path.Combine(Path.GetTempPath(), $"umbra-empty-{Guid.NewGuid():N}");
        Directory.CreateDirectory(empty);
        try
        {
            Assert.Empty(WidgetManifest.Discover(empty, WidgetSource.BuiltIn));
            Assert.Empty(WidgetManifest.Discover(Path.Combine(empty, "missing"), WidgetSource.BuiltIn));
        }
        finally { Directory.Delete(empty, recursive: true); }
    }
}

public class RestoreTests
{
    public RestoreTests() => TestEnv.Init();

    static Settings With(params (string Id, bool Enabled)[] entries)
    {
        var s = new Settings();
        foreach (var (id, enabled) in entries) s.Widgets[id] = new WidgetSettings { Enabled = enabled };
        return s;
    }

    static WidgetManifest Manifest(string id) => WidgetManifest.Parse($$"""{ "id": "{{id}}", "name": "{{id}}" }""");
    static readonly WidgetManifest[] None = Array.Empty<WidgetManifest>();
    static JsonArray Catalog(params string[] ids) => new(ids.Select(i => (JsonNode)new JsonObject { ["id"] = i }).ToArray());

    [Fact]
    public void Enabled_legacy_widget_without_a_manifest_is_restored()
    {
        Assert.Equal(new[] { "sp500" }, Restore.ToRestore(With(("sp500", true)), None));
    }

    [Fact]
    public void Only_the_legacy_list_is_restored_never_other_ids_extras_or_disabled()
    {
        Assert.Empty(Restore.ToRestore(With(("clock", true), ("sp500#2", true), ("mine", true)), None));
        Assert.Empty(Restore.ToRestore(With(("sp500", false)), None));
        Assert.Empty(Restore.ToRestore(With(("sp500", true)), new[] { Manifest("sp500") }));
    }

    [Fact]
    public void A_removed_widget_has_no_settings_entry_so_it_is_not_restored_after_restart()
    {
        var s = With(("sp500", true), ("sp500#2", true));
        s.RemoveExtraInstances("sp500"); // what App.ForgetInstances does on remove
        Assert.Empty(s.Widgets);
        Assert.Empty(Restore.ToRestore(s, None));
    }

    [Fact]
    public void Nothing_is_restored_once_the_marker_is_set()
    {
        var s = With(("sp500", true));
        s.General.LegacyRestoreDone = true;
        Assert.Empty(Restore.ToRestore(s, None));
    }

    [Fact]
    public async Task Successful_attempt_installs_and_is_done()
    {
        var s = With(("sp500", true));
        var installed = new List<string>();
        var r = await Restore.RunAsync(() => Task.FromResult(Restore.ToRestore(s, installed.Count > 0 ? new[] { Manifest("sp500") } : None)),
            () => Task.FromResult(Catalog("sp500")), e => { installed.Add(e["id"]!.GetValue<string>()); return Task.CompletedTask; }, _ => { });
        Assert.True(r.Done);
        Assert.Equal(new[] { "sp500" }, r.Installed);
    }

    [Fact]
    public async Task Offline_attempt_leaves_the_marker_unset()
    {
        var s = With(("sp500", true));
        var r = await Restore.RunAsync(() => Task.FromResult(Restore.ToRestore(s, None)),
            () => throw new HttpRequestException("offline"), _ => Task.CompletedTask, _ => { });
        Assert.False(r.Done);
        Assert.Empty(r.Installed);
    }

    [Fact]
    public async Task Failed_install_or_missing_catalog_entry_is_not_done()
    {
        var s = With(("sp500", true));
        var failed = await Restore.RunAsync(() => Task.FromResult(Restore.ToRestore(s, None)),
            () => Task.FromResult(Catalog("sp500", "sp500")), _ => throw new InvalidOperationException("bad"), _ => { });
        Assert.False(failed.Done);
        var missing = await Restore.RunAsync(() => Task.FromResult(Restore.ToRestore(s, None)),
            () => Task.FromResult(Catalog("clock")), _ => Task.CompletedTask, _ => { });
        Assert.False(missing.Done);
    }

    [Fact]
    public async Task Nothing_pending_is_done_without_touching_the_network()
    {
        var r = await Restore.RunAsync(() => Task.FromResult(new List<string>()),
            () => throw new InvalidOperationException("must not fetch"), _ => Task.CompletedTask, _ => { });
        Assert.True(r.Done);
    }

    [Fact]
    public async Task Widget_removed_while_the_catalog_loads_is_not_installed()
    {
        var s = With(("sp500", true));
        var calls = 0;
        var r = await Restore.RunAsync(() => Task.FromResult(calls++ == 0 ? Restore.ToRestore(s, None) : new List<string>()),
            () => Task.FromResult(Catalog("sp500")), _ => throw new InvalidOperationException("must not install"), _ => { });
        Assert.True(r.Done);
        Assert.Empty(r.Installed);
    }

    [Fact]
    public void Orphan_cleanup_spares_widgets_pending_a_restore()
    {
        var ids = new[] { "sp500", "sp500#2", "gone", "clock#2" };
        var orphans = Restore.Orphans(ids, new[] { "clock" }, new HashSet<string> { "sp500" });
        Assert.Equal(new[] { "gone" }, orphans);
        Assert.Equal(new[] { "sp500", "sp500#2", "gone" }, Restore.Orphans(ids, new[] { "clock" }, new HashSet<string>()));
    }
}

public class CommunityTests
{
    public CommunityTests() => TestEnv.Init();

    [Theory]
    [InlineData("index.html", true)]
    [InlineData("img/logo.svg", true)]
    [InlineData("../evil.js", false)]
    [InlineData("a/../../evil.js", false)]
    [InlineData("/abs.js", false)]
    [InlineData("C:/x.js", false)]
    [InlineData("dir\\file.js", false)]
    [InlineData("run.exe", false)]
    [InlineData("script.ps1", false)]
    [InlineData("", false)]
    public void IsSafeRelativePath(string path, bool safe) => Assert.Equal(safe, Community.IsSafeRelativePath(path));

    [Theory]
    [InlineData("1.10.0", "1.2.0", 1)]
    [InlineData("1.0.0", "1.0.0", 0)]
    [InlineData("0.9", "1.0.0", -1)]
    [InlineData("2.0.0-beta", "1.9.9", 1)]
    public void CompareVersions_is_numeric(string a, string b, int sign) =>
        Assert.Equal(sign, Math.Sign(Community.CompareVersions(a, b)));

    static Dictionary<string, string> Files(string id) => new()
    {
        ["widget.json"] = $$"""{ "id": "{{id}}", "name": "T", "description": "d", "author": "a", "version": "1.0.0" }""",
        ["index.html"] = "<p>hi</p>",
        ["img/dot.png"] = Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47 }),
    };

    [Fact]
    public void WriteLocalWidget_writes_text_and_base64_files()
    {
        var dir = Community.WriteLocalWidget("local-one", Files("local-one"), overwrite: false);
        Assert.Equal("<p>hi</p>", File.ReadAllText(Path.Combine(dir, "index.html")));
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, File.ReadAllBytes(Path.Combine(dir, "img", "dot.png")));
        Assert.StartsWith(TestEnv.DataDir, dir);
    }

    [Fact]
    public void WriteLocalWidget_refuses_overwrite_unless_asked()
    {
        Community.WriteLocalWidget("local-two", Files("local-two"), overwrite: false);
        Assert.Throws<InvalidOperationException>(() => Community.WriteLocalWidget("local-two", Files("local-two"), overwrite: false));
        Community.WriteLocalWidget("local-two", Files("local-two"), overwrite: true);
    }

    [Fact]
    public void WriteLocalWidget_rejects_bad_input()
    {
        Assert.Throws<InvalidOperationException>(() => Community.WriteLocalWidget("Bad Id", Files("Bad Id"), false));
        Assert.Throws<InvalidOperationException>(() => Community.WriteLocalWidget("mismatch", Files("other"), false));

        var traversal = Files("trav");
        traversal["../outside.js"] = "x";
        Assert.Throws<InvalidOperationException>(() => Community.WriteLocalWidget("trav", traversal, false));
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, "trav")));

        var noEntry = Files("no-entry");
        noEntry.Remove("index.html");
        Assert.Throws<InvalidOperationException>(() => Community.WriteLocalWidget("no-entry", noEntry, false));
    }
}

public class WidgetStoreTests
{
    public WidgetStoreTests() => TestEnv.Init();

    static string NewId() => "store-" + Guid.NewGuid().ToString("N")[..8];

    [Fact]
    public void Set_get_remove_and_keys_round_trip_any_json()
    {
        var id = NewId();
        Assert.False(WidgetStore.Get(id, "tasks").Found);

        WidgetStore.Set(id, "tasks", new JsonArray(new JsonObject { ["title"] = "Read", ["done"] = false }));
        WidgetStore.Set(id, "count", 3);
        WidgetStore.Set(id, "nothing", null);

        var (found, value) = WidgetStore.Get(id, "tasks");
        Assert.True(found);
        Assert.Equal("Read", value![0]!["title"]!.GetValue<string>());
        Assert.True(WidgetStore.Get(id, "nothing").Found);
        Assert.Null(WidgetStore.Get(id, "nothing").Value);
        Assert.Equal(new[] { "tasks", "count", "nothing" }, WidgetStore.Keys(id));

        Assert.True(WidgetStore.Remove(id, "count"));
        Assert.False(WidgetStore.Remove(id, "count"));
        Assert.Equal(new[] { "tasks", "nothing" }, WidgetStore.Keys(id));
    }

    [Fact]
    public void Each_widget_has_its_own_file_under_the_data_dir()
    {
        string a = NewId(), b = NewId();
        WidgetStore.Set(a, "k", "from a");
        Assert.False(WidgetStore.Get(b, "k").Found);
        Assert.True(File.Exists(Path.Combine(TestEnv.DataDir, "data", $"{a}.json")));

        WidgetStore.Delete(a);
        Assert.False(WidgetStore.Get(a, "k").Found);
        Assert.False(File.Exists(Path.Combine(TestEnv.DataDir, "data", $"{a}.json")));
    }

    [Fact]
    public void Rejects_bad_ids_keys_and_oversized_data()
    {
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set("../evil", "k", 1));
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set("Bad Id", "k", 1));
        var id = NewId();
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set(id, "", 1));
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set(id, new string('k', WidgetStore.MaxKeyLength + 1), 1));

        WidgetStore.Set(id, "small", "kept");
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set(id, "big", new string('x', WidgetStore.MaxBytes)));
        Assert.Equal("kept", WidgetStore.Get(id, "small").Value!.GetValue<string>());
        Assert.False(WidgetStore.Get(id, "big").Found);
    }

    [Fact]
    public void Corrupt_file_is_set_aside_not_overwritten()
    {
        var id = NewId();
        var file = Path.Combine(TestEnv.DataDir, "data", $"{id}.json");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, "{ not json");

        Assert.Empty(WidgetStore.All(id));
        Assert.True(File.Exists(file + ".corrupt"));
    }

    [Fact]
    public void Removing_a_community_widget_deletes_its_data()
    {
        var id = NewId();
        Community.WriteLocalWidget(id, new Dictionary<string, string>
        {
            ["widget.json"] = $$"""{ "id": "{{id}}", "name": "T", "description": "d", "author": "a", "version": "1.0.0" }""",
            ["index.html"] = "<p>hi</p>",
        }, overwrite: false);
        WidgetStore.Set(id, "k", 1);

        Community.Remove(id);
        Assert.False(WidgetStore.Get(id, "k").Found);
    }
}

public class SettingsTests
{
    public SettingsTests() => TestEnv.Init();

    [Fact]
    public void For_fills_defaults_without_overwriting_and_clamps_refresh()
    {
        var m = WidgetManifest.Parse("""{ "id": "w1", "options": { "a": { "type": "text", "default": "x" }, "b": { "type": "toggle", "default": false } } }""");
        var s = new Settings { General = { RefreshSeconds = 5 } };
        s.Widgets["w1"] = new WidgetSettings { Options = new JsonObject { ["a"] = "kept" } };

        var ws = s.For(m);
        Assert.Equal("kept", ws.Options["a"]!.GetValue<string>());
        Assert.False(ws.Options["b"]!.GetValue<bool>());
        Assert.Equal(30, s.General.RefreshSeconds);
    }

    [Fact]
    public void Json_round_trip()
    {
        var s = new Settings();
        s.Widgets["w"] = new WidgetSettings { Enabled = false, X = 10, Y = -5, Locked = true, Options = new JsonObject { ["k"] = 3 } };
        var back = Settings.FromJson(s.ToJson());
        var w = back.Widgets["w"];
        Assert.False(w.Enabled);
        Assert.Equal((10, -5), (w.X, w.Y));
        Assert.True(w.Locked);
        Assert.Equal(3, w.Options["k"]!.GetValue<int>());
        Assert.Equal(1.0, w.Scale);
    }

    [Theory]
    [InlineData(1.0, 1.0)]
    [InlineData(1.5, 1.5)]
    [InlineData(0.5, 0.5)]
    [InlineData(3.0, 3.0)]
    [InlineData(0.1, 0.5)]
    [InlineData(-2, 0.5)]
    [InlineData(10, 3.0)]
    [InlineData(1.23456, 1.23)]
    [InlineData(double.NaN, 1.0)]
    [InlineData(double.PositiveInfinity, 1.0)]
    public void Scale_is_clamped_to_50_300_percent(double set, double expected)
    {
        Assert.Equal(expected, new WidgetSettings { Scale = set }.Scale);
        Assert.Equal(expected, WidgetSettings.ClampScale(set));
    }

    [Fact]
    public void Scale_round_trips_and_is_clamped_when_loaded()
    {
        var s = new Settings();
        s.Widgets["w"] = new WidgetSettings { Scale = 1.75 };
        var json = s.ToJson();
        Assert.Equal(1.75, json["widgets"]!["w"]!["scale"]!.GetValue<double>());
        Assert.Equal(1.75, Settings.FromJson(json).Widgets["w"].Scale);

        // Older settings.json files have no scale; hand-edited ones may be out of range.
        var old = Settings.FromJson(JsonNode.Parse("""{ "widgets": { "a": { "enabled": true }, "b": { "scale": 12 }, "c": { "scale": 0 } } }""")!);
        Assert.Equal(1.0, old.Widgets["a"].Scale);
        Assert.Equal(3.0, old.Widgets["b"].Scale);
        Assert.Equal(0.5, old.Widgets["c"].Scale);
    }

    [Fact]
    public void Scale_survives_save_and_load()
    {
        var s = new Settings();
        s.Widgets["persist"] = new WidgetSettings { Scale = 2.25, Locked = true };
        s.Save();
        var back = Settings.Load();
        Assert.Equal(2.25, back.Widgets["persist"].Scale);
        Assert.True(back.Widgets["persist"].Locked);
    }
}

public class ControlTests
{
    static readonly WidgetManifest M = WidgetManifest.Parse("""
        { "id": "w", "options": {
            "t": { "type": "text", "default": "" }, "n": { "type": "number", "default": 1 },
            "b": { "type": "toggle", "default": false },
            "s": { "type": "select", "default": "a", "choices": [ { "value": "a", "label": "A" }, { "value": "b", "label": "B" } ] } } }
        """);

    [Fact]
    public void CheckOption_accepts_matching_types()
    {
        Assert.Equal("hi", Control.CheckOption(M, "t", JsonValue.Create("hi"))!.GetValue<string>());
        Assert.Equal(2.5, Control.CheckOption(M, "n", JsonValue.Create(2.5))!.GetValue<double>());
        Assert.True(Control.CheckOption(M, "b", JsonValue.Create(true))!.GetValue<bool>());
        Assert.Equal("b", Control.CheckOption(M, "s", JsonValue.Create("b"))!.GetValue<string>());
    }

    [Theory]
    [InlineData("t", "5")]
    [InlineData("n", "\"5\"")]
    [InlineData("b", "\"true\"")]
    [InlineData("s", "\"c\"")]
    [InlineData("missing", "1")]
    public void CheckOption_rejects_wrong_values(string key, string json) =>
        Assert.ThrowsAny<Exception>(() => Control.CheckOption(M, key, JsonNode.Parse(json)));

    [Theory]
    [InlineData("0.5", 0.5)]
    [InlineData("1", 1.0)]
    [InlineData("1.5", 1.5)]
    [InlineData("3", 3.0)]
    [InlineData("1.333", 1.33)]
    public void CheckScale_accepts_50_to_300_percent(string json, double expected) =>
        Assert.Equal(expected, Control.CheckScale(JsonNode.Parse(json)));

    [Theory]
    [InlineData("0.49")]
    [InlineData("3.01")]
    [InlineData("150")]
    [InlineData("\"1.5\"")]
    [InlineData("true")]
    [InlineData("null")]
    public void CheckScale_rejects_other_values(string json) =>
        Assert.ThrowsAny<Exception>(() => Control.CheckScale(JsonNode.Parse(json)));

    [Fact]
    public void CheckScale_error_uses_a_decimal_point_on_any_culture()
    {
        var saved = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new("de-DE");
        try
        {
            var err = Assert.ThrowsAny<Exception>(() => Control.CheckScale(JsonNode.Parse("4")));
            Assert.Contains("0.5", err.Message);
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = saved; }
    }
}

public class ProtocolTests
{
    [Fact]
    public void Envelopes_have_the_documented_shape()
    {
        var req = Protocol.Request("configure", new JsonObject { ["id"] = "sp500" });
        Assert.Equal("""{"cmd":"configure","args":{"id":"sp500"}}""", req.ToJsonString());
        Assert.True(Protocol.Ok(1)["ok"]!.GetValue<bool>());
        Assert.Equal("nope", Protocol.Error("nope")["error"]!.GetValue<string>());
    }

    [Fact]
    public void Every_command_is_documented_once() =>
        Assert.Equal(Protocol.Commands.Length, Protocol.Commands.Select(c => c.Cmd).Distinct().Count());

    [Fact]
    public void Edit_mode_and_scale_are_part_of_the_protocol()
    {
        Assert.Contains(Protocol.Commands, c => c.Cmd == "edit-mode");
        Assert.Contains("scale?", Protocol.Commands.Single(c => c.Cmd == "configure").Help);
    }
}
