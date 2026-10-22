using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>permissions.commands: manifest rules, argument validation and hashing (the runner and the approval gate are tested in Umbra.Tests).</summary>
public class CommandManifestTests
{
    public CommandManifestTests() => TestEnv.Init();

    static string Manifest(string commands) =>
        $$"""{ "id": "demo", "name": "Demo", "permissions": { "commands": {{commands}} } }""";

    [Fact]
    public void Valid_command_parses()
    {
        var m = WidgetManifest.Parse(Manifest("""
            [{ "id": "wake", "run": ["claude", "-p", "Hello"], "description": "d" },
             { "id": "ask", "run": ["claude", "-p", "${prompt}"], "params": { "prompt": { "maxLength": 50 } }, "timeoutSeconds": 30 },
             { "id": "abs", "run": ["C:\\Tools\\app.exe", "--x"] }]
            """));
        var c = m.Permissions.Commands;
        Assert.Equal(3, c.Count);
        Assert.Equal("claude", c[0].Exe);
        Assert.Equal(60, c[0].TimeoutSeconds);
        Assert.Equal(50, c[1].Params["prompt"].MaxLength);
        Assert.Equal("claude -p Hello", c[0].DisplayLine());
    }

    [Fact]
    public void Widgets_without_commands_have_none() =>
        Assert.Empty(WidgetManifest.Parse("""{ "id": "demo", "name": "Demo" }""").Permissions.Commands);

    [Theory]
    [InlineData("""[{ "id": "x", "run": [] }]""")]                                                   // no executable
    [InlineData("""[{ "id": "x", "run": ["claude -p Hello"] }]""")]                                  // a shell-style line is not an executable
    [InlineData("""[{ "id": "x", "run": ["cmd /c", "dir"] }]""")]
    [InlineData("""[{ "id": "x", "run": ["tools\\app.exe"] }]""")]                                   // relative path
    [InlineData("""[{ "id": "x", "run": ["..\\app.exe"] }]""")]
    [InlineData("""[{ "id": "x", "run": ["\\\\server\\share\\app.exe"] }]""")]                       // UNC
    [InlineData("""[{ "id": "x", "run": ["${exe}"], "params": { "exe": {} } }]""")]                  // the program can't be a parameter
    [InlineData("""[{ "id": "x", "run": ["a", "--q=${p}"], "params": { "p": {} } }]""")]             // no concatenation
    [InlineData("""[{ "id": "x", "run": ["a", "${p}"] }]""")]                                        // undeclared parameter
    [InlineData("""[{ "id": "x", "run": ["a"], "params": { "p": {} } }]""")]                         // unused parameter
    [InlineData("""[{ "id": "x", "run": ["a", "${p}"], "params": { "p": { "maxLength": 5000 } } }]""")]
    [InlineData("""[{ "id": "x", "run": ["a", "${p}"], "params": { "p": { "regex": ".*" } } }]""")]  // unknown parameter key
    [InlineData("""[{ "id": "x", "run": ["a"], "shell": true }]""")]                                 // unknown key
    [InlineData("""[{ "id": "X!", "run": ["a"] }]""")]
    [InlineData("""[{ "id": "x", "run": ["a"] }, { "id": "x", "run": ["b"] }]""")]                   // duplicate id
    [InlineData("""[{ "id": "x", "run": ["a"], "timeoutSeconds": 9999 }]""")]
    [InlineData("""[{ "id": "x", "run": ["a", "line\nbreak"] }]""")]
    [InlineData("""{ "id": "x", "run": ["a"] }""")]                                                  // not an array
    [InlineData("""["a"]""")]
    public void Invalid_commands_are_rejected(string commands) =>
        Assert.ThrowsAny<Exception>(() => WidgetManifest.Parse(Manifest(commands)));

    [Fact]
    public void Too_many_commands_are_rejected()
    {
        var many = string.Join(",", Enumerable.Range(0, 17).Select(i => $$"""{ "id": "c{{i}}", "run": ["a"] }"""));
        Assert.ThrowsAny<Exception>(() => WidgetManifest.Parse(Manifest($"[{many}]")));
    }

