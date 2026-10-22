using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Umbra.Cli;

/// <summary>Sends control commands to the running Umbra, starting it in the background if needed.</summary>
static class UmbraClient
{
    public static async Task<JsonObject> SendAsync(string cmd, JsonObject? args = null, bool autoStart = true)
    {
        var request = Protocol.Request(cmd, args);
        try
        {
            return await Protocol.SendAsync(request);
        }
        catch (TimeoutException) when (autoStart && cmd != "quit")
        {
            var exe = FindUmbraExe() ?? throw new InvalidOperationException(
                $"Umbra is not running and {AppFileName} was not found. Install it from https://github.com/AmineChr54/umbra/releases or set UMBRA_EXE.");
            Process.Start(new ProcessStartInfo(exe, "--background") { UseShellExecute = false });
            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (true)
            {
                await Task.Delay(500);
                try { return await Protocol.SendAsync(request, connectTimeoutMs: 1000); }
                catch (TimeoutException) when (DateTime.UtcNow < deadline) { }
            }
        }
    }

    /// <summary>The app's file name: Umbra.exe on Windows, umbra on Linux.</summary>
    static string AppFileName => OperatingSystem.IsWindows() ? "Umbra.exe" : "umbra";

    static string? FindUmbraExe()
    {
        // Next to umbractl first; then the per-user install folder (Windows installer, or the Linux tarball's install.sh).
        var installed = OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Umbra", AppFileName)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "lib", "umbra", AppFileName);
        string?[] candidates =
        {
            Environment.GetEnvironmentVariable("UMBRA_EXE"),
            Path.Combine(AppContext.BaseDirectory, AppFileName),
            installed,
        };
        return candidates.FirstOrDefault(p => !string.IsNullOrEmpty(p) && File.Exists(p));
    }

    /// <summary>The community widgets folder (mirrors AppPaths in Umbra.exe, including UMBRA_DATA_DIR).</summary>
    public static string CommunityDir =>
        Path.Combine(PortableMode.DataDir(AppContext.BaseDirectory), "widgets");
}
