namespace Umbra;

static class Program
{
    /// <summary>
    /// Umbra.exe              start (or, if already running, open Settings in the running instance)
    /// Umbra.exe --background start without opening Settings (used by the Start with Windows entry)
    /// Automation: umbractl / umbractl mcp talk to the running instance over the control pipe (Protocol.cs).
    /// </summary>
    [STAThread]
    static void Main(string[] args)
    {
        var background = args.Contains("--background", StringComparer.OrdinalIgnoreCase);

        using var instance = new SingleInstance();
        if (!instance.IsFirst)
        {
            if (!background) SingleInstance.SignalFirst("settings");
            return;
        }

        // Startup delay after sign-in (Settings > Advanced); only for the autostart launch.
        if (background && Prefs.StartupDelay(Settings.Load().General) is > 0 and var delay) Thread.Sleep(delay * 1000);

        ApplicationConfiguration.Initialize();
        Application.SetColorMode(SystemColorMode.Dark);

        if (!WebHost.RuntimeInstalled())
        {
            MessageBox.Show(
                "Umbra needs the Microsoft Edge WebView2 Runtime.\n\nIt ships with Windows 11; on older systems download it from:\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
                "Umbra", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        Application.ThreadException += (_, e) => Log.Write($"UI exception: {e.Exception}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write($"Fatal: {e.ExceptionObject}");

        // First run (no settings yet) opens Settings so the user sees what Umbra can do.
        var firstRun = !File.Exists(Path.Combine(AppPaths.DataDir, "settings.json"));
        var app = new App(openSettings: !background && firstRun, background);
        app.SaveSettings();
        instance.Listen(new Control(app).HandleLineAsync);
        Application.Run(app);
    }
}
