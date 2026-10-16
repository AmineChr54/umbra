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
                "Umbra is not running and Umbra.exe was not found. Install it from https://github.com/AmineChr54/umbra/releases or set UMBRA_EXE.");
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

    static string? FindUmbraExe()
    {
        string?[] candidates =
        {
            Environment.GetEnvironmentVariable("UMBRA_EXE"),
            Path.Combine(AppContext.BaseDirectory, "Umbra.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Umbra", "Umbra.exe"),
        };
        return candidates.FirstOrDefault(p => !string.IsNullOrEmpty(p) && File.Exists(p));
    }

    /// <summary>The community widgets folder (mirrors AppPaths in Umbra.exe, including UMBRA_DATA_DIR).</summary>
    public static string CommunityDir =>
        Path.Combine(Environment.GetEnvironmentVariable("UMBRA_DATA_DIR") is { Length: > 0 } custom
            ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Umbra"), "widgets");
}
