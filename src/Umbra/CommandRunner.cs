using System.Diagnostics;
using System.Text;

namespace Umbra;

/// <summary>What a finished (or killed) command produced.</summary>
public sealed record RunResult(int ExitCode, string Stdout, string Stderr, bool TimedOut, bool Truncated, long DurationMs);

/// <summary>
/// Starts one already-approved command: no shell, no window, scrubbed environment, output and time capped.
/// It does no policy checks itself; <see cref="CommandService"/> decides whether a run is allowed.
/// </summary>
static class CommandRunner
{
    public const int MaxOutputBytes = 1024 * 1024;

    static readonly string[] ProgramExtensions = { ".exe", ".com" };
    static readonly string[] ScriptExtensions = { ".cmd", ".bat" };

    /// <summary>Only these variables reach the child. Tokens, API keys and UMBRA_* are never passed on.</summary>
    static readonly string[] EnvAllowList =
    {
        "SystemRoot", "windir", "SystemDrive", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
        "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
        "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE", "OS", "COMPUTERNAME", "PSModulePath",
    };

    public static Dictionary<string, string> ScrubbedEnvironment()
    {
        var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in EnvAllowList)
            if (Environment.GetEnvironmentVariable(name) is { Length: > 0 } v) env[name] = v;
        env["NO_COLOR"] = "1";
        return env;
    }

    /// <summary>
    /// Finds the program file for a declared executable: an absolute path as given, or a bare name searched on PATH
    /// (absolute PATH entries only, never the current folder). .cmd/.bat are only found when <paramref name="allowScripts"/>.
    /// </summary>
    public static string? ResolveExe(string exe, bool allowScripts, string? pathVariable = null)
    {
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

    /// <summary>Capped, drained copy of a child's output stream.</summary>
    sealed class Capture(int max)
    {
        readonly MemoryStream _buf = new();
        readonly object _gate = new();
        public bool Truncated { get; private set; }

        public async Task PumpAsync(Stream s)
        {
            var chunk = new byte[8192];
            int n;
            try
            {
                while ((n = await s.ReadAsync(chunk)) > 0)
                    lock (_gate)
                    {
                        var room = max - (int)_buf.Length;
                        if (room > 0) _buf.Write(chunk, 0, Math.Min(room, n));
                        if (n > room) Truncated = true; // keep reading so the child never blocks on a full pipe
                    }
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
        }

        public string Text()
        {
            lock (_gate) return Encoding.UTF8.GetString(_buf.GetBuffer(), 0, (int)_buf.Length);
        }
    }

    /// <summary>
    /// Runs <paramref name="exePath"/> with <paramref name="args"/> (each one argv element). After <paramref name="timeout"/>
    /// or when <paramref name="ct"/> fires, the whole process tree is killed. Output beyond <paramref name="maxBytes"/> per stream is dropped.
    /// </summary>
    public static async Task<RunResult> RunAsync(string exePath, IReadOnlyList<string> args, string workingDir,
        TimeSpan timeout, int maxBytes = MaxOutputBytes, CancellationToken ct = default)
    {
        Directory.CreateDirectory(workingDir);
        var psi = new ProcessStartInfo(exePath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = workingDir,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.Environment.Clear();
        foreach (var (k, v) in ScrubbedEnvironment()) psi.Environment[k] = v;

        var sw = Stopwatch.StartNew();
        using var proc = Process.Start(psi) ?? throw new WidgetCommandException("The program could not be started");
        try { proc.StandardInput.Close(); } catch (IOException) { }
        var stdout = new Capture(maxBytes);
        var stderr = new Capture(maxBytes);
        var pumps = Task.WhenAll(stdout.PumpAsync(proc.StandardOutput.BaseStream), stderr.PumpAsync(proc.StandardError.BaseStream));

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        var timedOut = false;
        try { await proc.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException)
        {
            timedOut = !ct.IsCancellationRequested;
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
