using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>permissions.commands: manifest rules, argument validation, hashing, the runner and the approval gate.</summary>
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

public class CommandRunnerTests
{
    public CommandRunnerTests() => TestEnv.Init();

    static string Cwd() => Path.Combine(TestEnv.DataDir, "run-" + Guid.NewGuid().ToString("N"));
    static string Exe(string name) => CommandRunner.ResolveExe(name, allowScripts: false) ?? throw new InvalidOperationException($"{name} missing");

    [Fact]
    public async Task Captures_stdout_and_exit_code()
    {
        var r = await CommandRunner.RunAsync(Exe("cmd"), new[] { "/c", "echo hello & exit 3" }, Cwd(), TimeSpan.FromSeconds(20));
        Assert.Equal(3, r.ExitCode);
        Assert.Contains("hello", r.Stdout);
        Assert.False(r.TimedOut);
    }

    [Fact]
    public async Task Runs_in_the_given_working_directory()
    {
        var cwd = Cwd();
        var r = await CommandRunner.RunAsync(Exe("cmd"), new[] { "/c", "cd" }, cwd, TimeSpan.FromSeconds(20));
        Assert.Equal(Path.GetFullPath(cwd), r.Stdout.Trim(), ignoreCase: true);
    }

    [Fact]
    public async Task Stderr_is_separate()
    {
        var r = await CommandRunner.RunAsync(Exe("powershell"), new[] { "-NoProfile", "-Command", "[Console]::Error.Write('oops'); exit 2" }, Cwd(), TimeSpan.FromSeconds(60));
        Assert.Equal(2, r.ExitCode);
        Assert.Equal("oops", r.Stderr.Trim());
        Assert.Equal("", r.Stdout);
    }

    [Fact]
    public async Task A_slow_process_is_killed_at_the_timeout()
    {
        var r = await CommandRunner.RunAsync(Exe("powershell"), new[] { "-NoProfile", "-Command", "Start-Sleep -Seconds 60" }, Cwd(), TimeSpan.FromSeconds(3));
        Assert.True(r.TimedOut);
        Assert.Equal(-1, r.ExitCode);
        Assert.InRange(r.DurationMs, 2000, 20000);
    }

    [Fact]
    public async Task Output_is_capped_but_the_process_still_finishes()
    {
        var r = await CommandRunner.RunAsync(Exe("powershell"), new[] { "-NoProfile", "-Command", "[Console]::Out.Write('x' * 300000); exit 0" },
            Cwd(), TimeSpan.FromSeconds(60), maxBytes: 1000);
        Assert.True(r.Truncated);
        Assert.Equal(1000, r.Stdout.Length);
        Assert.Equal(0, r.ExitCode);
        Assert.False(r.TimedOut);
    }

    [Fact]
    public async Task The_environment_is_scrubbed()
    {
        Environment.SetEnvironmentVariable("UMBRA_TEST_SECRET", "s3cret");
        Environment.SetEnvironmentVariable("ANTHROPIC_API_KEY", "key");
        try
        {
            var r = await CommandRunner.RunAsync(Exe("cmd"), new[] { "/c", "set" }, Cwd(), TimeSpan.FromSeconds(20));
            Assert.DoesNotContain("s3cret", r.Stdout);
            Assert.DoesNotContain("ANTHROPIC_API_KEY", r.Stdout, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("UMBRA_DATA_DIR", r.Stdout, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("SystemRoot", r.Stdout, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Environment.SetEnvironmentVariable("UMBRA_TEST_SECRET", null);
            Environment.SetEnvironmentVariable("ANTHROPIC_API_KEY", null);
        }
    }

    [Fact]
    public void Resolving_ignores_the_current_directory_and_relative_path_entries()
    {
        var dir = Cwd();
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "sneaky.exe"), "x");
        var saved = Directory.GetCurrentDirectory();
        try
        {
            Directory.SetCurrentDirectory(dir);
            Assert.Null(CommandRunner.ResolveExe("sneaky", false, pathVariable: ".;;relative"));
            Assert.Equal(Path.Combine(dir, "sneaky.exe"), CommandRunner.ResolveExe("sneaky", false, pathVariable: dir));
        }
        finally { Directory.SetCurrentDirectory(saved); }
    }

    [Fact]
    public void Batch_files_are_found_only_when_allowed()
    {
        var dir = Cwd();
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "tool.cmd"), "@echo off");
        Assert.Null(CommandRunner.ResolveExe("tool", false, dir));
        Assert.NotNull(CommandRunner.ResolveExe("tool", true, dir));
    }
}

