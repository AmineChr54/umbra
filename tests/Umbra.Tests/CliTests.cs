extern alias cli;

using System.Text.Json.Nodes;
using McpServer = cli::Umbra.Cli.McpServer;
using Scaffold = cli::Umbra.Cli.Scaffold;

namespace Umbra.Tests;

public class McpServerTests
{
    readonly List<(string Cmd, JsonObject Args)> _sent = new();
    JsonObject _reply = Protocol.Ok(new JsonArray());

    McpServer Server() => new((cmd, args) => { _sent.Add((cmd, args)); return Task.FromResult(_reply); });

    static JsonObject Call(string method, JsonObject? @params = null, int id = 1) =>
        new() { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = method, ["params"] = @params ?? new JsonObject() };

    [Fact]
    public async Task Initialize_negotiates_a_supported_version()
    {
        var known = await Server().HandleAsync(Call("initialize", new JsonObject { ["protocolVersion"] = "2025-03-26" }));
        Assert.Equal("2025-03-26", known!["result"]!["protocolVersion"]!.GetValue<string>());
        var unknown = await Server().HandleAsync(Call("initialize", new JsonObject { ["protocolVersion"] = "1999-01-01" }));
        Assert.Equal("2025-06-18", unknown!["result"]!["protocolVersion"]!.GetValue<string>());
        Assert.NotNull(unknown["result"]!["capabilities"]!["tools"]);
    }

    [Fact]
    public async Task Notifications_get_no_reply()
    {
        var note = new JsonObject { ["jsonrpc"] = "2.0", ["method"] = "notifications/initialized" };
        Assert.Null(await Server().HandleAsync(note));
    }

    [Fact]
    public async Task Tools_list_has_schemas_for_every_tool()
    {
        var tools = (await Server().HandleAsync(Call("tools/list")))!["result"]!["tools"]!.AsArray();
        Assert.Contains(tools, t => t!["name"]!.GetValue<string>() == "create_widget");
        Assert.All(tools, t => Assert.Equal("object", t!["inputSchema"]!["type"]!.GetValue<string>()));
        Assert.Equal(McpServer.ToolNames.Count(), tools.Count);
    }

    [Fact]
    public async Task Tools_call_maps_to_the_control_command()
    {
        _reply = Protocol.Ok(new JsonObject { ["id"] = "sp500" });
        var res = await Server().HandleAsync(Call("tools/call", new JsonObject
        {
            ["name"] = "configure_widget",
            ["arguments"] = new JsonObject { ["id"] = "sp500", ["options"] = new JsonObject { ["symbol"] = "^IXIC" } },
        }));
        Assert.Equal("configure", _sent.Single().Cmd);
        Assert.Equal("^IXIC", _sent.Single().Args["options"]!["symbol"]!.GetValue<string>());
        Assert.Equal("text", res!["result"]!["content"]![0]!["type"]!.GetValue<string>());
        Assert.Null(res["result"]!["isError"]);
    }

    [Fact]
    public async Task Capture_returns_an_image_block()
    {
        _reply = Protocol.Ok(new JsonObject { ["base64"] = "iVBORw0=", ["mimeType"] = "image/png" });
        var res = await Server().HandleAsync(Call("tools/call", new JsonObject { ["name"] = "capture", ["arguments"] = new JsonObject { ["target"] = "sp500" } }));
        var block = res!["result"]!["content"]![0]!;
        Assert.Equal("image", block["type"]!.GetValue<string>());
        Assert.Equal("iVBORw0=", block["data"]!.GetValue<string>());
    }

    [Fact]
    public async Task Host_errors_become_tool_errors()
    {
        _reply = Protocol.Error("No widget 'x'");
        var res = await Server().HandleAsync(Call("tools/call", new JsonObject { ["name"] = "remove_widget", ["arguments"] = new JsonObject { ["id"] = "x" } }));
        Assert.True(res!["result"]!["isError"]!.GetValue<bool>());
        Assert.Contains("No widget", res["result"]!["content"]![0]!["text"]!.GetValue<string>());
    }

    [Fact]
    public async Task Unknown_method_and_tool_are_rpc_errors()
    {
        Assert.Equal(-32601, (await Server().HandleAsync(Call("nope")))!["error"]!["code"]!.GetValue<int>());
        var res = await Server().HandleAsync(Call("tools/call", new JsonObject { ["name"] = "nope" }));
        Assert.Equal(-32602, res!["error"]!["code"]!.GetValue<int>());
    }

    [Fact]
    public async Task RunAsync_speaks_newline_delimited_json()
    {
        var input = new StringReader("""{"jsonrpc":"2.0","id":7,"method":"ping"}""" + "\n{oops\n");
        var output = new StringWriter();
        await Server().RunAsync(input, output);
        var lines = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(7, JsonNode.Parse(lines[0])!["id"]!.GetValue<int>());
        Assert.Equal(-32700, JsonNode.Parse(lines[1])!["error"]!["code"]!.GetValue<int>());
    }
}

public class ScaffoldTests
{
    [Fact]
    public void Template_is_a_valid_widget()
    {
        var files = Scaffold.Files("hello-world", "Hello");
        var m = WidgetManifest.Parse(files["widget.json"]);
        Assert.Equal("hello-world", m.Id);
        Assert.True(files.ContainsKey(m.Entry));
        Assert.All(files.Keys, f => Assert.True(Community.IsSafeRelativePath(f), f));
        Assert.All(m.Options, kv => Control.CheckOption(m, kv.Key, kv.Value!["default"]));
    }

    [Fact]
    public void Create_writes_the_folder_and_refuses_to_clobber()
    {
        var parent = Path.Combine(Path.GetTempPath(), $"umbra-scaffold-{Guid.NewGuid():N}");
        var dir = Scaffold.Create("my-widget", "My", parent);
        Assert.True(File.Exists(Path.Combine(dir, "widget.json")));
        Assert.Throws<IOException>(() => Scaffold.Create("my-widget", "My", parent));
        Assert.Throws<ArgumentException>(() => Scaffold.Create("Bad", "x", parent));
    }
}
