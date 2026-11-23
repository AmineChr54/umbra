using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>
/// The "scripts" control command (umbractl scripts, MCP scripts): AI agents manage the user's scripts only while the user
/// switched on General.AgentScripts in Settings, and never a script that runs as administrator.
/// </summary>
public class AgentScriptsTests
{
    public AgentScriptsTests() => TestEnv.Init();

    static WidgetManifest Runner() => WidgetManifest.Parse("""
        { "id": "runner", "name": "Runner", "permissions": { "userScripts": true, "commands": [{ "id": "disk-free", "run": ["a"] }] } }
        """);

    static CommandService Service()
    {
        var dir = Path.Combine(TestEnv.DataDir, "agentscripts-" + Guid.NewGuid().ToString("N"));
        var approvals = new CommandApprovals(Path.Combine(dir, "approvals.json"));
        return new CommandService(approvals, _ => Task.FromResult(false), scripts: new UserScripts(Path.Combine(dir, "scripts.json"), Path.Combine(dir, "scripts")))
        { WorkingDir = id => Path.Combine(dir, "run", id) };
    }

    static AgentScripts.Context Ctx(CommandService svc, bool allowed, bool windowOpen = true, WidgetManifest? m = null) =>
        new(svc, m ?? Runner(), allowed, Enabled: true, WindowOpen: windowOpen);

    static Task<JsonNode?> Do(AgentScripts.Context c, string op, string? scriptId = null, JsonObject? script = null)
    {
        var a = new JsonObject { ["op"] = op };
        if (scriptId is not null) a["scriptId"] = scriptId;
        if (script is not null) a["script"] = script;
        return AgentScripts.ExecuteAsync(c, op, a);
    }

    static JsonObject Missing(string title = "Missing tool") => new() { ["title"] = title, ["kind"] = "program", ["path"] = "C:\\does-not-exist\\tool.exe" };

    [Fact]
    public async Task With_the_switch_off_agents_only_read()
    {
        var svc = Service();
        var m = Runner();
        svc.SaveUserScript(m, new UserScript { Title = "Mine", Kind = "powershell", Mode = "code", Code = "Write-Output secret" });
        var off = Ctx(svc, allowed: false);

        var list = (await Do(off, "list"))!.AsObject();
        Assert.False(list["agentAccess"]!.GetValue<bool>());
        var row = list["scripts"]!.AsArray().Single()!.AsObject();
        Assert.Equal("mine", row["id"]!.GetValue<string>());
        Assert.Null(row["code"]); // the code itself only while agents may manage scripts
        Assert.NotNull(await Do(off, "get", "Mine")); // by name too
        Assert.NotNull(await Do(off, "output", "mine"));

        foreach (var op in new[] { "add", "edit", "delete", "approve", "run", "stop" })
        {
            var ex = await Assert.ThrowsAsync<WidgetCommandException>(() => Do(off, op, "mine", Missing()));
            Assert.Contains(AgentScripts.SwitchName, ex.Message);
        }
        Assert.Single(svc.UserScriptsOf(m));
        Assert.Equal("Mine", svc.UserScriptsOf(m)[0].Title);
    }