public class CommandGateTests
{
    public CommandGateTests() => TestEnv.Init();

    const string Json = """
        { "id": "gate", "name": "Gate", "permissions": { "commands": [
          { "id": "hi", "run": ["cmd", "/c", "echo", "hello"], "description": "says hello" },
          { "id": "echo", "run": ["cmd", "/c", "echo", "${t}"], "params": { "t": { "choices": ["hello world", "a&b"] } } },
          { "id": "slow", "run": ["powershell", "-NoProfile", "-Command", "Start-Sleep -Seconds 30"], "timeoutSeconds": 1 },
          { "id": "ghost", "run": ["definitely-not-installed-xyz"] }
        ] } }
        """;

    sealed class Harness
    {
        public readonly CommandApprovals Approvals = new(Path.Combine(TestEnv.DataDir, $"approvals-{Guid.NewGuid():N}.json"));
        public readonly List<ApprovalRequest> Prompts = new();
        public bool Answer = true;
        public DateTime Now = new(2030, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        public CommandService Service;
        public Harness()
        {
            Service = new CommandService(Approvals, r => { Prompts.Add(r); return Task.FromResult(Answer); }, () => Now)
            {
                WorkingDir = id => Path.Combine(TestEnv.DataDir, "gate-run", id),
            };
        }
        public Task<JsonObject> Run(WidgetManifest m, string cmd, JsonObject? p = null, bool enabled = true, bool gesture = true) =>
            Service.RunAsync(m, enabled, gesture, cmd, p, CancellationToken.None);
    }

    static WidgetManifest M(string? json = null) => WidgetManifest.Parse(json ?? Json);

    [Fact]
    public async Task Undeclared_commands_cannot_run()
    {
        var h = new Harness();
        var ex = await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(M(), "calc"));
        Assert.Contains("did not declare", ex.Message);
        Assert.Empty(h.Prompts);
    }

    [Fact]
    public async Task A_disabled_widget_cannot_run_anything_even_when_approved()
    {
        var h = new Harness();
        var m = M();
        h.Approvals.Approve(m.Id, m.Permissions.Commands[0]);
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi", enabled: false));
        Assert.Empty(h.Prompts);
    }

    [Fact]
    public async Task First_run_asks_with_the_exact_command_then_remembers()
    {
        var h = new Harness();
        var m = M();
        var r = await h.Run(m, "hi");
        Assert.Equal(0, r["exitCode"]!.GetValue<int>());
        Assert.Contains("hello", r["stdout"]!.GetValue<string>());
        var p = Assert.Single(h.Prompts);
        Assert.Equal("cmd /c echo hello", p.CommandLine);
        Assert.Equal("gate", p.WidgetId);
        Assert.EndsWith("cmd.exe", p.ExePath, StringComparison.OrdinalIgnoreCase);

        await h.Run(m, "hi", gesture: false); // approved: no gesture or prompt needed any more
        Assert.Single(h.Prompts);
        Assert.Equal("approved", h.Approvals.Status("gate", m.Permissions.Commands[0]));
    }

