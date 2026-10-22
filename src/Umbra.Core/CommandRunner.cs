using System.Diagnostics;
using System.Text;

namespace Umbra;

/// <summary>What a finished (or killed) command produced.</summary>
public sealed record RunResult(int ExitCode, string Stdout, string Stderr, bool TimedOut, bool Truncated, long DurationMs);

/// <summary>
/// Starts one already-approved command: no shell, no window, scrubbed environment, output and time capped.
/// It does no policy checks itself; <see cref="CommandService"/> decides whether a run is allowed.
/// Windows contains the process tree in a job object, Linux in a process group (<see cref="IProcessContainment"/>).
/// </summary>
static class CommandRunner
{
    public const int MaxOutputBytes = 1024 * 1024;

    static readonly string[] ProgramExtensions = { ".exe", ".com" };
    static readonly string[] ScriptExtensions = { ".cmd", ".bat" };

    /// <summary>Only the variables on <see cref="CommandEnvironment"/>'s allow-list reach the child. Tokens, API keys and UMBRA_* are never passed on.</summary>
    public static Dictionary<string, string> ScrubbedEnvironment() =>
        CommandEnvironment.Scrub(WidgetPlatforms.Current, Environment.GetEnvironmentVariable);

    /// <summary>
    /// Finds the program file for a declared executable on Windows: a drive-letter path as given, or a bare name searched on PATH
    /// (absolute PATH entries only, never the current folder). .cmd/.bat are only found when <paramref name="allowScripts"/>.
    /// A POSIX-style path ("/usr/bin/x", which Windows would read relative to the current drive) is never accepted. Other OSes use <see cref="ExecutableResolver"/>.
    /// </summary>
    public static string? ResolveExe(string exe, bool allowScripts, string? pathVariable = null)
    {
        if (exe.StartsWith('/') || exe.StartsWith('\\')) return null;
        var exts = allowScripts ? ProgramExtensions.Concat(ScriptExtensions).ToArray() : ProgramExtensions;
        var given = Path.GetExtension(exe);
        var names = exts.Contains(given, StringComparer.OrdinalIgnoreCase) ? new[] { exe } : exts.Select(e => exe + e).ToArray();
        if (Path.IsPathRooted(exe))
            return names.Select(Path.GetFullPath).FirstOrDefault(File.Exists);
        foreach (var dir in (pathVariable ?? Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var d = dir.Trim().Trim('"');
            if (!Path.IsPathRooted(d)) continue;
            foreach (var n in names)
            {
                try
                {
                    var full = Path.Combine(d, n);
                    if (File.Exists(full)) return full;
                }
                catch (ArgumentException) { }
            }
        }
        return null;
    }

    /// <summary>
    /// Runs <paramref name="exePath"/> with <paramref name="args"/> (each one argv element). After <paramref name="timeout"/>
    /// or when <paramref name="ct"/> fires, the whole process tree is killed. Output beyond <paramref name="maxBytes"/> per stream is dropped.
    /// </summary>
    public static async Task<RunResult> RunAsync(string exePath, IReadOnlyList<string> args, string workingDir,
        TimeSpan timeout, int maxBytes = MaxOutputBytes, CancellationToken ct = default)
    {
        var platform = WidgetPlatforms.Current;
        if (platform == WidgetPlatforms.Other) throw new WidgetCommandException("Widget commands are not supported on this platform");
        Directory.CreateDirectory(workingDir);
        // Fail closed in a Flatpak: exePath was resolved inside the sandbox, so it may name a different file than the host's.
        // CommandLaunch.Plan can build the flatpak-spawn line, but it is not wired in until host programs can be identified.
        if (platform == WidgetPlatforms.Linux && CommandLaunch.IsFlatpak(File.Exists))
            throw new WidgetCommandException("Widget commands are not available in the Flatpak build yet");
        var plan = CommandLaunch.Plan(platform, flatpak: false, SetsidPath(), exePath, args, workingDir, ScrubbedEnvironment());
        var psi = new ProcessStartInfo(plan.FileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = plan.WorkingDirectory,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in plan.Args) psi.ArgumentList.Add(a);
        psi.Environment.Clear();
        foreach (var (k, v) in plan.Environment) psi.Environment[k] = v;

        var sw = Stopwatch.StartNew();
        // The containment makes every descendant die with the run: on timeout, when the run ends, and on Windows also if Umbra itself exits.
        using var containment = CreateContainment();
        return await RunContainedAsync(psi, containment, sw, maxBytes, timeout, ct);
    }

    /// <summary>util-linux <c>setsid</c> at its usual absolute path (never a PATH lookup), else the bare name.</summary>
    static string SetsidPath() =>
        OperatingSystem.IsWindows() ? "setsid" : new[] { "/usr/bin/setsid", "/bin/setsid" }.FirstOrDefault(ExecutableResolver.IsExecutableFile) ?? "setsid";

    static IProcessContainment CreateContainment() =>
        OperatingSystem.IsWindows() ? JobContainment.Create()
        : OperatingSystem.IsLinux() ? new ProcessGroupContainment()
        : throw new WidgetCommandException("Widget commands are not supported on this platform");

    static async Task<RunResult> RunContainedAsync(ProcessStartInfo psi, IProcessContainment containment, Stopwatch sw, int maxBytes, TimeSpan timeout, CancellationToken ct)
    {
        using var proc = Process.Start(psi) ?? throw new WidgetCommandException("The program could not be started");
        containment.Attach(proc);
        try { proc.StandardInput.Close(); } catch (IOException) { }
        var stdout = new OutputCapture(maxBytes);
        var stderr = new OutputCapture(maxBytes);
        var pumps = Task.WhenAll(stdout.PumpAsync(proc.StandardOutput.BaseStream), stderr.PumpAsync(proc.StandardError.BaseStream));

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        var timedOut = false;
        try { await proc.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException)
        {
            timedOut = !ct.IsCancellationRequested;
            await containment.KillAsync(proc);
            try { proc.Kill(entireProcessTree: true); } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            try { await proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); } catch (TimeoutException) { }
        }
        // A grandchild that inherited the pipes could keep them open: don't wait for them forever.
        await Task.WhenAny(pumps, Task.Delay(TimeSpan.FromSeconds(2)));
        sw.Stop();
        var exit = proc.HasExited ? proc.ExitCode : -1;
        return new RunResult(timedOut ? -1 : exit, stdout.Text(), stderr.Text(), timedOut, stdout.Truncated || stderr.Truncated, sw.ElapsedMilliseconds);
    }
}
