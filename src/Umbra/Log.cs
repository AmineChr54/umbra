namespace Umbra;

/// <summary>Tiny append-only log in %APPDATA%\Umbra\umbra.log (trimmed at 256 KB).</summary>
static class Log
{
    static readonly object Gate = new();

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                var path = Path.Combine(AppPaths.DataDir, "umbra.log");
                if (File.Exists(path) && new FileInfo(path).Length > 256 * 1024) File.Delete(path);
                File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
        }
        catch { /* logging must never crash the app */ }
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

    public static string DataDir
    {
        get
        {
            var d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Umbra");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    /// <summary>WebView2 user data (cache, cookies) lives under LocalAppData, not next to the exe.</summary>
    public static string WebViewDataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Umbra", "WebView2");
}
