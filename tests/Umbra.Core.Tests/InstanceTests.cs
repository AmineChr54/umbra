extern alias cli;

using System.Text.Json.Nodes;
using CommandLine = cli::Umbra.Cli.CommandLine;
using McpServer = cli::Umbra.Cli.McpServer;

namespace Umbra.Tests;

public class InstanceIdTests
{
    [Theory]
    [InlineData("sp500", true, "sp500", 1)]
    [InlineData("sp500#2", true, "sp500", 2)]
    [InlineData("sp500#20", true, "sp500", 20)]
    [InlineData("sp500#1", false, "sp500#1", 1)]
    [InlineData("sp500#0", false, "sp500#0", 1)]
    [InlineData("sp500#02", false, "sp500#02", 1)]
    [InlineData("sp500#2#3", false, "sp500#2#3", 1)]
    [InlineData("../evil#2", false, "../evil#2", 1)]
    [InlineData("Bad#2", false, "Bad#2", 1)]
    public void Parses_and_validates(string id, bool valid, string widget, int number)
    {
        Assert.Equal(valid, InstanceId.IsValid(id));
        Assert.Equal(widget, InstanceId.WidgetOf(id));
        Assert.Equal(number, InstanceId.NumberOf(id));
    }

    [Fact]
    public void Make_and_file_name_round_trip()
    {
        Assert.Equal("sp500", InstanceId.Make("sp500", 1));
        Assert.Equal("sp500#3", InstanceId.Make("sp500", 3));
        Assert.Equal("sp500__3", InstanceId.FileName("sp500#3"));
        Assert.DoesNotContain('#', InstanceId.FileName("sp500#3"));
    }
}

public class InstanceSettingsTests
{
    public InstanceSettingsTests() => TestEnv.Init();

    static WidgetManifest Manifest(string id = "demo") => WidgetManifest.Parse(
        $$"""{ "id": "{{id}}", "name": "Demo", "options": { "symbol": { "type": "text", "default": "A" } } }""");

    [Fact]
    public void Old_settings_files_load_with_a_single_copy()
    {
        var old = JsonNode.Parse("""{ "general": { "refreshSeconds": 60 }, "widgets": { "demo": { "enabled": true, "x": 5, "y": 6, "options": { "symbol": "KEEP" } } } }""")!;
        var s = Settings.FromJson(old);
        Assert.Equal(new[] { "demo" }, s.Instances("demo"));
        Assert.Equal("KEEP", s.For(Manifest()).Options["symbol"]!.GetValue<string>());
        Assert.Equal(5, s.For(Manifest()).X);
    }

    [Fact]
    public void Copies_have_their_own_settings_and_survive_a_save_round_trip()
    {
        var m = Manifest();
        var s = new Settings();
        s.For(m).Options["symbol"] = "FIRST";
        var two = s.AddInstance(m)!;
        var three = s.AddInstance(m)!;
        Assert.Equal(new[] { "demo#2", "demo#3" }, new[] { two, three });
        Assert.Equal("A", s.For(m, two).Options["symbol"]!.GetValue<string>()); // defaults, not the first copy's value
        s.For(m, two).Options["symbol"] = "SECOND";
        s.For(m, two).Enabled = false;

        var back = Settings.FromJson(s.ToJson());
        Assert.Equal(new[] { "demo", "demo#2", "demo#3" }, back.Instances("demo"));
        Assert.Equal("FIRST", back.For(m).Options["symbol"]!.GetValue<string>());
        Assert.Equal("SECOND", back.For(m, two).Options["symbol"]!.GetValue<string>());
        Assert.False(back.For(m, two).Enabled);
        Assert.True(back.For(m).Enabled);
    }

    [Fact]
    public void Add_reuses_a_freed_number_and_stops_at_the_limit()
    {
        var m = Manifest();
        var s = new Settings();
        s.AddInstance(m);
        s.AddInstance(m);
        s.Widgets.Remove("demo#2");
        Assert.Equal("demo#2", s.AddInstance(m));
        while (s.AddInstance(m) is not null) { }
        Assert.Equal(InstanceId.MaxInstances, s.Instances("demo").Count);
    }

    [Fact]
    public void Instances_ignore_other_widgets_and_garbage_keys()
    {
        var s = new Settings();
        foreach (var k in new[] { "demo", "demo#2", "demo2#2", "demo#x", "demo#1" }) s.Widgets[k] = new();
        Assert.Equal(new[] { "demo", "demo#2" }, s.Instances("demo"));
    }

    [Fact]
    public void For_rejects_an_instance_of_another_widget() =>
        Assert.Throws<ArgumentException>(() => new Settings().For(Manifest(), "other#2"));

    [Fact]
    public void RemoveExtraInstances_keeps_the_first_copy()
    {
        var m = Manifest();
        var s = new Settings();
        s.For(m);
        s.AddInstance(m);
        s.AddInstance(m);
        Assert.Equal(new[] { "demo#2", "demo#3" }, s.RemoveExtraInstances("demo"));
        Assert.Equal(new[] { "demo" }, s.Instances("demo"));
    }
}

