using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>Interpreter rules, leading '-' and '/', binding approvals to the program file, dialog text and job objects.</summary>
public class CommandHardeningTests
{
    public CommandHardeningTests() => TestEnv.Init();

    static string M(string run, string ps) =>
        $$"""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "c", "run": {{run}}, "params": {{ps}} }] } }""";

    [Theory]
    [InlineData("cmd")]
    [InlineData("CMD.EXE")]
    [InlineData("powershell")]
    [InlineData("pwsh")]
    [InlineData("wscript")]
    [InlineData("cscript")]
    [InlineData("mshta")]
    [InlineData("node")]
    [InlineData("python")]
    [InlineData("py")]
    [InlineData("bash")]
    [InlineData("sh")]
    [InlineData("wsl")]
    [InlineData("rundll32")]
    [InlineData("regsvr32")]
    [InlineData("msiexec")]
    [InlineData("run.ps1")]
    [InlineData("run.bat")]
    [InlineData("run.cmd")]
    [InlineData("run.vbs")]
    [InlineData("run.js")]
    public void Interpreters_refuse_free_text_parameters(string exe)
    {
        Assert.ThrowsAny<Exception>(() => WidgetManifest.Parse(M($"[\"{exe}\", \"${{p}}\"]", """{ "p": {} }""")));
        Assert.ThrowsAny<Exception>(() => WidgetManifest.Parse(M($"[\"{exe}\", \"${{p}}\"]", """{ "p": { "maxLength": 5 } }""")));
        var fixedChoices = M($"[\"{exe}\", \"${{p}}\"]", """{ "p": { "choices": ["one", "two"] } }""");
        Assert.True(WidgetManifest.Parse(fixedChoices).Permissions.Commands[0].IsInterpreter);
    }

    [Fact]
    public void Interpreter_paths_and_normal_programs_are_told_apart()
    {
        Assert.Throws<InvalidOperationException>(() => WidgetManifest.Parse(M("""["C:\\Windows\\System32\\cmd.exe", "${p}"]""", """{ "p": {} }""")));
        Assert.False(WidgetManifest.Parse(M("""["claude", "${p}"]""", """{ "p": {} }""")).Permissions.Commands[0].IsInterpreter);
        // An interpreter with only literal arguments is allowed; the prompt flags it in red.
        Assert.True(WidgetManifest.Parse("""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "c", "run": ["powershell", "-File", "C:\\s\\a.ps1"] }] } }""").Permissions.Commands[0].IsInterpreter);
    }

    [Theory]
    [InlineData("-x")]
    [InlineData("--x")]
    [InlineData("/c")]
    [InlineData("/?")]
    public void Free_values_must_not_start_with_dash_or_slash(string value)
    {
        var spec = WidgetManifest.Parse(M("""["claude", "${p}"]""", """{ "p": {} }""")).Permissions.Commands[0];
        Assert.Throws<WidgetCommandException>(() => spec.BuildArgs(new JsonObject { ["p"] = value }));
        Assert.Equal(new[] { "ok/-" }, spec.BuildArgs(new JsonObject { ["p"] = "ok/-" }));
        // Fixed choices may start with either, because the author wrote them.
        var fixedSpec = WidgetManifest.Parse(M("""["claude", "${p}"]""", $$"""{ "p": { "choices": ["{{value}}"] } }""")).Permissions.Commands[0];
        Assert.Equal(new[] { value }, fixedSpec.BuildArgs(new JsonObject { ["p"] = value }));
    }

    [Fact]
    public void Approval_is_bound_to_the_program_file()
    {
        var dir = Path.Combine(TestEnv.DataDir, "exe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var exe = Path.Combine(dir, "tool.exe");
        File.Copy(Path.Combine(Environment.SystemDirectory, "whoami.exe"), exe);
        var json = "{ \"id\": \"demo\", \"name\": \"D\", \"permissions\": { \"commands\": [{ \"id\": \"c\", \"run\": [" + System.Text.Json.JsonSerializer.Serialize(exe) + "] }] } }";
        var spec = WidgetManifest.Parse(json).Permissions.Commands[0];
        var file = Path.Combine(dir, "approvals.json");
        var a = new CommandApprovals(file);

        Assert.Equal("pending", a.Status("demo", spec));
        a.Approve("demo", spec);
        Assert.Equal("approved", a.Status("demo", spec));
        Assert.Equal("approved", new CommandApprovals(file).Status("demo", spec)); // persisted with the file's hash

        // Swapping the file's contents invalidates the approval although the manifest is identical.
        File.Copy(Path.Combine(Environment.SystemDirectory, "hostname.exe"), exe, overwrite: true);
        Assert.Equal("changed", a.Status("demo", spec));
        Assert.False(a.IsApproved("demo", spec));
        a.Approve("demo", spec);
        Assert.Equal("approved", a.Status("demo", spec));
    }

    [Fact]
    public void An_approval_for_another_path_or_hash_is_not_valid()
    {
        var spec = WidgetManifest.Parse("""{ "id": "demo", "name": "D", "permissions": { "commands": [{ "id": "c", "run": ["cmd", "/c", "echo"] }] } }""").Permissions.Commands[0];
        var a = new CommandApprovals(Path.Combine(TestEnv.DataDir, $"approvals-{Guid.NewGuid():N}.json"));
        var real = ExeIdentity.Of(spec)!;
        a.Approve("demo", spec, new ExeIdentity(@"C:\elsewhere\cmd.exe", real.Sha256));
        Assert.Equal("changed", a.Status("demo", spec));
        a.Approve("demo", spec, new ExeIdentity(real.Path, "0000"));
        Assert.Equal("changed", a.Status("demo", spec));
        a.Approve("demo", spec, real);
        Assert.Equal("approved", a.Status("demo", spec));
    }

    [Fact]
    public void Dialog_heading_text_is_cleaned()
    {
        Assert.Equal(new string('a', 40) + "...", ApprovalDialog.Clean(new string('a', 100), 40));
        Assert.Equal("Evil Widget", ApprovalDialog.Clean("Evil\r\n\t Widget\0", 40).Replace("Evil Widget", "Evil Widget"));
        Assert.DoesNotContain('\n', ApprovalDialog.Clean("a\nb", 40));
        Assert.DoesNotContain('\0', ApprovalDialog.Clean("a\0b", 40));
    }

    [Fact]
    public async Task Descendants_die_with_the_job()
    {
        // The command starts a hidden grandchild that would create a file after 5 s; the timeout (2 s) must take it down too.
        var marker = Path.Combine(TestEnv.DataDir, "job-" + Guid.NewGuid().ToString("N"));
        var ps = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        var inner = $"Start-Sleep 5; New-Item -ItemType File -Path ''{marker}''";
        var script = $"Start-Process -FilePath '{ps}' -ArgumentList '-NoProfile','-Command','{inner}' -WindowStyle Hidden; Start-Sleep 60";
        var r = await CommandRunner.RunAsync(ps, new[] { "-NoProfile", "-Command", script }, Path.Combine(TestEnv.DataDir, "job"), TimeSpan.FromSeconds(3));
        Assert.True(r.TimedOut);
        await Task.Delay(8000);
        Assert.False(File.Exists(marker));
    }
}