    [Fact]
    public async Task Without_a_user_gesture_there_is_no_prompt_and_no_run()
    {
        var h = new Harness();
        var ex = await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(M(), "hi", gesture: false));
        Assert.Contains("approval", ex.Message);
        Assert.Empty(h.Prompts);
    }

    [Fact]
    public async Task Denying_does_not_run_or_remember()
    {
        var h = new Harness { Answer = false };
        var m = M();
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi"));
        Assert.Equal("pending", h.Approvals.Status("gate", m.Permissions.Commands[0]));
    }

    [Fact]
    public async Task A_changed_command_needs_a_new_approval()
    {
        var h = new Harness();
        await h.Run(M(), "hi");
        var changed = M(Json.Replace("\"hello\"", "\"goodbye\""));
        Assert.Equal("changed", h.Approvals.Status("gate", changed.Permissions.Commands[0]));
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(changed, "hi", gesture: false));
        h.Now = h.Now.AddMinutes(1);
        var r = await h.Run(changed, "hi");
        Assert.Contains("goodbye", r["stdout"]!.GetValue<string>());
        Assert.Equal(2, h.Prompts.Count);
    }

    [Fact]
    public async Task Approvals_belong_to_one_widget()
    {
        var h = new Harness();
        await h.Run(M(), "hi");
        var other = M(Json.Replace("\"id\": \"gate\"", "\"id\": \"other\""));
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(other, "hi", gesture: false));
    }

    [Fact]
    public async Task Prompts_are_rate_limited_and_stop_after_repeated_refusals()
    {
        var h = new Harness { Answer = false };
        var m = M();
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi"));
        // A page asking again at once gets no second prompt.
        var again = await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi"));
        Assert.Contains("wait", again.Message);
        Assert.Single(h.Prompts);

        for (int i = 0; i < CommandService.MaxDenials; i++)
        {
            h.Now = h.Now.AddMinutes(1);
            await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi"));
        }
        var before = h.Prompts.Count;
        h.Now = h.Now.AddHours(1);
        var blocked = await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi"));
        Assert.Contains("Settings", blocked.Message);
        Assert.Equal(before, h.Prompts.Count);
    }

    [Fact]
    public async Task Only_one_prompt_can_be_open_at_a_time()
    {
        var h = new Harness();
        var open = new TaskCompletionSource<bool>();
        h.Service = new CommandService(h.Approvals, r => { h.Prompts.Add(r); return open.Task; }, () => h.Now)
        { WorkingDir = id => Path.Combine(TestEnv.DataDir, "gate-run", id) };
        var m = M();
        var first = h.Run(m, "hi");
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "echo", new JsonObject { ["t"] = "a&b" }));
        open.SetResult(true);
        await first;
        Assert.Single(h.Prompts);
    }

    [Fact]
    public async Task Invalid_requests_never_raise_a_prompt()
    {
        var h = new Harness();
        var m = M();
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "echo"));                                              // missing parameter
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "echo", new JsonObject { ["t"] = "--evil" }));        // option injection
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "echo", new JsonObject { ["t"] = new string('a', 21) }));
        await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "hi", new JsonObject { ["t"] = "x" }));               // arguments can't be added
        var missing = await Assert.ThrowsAsync<WidgetCommandException>(() => h.Run(m, "ghost"));
        Assert.Contains("not found", missing.Message);
        Assert.Empty(h.Prompts);
    }

    [Fact]
    public async Task A_parameter_reaches_the_program_as_data()
    {
        var h = new Harness();
        var r = await h.Run(M(), "echo", new JsonObject { ["t"] = "hello world" });
        Assert.Equal(0, r["exitCode"]!.GetValue<int>());
        Assert.Contains("hello world", r["stdout"]!.GetValue<string>());
        // The prompt shows the declared command with its placeholder, not the value the page chose.
        Assert.Equal("cmd /c echo ${t}", h.Prompts[0].CommandLine);
        Assert.True(h.Prompts[0].HasParams);
    }

    [Fact]
    public async Task The_declared_timeout_applies()
    {
        var h = new Harness();
        var m = M();
        h.Approvals.Approve(m.Id, m.Permissions.Commands[2]);
        var r = await h.Run(m, "slow");
        Assert.True(r["timedOut"]!.GetValue<bool>());
        Assert.Equal(-1, r["exitCode"]!.GetValue<int>());
    }

    [Fact]
    public async Task Settings_approval_needs_the_hash_the_user_saw()
    {
        var h = new Harness();
        var m = M();
        var c = m.Permissions.Commands[0];
        Assert.Throws<WidgetCommandException>(() => h.Service.ApproveFromSettings(m, "hi", "deadbeef"));
        Assert.Throws<WidgetCommandException>(() => h.Service.ApproveFromSettings(m, "nope", c.Hash()));
        h.Service.ApproveFromSettings(m, "hi", c.Hash());
        Assert.Equal("approved", h.Approvals.Status("gate", c));
        await h.Run(m, "hi", gesture: false);
        Assert.Empty(h.Prompts);
    }
}