    [Fact]
    public async Task With_the_switch_on_agents_add_edit_and_delete()
    {
        var svc = Service();
        var m = Runner();
        var on = Ctx(svc, allowed: true);

        var added = (await Do(on, "add", script: Missing()))!.AsObject();
        Assert.Equal("missing-tool", added["id"]!.GetValue<string>());
        Assert.Equal("pending", added["status"]!.GetValue<string>()); // its program isn't there, so it can't be approved yet
        Assert.NotNull(added["note"]);

        // Edit changes only what was sent.
        var edited = (await Do(on, "edit", "missing-tool", new JsonObject { ["args"] = "--fast", ["description"] = "Fast" }))!.AsObject();
        var s = svc.UserScriptsOf(m).Single();
        Assert.Equal(("Missing tool", "--fast", "Fast", "C:\\does-not-exist\\tool.exe"), (s.Title, s.Args, s.Description, s.Path));
        Assert.Equal("C:\\does-not-exist\\tool.exe --fast", edited["line"]!.GetValue<string>());

        Assert.Equal("missing-tool", (await Do(on, "delete", "Missing tool"))!["deleted"]!.GetValue<string>());
        Assert.Empty(svc.UserScriptsOf(m));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "delete", "missing-tool"));
    }

    [Fact]
    public async Task Bad_input_is_refused_with_a_sentence()
    {
        var on = Ctx(Service(), allowed: true);
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "add", script: new JsonObject { ["title"] = "X", ["kind"] = "program", ["path"] = "C:\\x.exe", ["shell"] = true }));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "add", script: new JsonObject { ["title"] = "X", ["kind"] = "program", ["path"] = "C:\\x.exe", ["timeoutSeconds"] = "60" }));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "add", script: new JsonObject { ["title"] = "", ["kind"] = "program", ["path"] = "C:\\x.exe" }));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "add"));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "explode"));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "run", "nope"));
        // A declared command of the widget isn't a script: agents can't run it through "scripts".
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "run", "disk-free"));
    }

    [Fact]
    public async Task A_widget_without_userScripts_is_refused()
    {
        var plain = WidgetManifest.Parse("""{ "id": "plain", "name": "Plain" }""");
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(Ctx(Service(), allowed: true, m: plain), "list"));
    }

    [Fact]
    public async Task Scripts_that_run_as_administrator_stay_the_users()
    {
        var svc = Service();
        var m = Runner();
        var on = Ctx(svc, allowed: true);
        var admin = Missing("Admin");
        admin["runAsAdmin"] = true;
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "add", script: admin));

        // One the user made in Settings: agents can't change, approve or run it, and can't turn an ordinary one into it.
        svc.SaveUserScript(m, new UserScript { Title = "Admin", Kind = "program", Path = "C:\\does-not-exist\\tool.exe", RunAsAdmin = true });
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "edit", "admin", new JsonObject { ["args"] = "--x" }));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "approve", "admin"));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "run", "admin"));
        await Do(on, "add", script: Missing("Plain"));
        await Assert.ThrowsAsync<WidgetCommandException>(() => Do(on, "edit", "plain", new JsonObject { ["runAsAdmin"] = true }));
        Assert.False(svc.UserScriptsOf(m).Single(s => s.Id == "plain").RunAsAdmin);
    }

    [Fact]
    public async Task A_script_that_keeps_running_starts_only_while_its_widget_is_on()
    {
        var svc = Service();
        var script = Missing("Tunnel");
        script["keepsRunning"] = true;
        await Do(Ctx(svc, allowed: true), "add", script: script);
        var ex = await Assert.ThrowsAsync<WidgetCommandException>(() => Do(Ctx(svc, allowed: true, windowOpen: false), "run", "tunnel"));
        Assert.Contains("on first", ex.Message);
        Assert.False((await Do(Ctx(svc, allowed: true), "stop", "tunnel"))!["stopped"]!.GetValue<bool>());
    }

    [WindowsFact]
    public async Task An_agent_adds_runs_and_edits_a_script()
    {
        var svc = Service();
        var on = Ctx(svc, allowed: true);
        var added = (await Do(on, "add", script: new JsonObject { ["title"] = "Hello", ["kind"] = "powershell", ["code"] = "Write-Output \"hi $($args[0])\"", ["args"] = "there" }))!.AsObject();
        Assert.Equal("approved", added["status"]!.GetValue<string>()); // saving approves exactly this command
        Assert.Equal("code", added["mode"]!.GetValue<string>());
        Assert.NotNull(added["code"]);

        var r = (await Do(on, "run", "hello"))!.AsObject();
        Assert.Equal(0, r["exitCode"]!.GetValue<int>());
        Assert.Equal("hi there", r["stdout"]!.GetValue<string>().Trim());

        await Do(on, "edit", "hello", new JsonObject { ["code"] = "Write-Output changed" });
        r = (await Do(on, "run", "hello"))!.AsObject();
        Assert.Equal("changed", r["stdout"]!.GetValue<string>().Trim());
    }

    [Fact]
    public void No_control_command_turns_agent_access_on()
    {
        // set-general goes through Prefs.ApplyGeneral plus a fixed list of fields; agentScripts is in neither.
        var g = new GeneralSettings();
        Prefs.ApplyGeneral(new JsonObject { ["agentScripts"] = true }, g);
        Assert.False(g.AgentScripts);
        Assert.False(new Settings().General.AgentScripts); // off by default
        Assert.DoesNotContain("agentScripts", Protocol.Commands.Single(c => c.Cmd == "set-general").Help);
    }
}
