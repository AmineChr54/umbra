using System.Text.RegularExpressions;

namespace Umbra;

/// <summary>
/// The contract between Umbra.exe and Umbra.Updater.exe (shared source, linked into the updater): command line building and
/// parsing, the installer file-name check and the progress estimate. No I/O here so it is unit tested.
/// </summary>
public static partial class UpdaterArgs
{
    public const string FileName = "Umbra.Updater.exe";

    [GeneratedRegex(@"^UmbraSetup-(\d+\.\d+\.\d+)\.exe$")]
    private static partial Regex InstallerName();

    /// <summary>Installer switches for a self-update: no window, no message box, no restart prompt, no cancel; /UPDATE=1 tells Umbra.iss to start the app again afterwards.</summary>
    public static string InstallerArguments(string logPath) => $"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /SP- /UPDATE=1 /LOG=\"{logPath}\"";

    /// <summary>The parsed command line of the updater.</summary>
    public sealed record Request(string Installer, string Version, string Log, int Pid, string InstallDir);

    /// <summary>Command line for <c>Umbra.Updater.exe</c>: every value is quoted, none can be mistaken for a switch.</summary>
    public static string Build(Request r) =>
        $"--installer \"{r.Installer}\" --version {r.Version} --log \"{r.Log}\" --pid {r.Pid} --dir \"{r.InstallDir.TrimEnd('\\')}\"";

    /// <summary>Parses what <see cref="Build"/> wrote. Null when anything is missing or the installer is not <c>UmbraSetup-&lt;version&gt;.exe</c> for that version.</summary>
    public static Request? Parse(string[] args)
    {
        string? Value(string name)
        {
            var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
        var installer = Value("--installer");
        var version = Value("--version");
        var log = Value("--log");
        var dir = Value("--dir");
        if (installer is null || version is null || log is null || dir is null || !int.TryParse(Value("--pid"), out var pid)) return null;
        return IsInstallerFor(installer, version) ? new Request(installer, version, log, pid, dir) : null;
    }

    /// <summary>True when <paramref name="path"/> is a file named exactly <c>UmbraSetup-&lt;version&gt;.exe</c>.</summary>
    public static bool IsInstallerFor(string path, string version)
    {
        var m = InstallerName().Match(Path.GetFileName(path));
        return m.Success && m.Groups[1].Value == version;
    }

    /// <summary>
    /// Progress 0-0.95 of a running installer. A very-silent Inno run reports nothing, but its /LOG file gets one
    /// "-- File entry --" block per file it handles; the number of files of the version being replaced is the expected total.
    /// Null when there is nothing to base an estimate on (the window then shows an indeterminate bar).
    /// </summary>
    public static double? InstallProgress(string logText, int expectedEntries)
    {
        if (expectedEntries <= 0) return null;
        int done = 0, at = 0;
        while ((at = logText.IndexOf("-- File entry --", at, StringComparison.Ordinal)) >= 0) { done++; at += 16; }
        return Math.Min(0.95, (double)done / expectedEntries);
    }
}
