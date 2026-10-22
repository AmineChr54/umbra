using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>permissions.commands on Windows: the runner (cmd/powershell, job objects), the approval gate and the approval store.</summary>
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
