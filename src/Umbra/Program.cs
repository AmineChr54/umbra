namespace Umbra;

static class Program
{
    /// <summary>
    /// Umbra.exe              start (or, if already running, open Settings in the running instance)
    /// Umbra.exe --background start without opening Settings (used by the Start with Windows entry)
    /// Umbra.exe --safe       start with community widgets off (not saved; the next normal start restores them)
    /// Umbra.exe --restart    started by "Restart Umbra": waits for the old instance to exit, then starts normally
    /// Automation: umbractl / umbractl mcp talk to the running instance over the control pipe (Protocol.cs).
    /// </summary>
    [STAThread]
    static void Main(string[] args)
    {
        var background = args.Contains("--background", StringComparer.OrdinalIgnoreCase);

        var safe = args.Contains("--safe", StringComparer.OrdinalIgnoreCase);

        var restart = args.Contains(Tray.RestartArg, StringComparer.OrdinalIgnoreCase);

        using var instance = new SingleInstance(waitForPrevious: restart);
        if (!instance.IsFirst)
        {
            if (safe)
            {
                // Already running: switch it to safe mode through the control pipe.
                try { Protocol.SendAsync(Protocol.Request("safe-mode", new System.Text.Json.Nodes.JsonObject { ["on"] = true })).GetAwaiter().GetResult(); }
                catch (Exception ex) { Log.Write($"--safe could not reach the running Umbra: {ex.Message}"); }
                return;
            }
            if (!background) SingleInstance.SignalFirst("settings");
            return;
        }

        // Startup delay after sign-in (Settings > Advanced); only for the autostart launch.
        if (background && !restart && Prefs.StartupDelay(Settings.Load().General) is > 0 and var delay) Thread.Sleep(delay * 1000);

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
        var app = new App(openSettings: !background && firstRun, background, safe);
        app.SaveSettings();
        instance.Listen(new Control(app).HandleLineAsync);
        Application.Run(app);
    }
}