public class InstanceStoreTests
{
    public InstanceStoreTests() => TestEnv.Init();

    [Fact]
    public void Each_copy_has_its_own_file()
    {
        WidgetStore.Set("inst-a", "k", "one");
        WidgetStore.Set("inst-a#2", "k", "two");
        Assert.Equal("one", WidgetStore.Get("inst-a", "k").Value!.GetValue<string>());
        Assert.Equal("two", WidgetStore.Get("inst-a#2", "k").Value!.GetValue<string>());
        Assert.True(File.Exists(Path.Combine(TestEnv.DataDir, "data", "inst-a__2.json")));
        Assert.Throws<InvalidOperationException>(() => WidgetStore.Set("inst-a#1", "k", 1));
    }

    [Fact]
    public void DeleteAll_removes_every_copy_but_not_neighbours()
    {
        WidgetStore.Set("inst-b", "k", 1);
        WidgetStore.Set("inst-b#2", "k", 1);
        WidgetStore.Set("inst-b#3", "k", 1);
        WidgetStore.Set("inst-b-other", "k", 1);
        WidgetStore.DeleteAll("inst-b");
        Assert.False(WidgetStore.Get("inst-b", "k").Found);
        Assert.False(WidgetStore.Get("inst-b#2", "k").Found);
        Assert.False(WidgetStore.Get("inst-b#3", "k").Found);
        Assert.True(WidgetStore.Get("inst-b-other", "k").Found);
    }

    [Theory]
    [InlineData("inst-d__+3", false)]
    [InlineData("inst-d__-5", false)]
    [InlineData("inst-d__ 3", false)]
    [InlineData("inst-d__3", true)]
    public void DeleteAll_parses_the_copy_number_strictly(string name, bool deleted)
    {
        var dir = Path.Combine(TestEnv.DataDir, "data");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, name + ".json");
        File.WriteAllText(file, "{}");
        WidgetStore.DeleteAll("inst-d");
        Assert.Equal(!deleted, File.Exists(file));
    }

    [Fact]
    public void CopyIds_lists_extra_copy_files_so_orphans_can_be_found()
    {
        WidgetStore.Set("inst-e#2", "k", 1);
        WidgetStore.Set("inst-e", "k", 1);
        Assert.Contains("inst-e#2", WidgetStore.CopyIds());
        Assert.DoesNotContain("inst-e", WidgetStore.CopyIds());
    }

    [Fact]
    public void Delete_of_one_copy_leaves_the_others()
    {
        WidgetStore.Set("inst-c", "k", 1);
        WidgetStore.Set("inst-c#2", "k", 2);
        WidgetStore.Delete("inst-c#2");
        Assert.True(WidgetStore.Get("inst-c", "k").Found);
        Assert.False(WidgetStore.Get("inst-c#2", "k").Found);
    }
}

public class InstanceCommandTests
{
    [Fact]
    public void Protocol_lists_the_instance_commands()
    {
        var cmds = Protocol.Commands.Select(c => c.Cmd).ToList();
        Assert.Contains("add-instance", cmds);
        Assert.Contains("remove-instance", cmds);
    }

    [Fact]
    public async Task Cli_maps_instance_commands_and_accepts_instance_ids()
    {
        var empty = Protocol.Ok(new JsonArray());
        Task<JsonObject> Send(string _, JsonObject __) => Task.FromResult(empty);
        var (cmd, args) = await CommandLine.TranslateAsync(new[] { "add-instance", "sp500" }, Send);
        Assert.Equal(("add-instance", "sp500"), (cmd, args["id"]!.GetValue<string>()));
        (cmd, args) = await CommandLine.TranslateAsync(new[] { "remove-instance", "sp500#2" }, Send);
        Assert.Equal(("remove-instance", "sp500#2"), (cmd, args["id"]!.GetValue<string>()));
        (cmd, args) = await CommandLine.TranslateAsync(new[] { "disable", "sp500#2" }, Send);
        Assert.Equal(("configure", "sp500#2"), (cmd, args["id"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Mcp_has_instance_tools()
    {
        var sent = new List<(string Cmd, JsonObject Args)>();
        var server = new McpServer((c, a) => { sent.Add((c, a)); return Task.FromResult(Protocol.Ok(null)); });
        foreach (var (tool, id) in new[] { ("add_widget_instance", "sp500"), ("remove_widget_instance", "sp500#2") })
            await server.HandleAsync(new JsonObject
            {
                ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "tools/call",
                ["params"] = new JsonObject { ["name"] = tool, ["arguments"] = new JsonObject { ["id"] = id } },
            });
        Assert.Equal(new[] { "add-instance", "remove-instance" }, sent.Select(s => s.Cmd));
        Assert.Equal("sp500#2", sent[1].Args["id"]!.GetValue<string>());
    }
}