    [Fact]
    public void A_bad_command_stops_the_widget_from_loading()
    {
        var root = Path.Combine(TestEnv.DataDir, "cmd-discover-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "evil"));
        File.WriteAllText(Path.Combine(root, "evil", "widget.json"),
            """{ "id": "evil", "name": "E", "permissions": { "commands": [{ "id": "x", "run": ["cmd /c calc"] }] } }""");
        Assert.Empty(WidgetManifest.Discover(root, WidgetSource.Community));
    }

    [Fact]
    public void Local_widget_writer_validates_commands()
    {
        var files = new Dictionary<string, string>
        {
            ["widget.json"] = """{ "id": "cmdw", "name": "C", "permissions": { "commands": [{ "id": "x", "run": ["a", "${p}"] }] } }""",
            ["index.html"] = "<html></html>",
        };
        Assert.ThrowsAny<Exception>(() => Community.WriteLocalWidget("cmdw", files, overwrite: true));
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, "cmdw")));
    }
}

public class CommandArgsTests
{
    static CommandSpec Spec(string run, string? ps = null) =>
        WidgetManifest.Parse($$"""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "c", "run": {{run}}{{(ps is null ? "" : ", \"params\": " + ps)}} }] } }""")
            .Permissions.Commands[0];

    static JsonObject P(params (string, JsonNode?)[] kv) { var o = new JsonObject(); foreach (var (k, v) in kv) o[k] = v; return o; }

    [Fact]
    public void Literal_arguments_come_only_from_the_manifest()
    {
        var c = Spec("""["claude", "-p", "Hello"]""");
        Assert.Equal(new[] { "-p", "Hello" }, c.BuildArgs(null));
        // Anything a page sends for a command without parameters is refused.
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("extra", "x"))));
    }

    [Fact]
    public void A_parameter_becomes_exactly_one_argument()
    {
        var c = Spec("""["tool", "--mode", "fixed", "${text}"]""", """{ "text": {} }""");
        var nasty = "hello world \" & calc.exe | echo \"two\" ; $(x) %PATH%";
        var args = c.BuildArgs(P(("text", nasty)));
        Assert.Equal(new[] { "--mode", "fixed", nasty }, args);
    }

    [Theory]
    [InlineData(null)]                 // missing
    [InlineData("-rf")]                // looks like an option
    [InlineData("--config=evil")]
    [InlineData("")]
    [InlineData("bad\0nul")]
    [InlineData("bell\u0007")]
    public void Bad_parameter_values_are_rejected(string? value)
    {
        var c = Spec("""["tool", "${t}"]""", """{ "t": {} }""");
        var args = value is null ? new JsonObject() : P(("t", value));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(args));
    }

    [Fact]
    public void Non_string_and_oversize_values_are_rejected()
    {
        var c = Spec("""["tool", "${t}"]""", """{ "t": { "maxLength": 5 } }""");
        Assert.Equal(new[] { "abcde" }, c.BuildArgs(P(("t", "abcde"))));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("t", "abcdef"))));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("t", 5))));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("t", new JsonArray("a")))));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("t", "ok"), ("other", "x"))));
    }

    [Fact]
    public void Choices_allow_only_the_listed_values()
    {
        var c = Spec("""["tool", "${m}"]""", """{ "m": { "choices": ["haiku", "--opus"] } }""");
        Assert.Equal(new[] { "haiku" }, c.BuildArgs(P(("m", "haiku"))));
        Assert.Equal(new[] { "--opus" }, c.BuildArgs(P(("m", "--opus")))); // fixed by the author, so fine
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("m", "Haiku"))));
        Assert.Throws<WidgetCommandException>(() => c.BuildArgs(P(("m", "sonnet"))));
    }

    [Fact]
    public void Hash_covers_what_runs_but_not_the_description()
    {
        var a = Spec("""["claude", "-p", "Hello"]""");
        Assert.Equal(a.Hash(), Spec("""["claude", "-p", "Hello"]""").Hash());
        Assert.Equal(64, a.Hash().Length);
        Assert.NotEqual(a.Hash(), Spec("""["claude", "-p", "Hello!"]""").Hash());
        Assert.NotEqual(a.Hash(), Spec("""["claude2", "-p", "Hello"]""").Hash());
        Assert.NotEqual(a.Hash(), Spec("""["claude", "-p", "Hello", "x"]""").Hash());
        var withDesc = WidgetManifest.Parse("""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "c", "run": ["claude", "-p", "Hello"], "description": "other" }] } }""").Permissions.Commands[0];
        Assert.Equal(a.Hash(), withDesc.Hash());
        // Loosening a parameter limit is a change too.
        Assert.NotEqual(Spec("""["t", "${p}"]""", """{ "p": { "maxLength": 10 } }""").Hash(), Spec("""["t", "${p}"]""", """{ "p": { "maxLength": 11 } }""").Hash());
    }
}