public class CommandApprovalStoreTests
{
    public CommandApprovalStoreTests() => TestEnv.Init();

    static CommandSpec Spec(string arg = "Hello") =>
        WidgetManifest.Parse($$"""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "wake", "run": ["whoami", "-p", "{{arg}}"] }] } }""").Permissions.Commands[0];

    [Fact]
    public void Approvals_persist_and_can_be_revoked()
    {
        var path = Path.Combine(TestEnv.DataDir, $"approvals-{Guid.NewGuid():N}.json");
        var a = new CommandApprovals(path);
        a.Approve("demo", Spec());
        a.Approve("other", Spec());

        var reloaded = new CommandApprovals(path);
        Assert.True(reloaded.IsApproved("demo", Spec()));
        Assert.False(reloaded.IsApproved("demo", Spec("Hello!")));
        Assert.Equal("changed", reloaded.Status("demo", Spec("Hello!")));
        Assert.Equal(2, reloaded.List().Count);

        Assert.Equal(1, reloaded.Revoke("demo", "wake"));
        Assert.False(new CommandApprovals(path).IsApproved("demo", Spec()));
        Assert.Equal(1, reloaded.Revoke("other"));
        Assert.Empty(new CommandApprovals(path).List());
    }

    [Fact]
    public void An_unreadable_file_means_nothing_is_approved()
    {
        var path = Path.Combine(TestEnv.DataDir, $"approvals-{Guid.NewGuid():N}.json");
        Directory.CreateDirectory(TestEnv.DataDir);
        File.WriteAllText(path, "{ not json");
        Assert.False(new CommandApprovals(path).IsApproved("demo", Spec()));
    }

    [Fact]
    public void Describe_lists_declared_commands_with_status()
    {
        var m = WidgetManifest.Parse("""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "wake", "run": ["whoami", "-p", "Hello"], "description": "d" }] } }""");
        var a = new CommandApprovals(Path.Combine(TestEnv.DataDir, $"approvals-{Guid.NewGuid():N}.json"));
        var list = a.Describe(new[] { m });
        Assert.Equal("pending", list[0]!["status"]!.GetValue<string>());
        Assert.Equal("whoami -p Hello", list[0]!["run"]!.GetValue<string>());
        a.Approve("demo", m.Permissions.Commands[0]);
        Assert.Equal("approved", a.Describe(new[] { m }, "demo")[0]!["status"]!.GetValue<string>());
        Assert.Empty(a.Describe(new[] { m }, "nobody"));
    }

    [Fact]
    public void Automation_has_no_command_that_approves()
    {
        Assert.Contains(Protocol.Commands, c => c.Cmd == "approvals");
        Assert.DoesNotContain(Protocol.Commands, c => c.Cmd.Contains("approve") || c.Cmd.Contains("revoke") || c.Cmd == "run");
    }
}
