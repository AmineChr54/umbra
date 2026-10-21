namespace Umbra.Updater;

static class Program
{
    /// <summary>Umbra.Updater.exe --installer &lt;UmbraSetup-x.y.z.exe&gt; --version x.y.z --log &lt;file&gt; --pid &lt;Umbra's pid&gt; --dir &lt;install folder&gt;</summary>
    [STAThread]
    static int Main(string[] args)
    {
        var request = UpdaterArgs.Parse(args);
        if (request is null || !File.Exists(request.Installer)) return 2;
        ApplicationConfiguration.Initialize();
        Application.SetColorMode(SystemColorMode.Dark);
        Application.Run(new UpdaterForm(request));
        return 0;
    }
}
