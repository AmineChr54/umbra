namespace Umbra;

/// <summary>Tiny append-only log in %APPDATA%\Umbra\umbra.log (trimmed to its newest half past 256 KB).</summary>
static class Log
{
    static readonly object Gate = new();
    internal const int MaxBytes = 256 * 1024;

    /// <summary>When the file exceeds <paramref name="maxBytes"/>, keeps only the newest ~half, starting at a line boundary.</summary>
    internal static void TrimIfLarge(string path, int maxBytes)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length <= maxBytes) return;
        var keep = maxBytes / 2;
        byte[] tail;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            fs.Seek(-keep, SeekOrigin.End);
            tail = new byte[keep];
            fs.ReadExactly(tail);
        }
        var start = Array.IndexOf(tail, (byte)'\n') + 1; // drop the partial first line
        File.WriteAllBytes(path, tail[start..]);
    }

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                var path = Path.Combine(AppPaths.DataDir, "umbra.log");
                TrimIfLarge(path, MaxBytes);
                File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
        }
        catch { /* logging must never crash the app */ }
    }

    public static string[] Tail(int lines)
    {
        lock (Gate)
        {
            var path = Path.Combine(AppPaths.DataDir, "umbra.log");
            return File.Exists(path) ? File.ReadLines(path).TakeLast(Math.Clamp(lines, 1, 2000)).ToArray() : Array.Empty<string>();
        }
    }
}

static class AppPaths
{
    public static string AppDir => AppContext.BaseDirectory;
    public static string WidgetsDir => Path.Combine(AppDir, "widgets");
    public static string ExePath => Environment.ProcessPath ?? Path.Combine(AppDir, "Umbra.exe");

    /// <summary>Community widgets installed from the catalog: %APPDATA%\Umbra\widgets\&lt;id&gt;.</summary>
    public static string CommunityDir
    {
        get
        {
            var d = Path.Combine(DataDir, "widgets");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    /// <summary>%APPDATA%\Umbra, or UMBRA_DATA_DIR when set (tests and throwaway dev profiles).</summary>
    public static string DataDir
    {
        get
        {
            var d = Environment.GetEnvironmentVariable("UMBRA_DATA_DIR") is { Length: > 0 } custom
                ? custom
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Umbra");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    /// <summary>WebView2 user data (cache, cookies) lives under LocalAppData, not next to the exe.</summary>
    public static string WebViewDataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Umbra", "WebView2");
}
