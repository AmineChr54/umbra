using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Umbra;

/// <summary>A published Umbra release that can be installed.</summary>
public sealed record ReleaseInfo(string Version, string PageUrl, string AssetName, string AssetUrl, string Notes, string? Digest = null);

/// <summary>
/// Pure update logic: version comparison, GitHub release parsing and download validation.
/// No I/O here so it is unit tested; <see cref="UpdateService"/> does the network and process work.
/// </summary>
public static partial class Updates
{
    public const string ReleasesApi = "https://api.github.com/repos/AmineChr54/umbra/releases/latest";
    const string DownloadPrefix = "/AmineChr54/umbra/releases/download/";

    /// <summary>
    /// What the purple sidebar button shows: "none" (nothing to offer), "downloading" (staging, or the click is waiting for it),
    /// "ready" (installer verified, a click restarts into it) or "available" (a click starts the download; portable copies open the release page).
    /// </summary>
    public static string ButtonState(bool available, bool ready, bool installing, int? progress, bool portable)
    {
        if (!available) return "none";
        if (portable) return "available";
        if (ready) return "ready";
        return installing || progress is not null ? "downloading" : "available";
    }

    [GeneratedRegex(@"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")]
    private static partial Regex SemVer();

    [GeneratedRegex(@"^UmbraSetup-(\d+\.\d+\.\d+)\.exe$")]
    private static partial Regex InstallerName();

    /// <summary>Compares semantic versions (a leading "v" and +build are ignored, a pre-release sorts below its release). Null when either is not a version.</summary>
    public static int? Compare(string a, string b)
    {
        var ma = SemVer().Match(a.Trim());
        var mb = SemVer().Match(b.Trim());
        if (!ma.Success || !mb.Success) return null;
        for (int i = 1; i <= 3; i++)
        {
            var c = long.Parse(ma.Groups[i].Value).CompareTo(long.Parse(mb.Groups[i].Value));
            if (c != 0) return Math.Sign(c);
        }
        var pa = ma.Groups[4].Value;
        var pb = mb.Groups[4].Value;
        if (pa == pb) return 0;
        if (pa.Length == 0) return 1;
        if (pb.Length == 0) return -1;
        var xa = pa.Split('.');
        var xb = pb.Split('.');
        for (int i = 0; i < Math.Min(xa.Length, xb.Length); i++)
        {
            var na = long.TryParse(xa[i], out var la);
            var nb = long.TryParse(xb[i], out var lb);
            int c = na && nb ? la.CompareTo(lb) : na ? -1 : nb ? 1 : string.CompareOrdinal(xa[i], xb[i]);
            if (c != 0) return Math.Sign(c);
        }
        return Math.Sign(xa.Length.CompareTo(xb.Length));
    }

    public static bool IsNewer(string current, string candidate) => Compare(candidate, current) is > 0;

    /// <summary>Notes of one release by tag. Only used with a version that passed <see cref="Compare"/>.</summary>
    public static string ReleaseByTagApi(string version) => $"https://api.github.com/repos/AmineChr54/umbra/releases/tags/v{version}";

    public static string ReleasePageUrl(string version) => $"https://github.com/AmineChr54/umbra/releases/tag/v{version}";

    /// <summary>True when Umbra was updated since it last ran. A first install (nothing recorded) or an unreadable value never announces.</summary>
    public static bool ShouldAnnounce(string? lastSeen, string current) =>
        !string.IsNullOrEmpty(lastSeen) && IsNewer(lastSeen, current);

    /// <summary>The version to record after this start: the running one when first seen or newer, never a downgrade (so going back and forth does not announce twice).</summary>
    public static string NextLastSeen(string? lastSeen, string current)
    {
        if (Compare(current, "0.0.0") is null) return lastSeen ?? "";
        return string.IsNullOrEmpty(lastSeen) || Compare(lastSeen, current) is null || IsNewer(lastSeen, current) ? current : lastSeen;
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>
    /// Reads GitHub's "latest release" JSON. Returns null for drafts, pre-releases, bad versions or a release without
    /// a valid installer asset, so the app never offers something it would refuse to install.
    /// </summary>
    public static ReleaseInfo? ParseRelease(string json)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(json); } catch (JsonException) { return null; }
        if (root is not JsonObject o) return null;
        if (o["draft"] is JsonValue d && d.TryGetValue<bool>(out var isDraft) && isDraft) return null;
        if (o["prerelease"] is JsonValue p && p.TryGetValue<bool>(out var isPre) && isPre) return null;
        var tag = Str(o["tag_name"]);
        var m = tag is null ? null : SemVer().Match(tag);
        if (m is not { Success: true } || m.Groups[4].Success) return null;
        var version = $"{m.Groups[1].Value}.{m.Groups[2].Value}.{m.Groups[3].Value}";

        foreach (var asset in o["assets"] as JsonArray ?? new JsonArray())
        {
            var name = Str(asset?["name"]);
            var url = Str(asset?["browser_download_url"]);
            if (name is null || url is null || !IsValidInstaller(url, name, version)) continue;
            var page = Str(o["html_url"]);
            if (page is null || !page.StartsWith("https://github.com/", StringComparison.Ordinal))
                page = $"https://github.com/AmineChr54/umbra/releases/tag/v{version}";
            var body = Str(o["body"]) ?? "";
            return new ReleaseInfo(version, page, name, url, body.Length > 2000 ? body[..2000] : body, Str(asset?["digest"]));
        }
        return null;
    }

    public const long MaxDownloadBytes = 200L * 1024 * 1024;

    /// <summary>Hosts the download may end up on after GitHub's redirects.</summary>
    public static bool IsAllowedDownloadHost(string host) =>
        host == "github.com" || host == "githubusercontent.com" || host.EndsWith(".githubusercontent.com", StringComparison.Ordinal);

    /// <summary>True when the API's "sha256:&lt;hex&gt;" digest equals the file's hash. A missing or other-algorithm digest never matches.</summary>
    public static bool DigestMatches(string? digest, string sha256Hex) =>
        digest is not null && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) && digest.Length == 71
        && string.Equals(digest[7..], sha256Hex, StringComparison.OrdinalIgnoreCase);

    /// <summary>WinVerifyTrust results Umbra installs: 0 (valid signature) or TRUST_E_NOSIGNATURE (unsigned release; the SHA-256 digest still protects it). Anything else, e.g. a bad or tampered signature, is refused.</summary>
    public static bool SignatureAcceptable(int winVerifyTrustResult) => winVerifyTrustResult is 0 or unchecked((int)0x800B0100);

    /// <summary>Installer switches for a self-update: no window, no message box, no restart prompt, no cancel; /UPDATE=1 tells Umbra.iss to start the app again afterwards.</summary>
    public static string InstallerArguments(string logPath) => UpdaterArgs.InstallerArguments(logPath);

    /// <summary>What a start finds after Umbra handed over to the installer: running the expected version means it worked, anything else means the installer failed.</summary>
    public enum UpdateOutcome { None, Applied, Failed }

    /// <summary>Reads the marker <see cref="UpdateService"/> leaves before it runs the installer and compares it with the running version.</summary>
    public static (UpdateOutcome Outcome, string? To, string? Log) ReadPending(string? json, string currentVersion)
    {
        if (string.IsNullOrWhiteSpace(json)) return (UpdateOutcome.None, null, null);
        JsonNode? root;
        try { root = JsonNode.Parse(json); } catch (JsonException) { return (UpdateOutcome.None, null, null); }
        var to = Str(root?["to"]);
        if (to is null || Compare(to, "0.0.0") is null) return (UpdateOutcome.None, null, null);
        return (Compare(currentVersion, to) is >= 0 ? UpdateOutcome.Applied : UpdateOutcome.Failed, to, Str(root?["log"]));
    }

    /// <summary>The download must be HTTPS from github.com's release downloads for this repo and named UmbraSetup-&lt;version&gt;.exe.</summary>
    public static bool IsValidInstaller(string url, string name, string version)
    {
        var nm = InstallerName().Match(name);
        if (!nm.Success || nm.Groups[1].Value != version) return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps && uri.Host == "github.com" && uri.IsDefaultPort && uri.UserInfo.Length == 0
            && uri.AbsolutePath.StartsWith(DownloadPrefix, StringComparison.Ordinal)
            && !uri.AbsolutePath.Contains("..")
            && Uri.UnescapeDataString(uri.AbsolutePath).EndsWith("/" + name, StringComparison.Ordinal);
    }
}

/// <summary>
/// Checks GitHub for a newer release (at start and every 24 hours), downloads it in the background after those
/// automatic checks, and hands over to the installer on request.
/// </summary>
sealed class UpdateService : IDisposable
{
    static readonly HttpClient Http = CreateClient();
    readonly App _app;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = (int)TimeSpan.FromHours(24).TotalMilliseconds };
    readonly System.Windows.Forms.Timer _first = new() { Interval = 8_000 };
    readonly System.Windows.Forms.Timer _outcome = new() { Interval = 3_000 };
    bool _installing, _started;
    Task<string>? _staging;       // download + verification of the installer for _stagingVersion (resolves to the file path)
    string? _stagingVersion, _stagingDir;

    public ReleaseInfo? Available { get; private set; }
    /// <summary>Set for this session when Umbra was just updated; About shows it. Null otherwise.</summary>
    public ReleaseInfo? WhatsNew { get; private set; }
    public string? WhatsNewVersion { get; private set; }
    public DateTime? LastChecked { get; private set; }
    /// <summary>True from the "Update now" / "Restart to update" click until Umbra quits (or the install fails).</summary>
    public bool Installing => _installing;
    public string? Error { get; private set; }
    /// <summary>Download progress 0-100 while the installer is being fetched, otherwise null.</summary>
    public int? Progress { get; private set; }
    /// <summary>True when the installer for <see cref="Available"/> is downloaded and verified: the next click only restarts Umbra.</summary>
    public bool Ready => Available is not null && _staging is { IsCompletedSuccessfully: true } && _stagingVersion == Available.Version;

    static string PendingFile => Path.Combine(AppPaths.DataDir, "update-pending.json");

    public UpdateService(App app)
    {
        _app = app;
        _timer.Tick += async (_, _) => await CheckAsync(manual: false, download: true);
        _timer.Start();
        // Let the desktop settle before the first request.
        _first.Tick += async (_, _) => { _first.Stop(); await CheckAsync(manual: false, download: true); };
        _first.Start();
        _outcome.Tick += (_, _) => { _outcome.Stop(); ReportPreviousUpdate(); };
        _outcome.Start();
    }

    static HttpClient CreateClient()
    {
        var c = new HttpClient(Prefs.CreateHandler()) { Timeout = TimeSpan.FromMinutes(5) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd($"Umbra/{CurrentVersion}");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return c;
    }

    public static string CurrentVersion => Application.ProductVersion.Split('+')[0];

    /// <summary>
    /// Queries GitHub. An automatic check does nothing when the user turned update checks off. Only the host's own timers
    /// pass <paramref name="download"/>: a control command can check but never makes Umbra fetch or run an installer.
    /// </summary>
    public async Task CheckAsync(bool manual, bool download = false)
    {
        if (!manual && !_app.Settings.General.CheckForUpdates) return;
        try
        {
#if DEBUG
            var url = Environment.GetEnvironmentVariable("UMBRA_RELEASE_URL") ?? Updates.ReleasesApi; // test hook, never in release builds
#else
            var url = Updates.ReleasesApi;
#endif
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var json = await Http.GetStringAsync(url, cts.Token);
            var rel = Updates.ParseRelease(json);
            Available = rel is not null && Updates.IsNewer(CurrentVersion, rel.Version) ? rel : null;
            Error = null;
            if (Available is not null) Log.Write($"Update available: {Available.Version}");
        }
        catch (Exception ex)
        {
            Error = ex.Message;
            Log.Write($"Update check failed: {ex.Message}");
        }
        LastChecked = DateTime.Now;
        if (_app.Settings.General.CheckForUpdates) await _app.CheckWidgetUpdatesAsync(); // the same toggle covers widget updates
        _app.SettingsChangedElsewhere();
        if (download && Available is not null && !AppPaths.IsPortable) await DownloadQuietlyAsync();
    }

    /// <summary>
    /// Marks this session as "just updated to <paramref name="version"/>" and fetches that release's notes (skipped when update
    /// checks are off; About then offers only the link). The notes are plain text for the panel, never HTML.
    /// </summary>
    public async Task LoadWhatsNewAsync(string version)
    {
        try
        {
            WhatsNewVersion = version;
            _app.SettingsChangedElsewhere();
            if (!_app.Settings.General.CheckForUpdates) return;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var json = await Http.GetStringAsync(Updates.ReleaseByTagApi(version), cts.Token);
            var rel = Updates.ParseRelease(json);
            if (rel is not null && rel.Version == version) WhatsNew = rel;
        }
        catch (Exception ex) { Log.Write($"Could not fetch release notes for {version}: {ex.Message}"); }
        _app.SettingsChangedElsewhere();
    }

    /// <summary>Background download after a daily check: a failure is only logged, the next check or "Update now" tries again.</summary>
    async Task DownloadQuietlyAsync()
    {
        try { await StageAsync(); }
        catch (Exception ex) { Log.Write($"Background update download failed: {ex.Message}"); }
        _app.SettingsChangedElsewhere(); // About shows "Restart to update" (or the failure)
    }

    ReleaseInfo CheckInstallable()
    {
        if (AppPaths.IsPortable) throw new InvalidOperationException("Portable copies don't self-update: download the new zip from the release page");
        var rel = Available ?? throw new InvalidOperationException("No update available");
        if (!Updates.IsValidInstaller(rel.AssetUrl, rel.AssetName, rel.Version))
            throw new InvalidOperationException("Update download failed validation");
        if (rel.Digest is null) throw new InvalidOperationException("Release has no SHA-256 digest; refusing to install");
        return rel;
    }

    /// <summary>Downloads and verifies the installer for <see cref="Available"/> once; concurrent callers share the same download. Returns the file path.</summary>
    Task<string> StageAsync()
    {
        var rel = CheckInstallable();
        if (_staging is { IsFaulted: false, IsCanceled: false } t && _stagingVersion == rel.Version) return t;
        DiscardStaged();
        _stagingVersion = rel.Version;
        return _staging = DownloadAsync(rel);
    }

    /// <summary>Drops the staged download. With <paramref name="failedDir"/> (a download that just failed) it only resets the state
    /// when that is still the current download, so a newer download is never wiped by an older one failing.</summary>
    void DiscardStaged(string? failedDir = null)
    {
        if (failedDir is not null && _stagingDir != failedDir)
        {
            try { Directory.Delete(failedDir, true); } catch { /* best effort */ }
            return;
        }
        _staging = null;
        _stagingVersion = null;
        if (_stagingDir is { } d) try { Directory.Delete(d, true); } catch { /* best effort */ }
        _stagingDir = null;
    }

    async Task<string> DownloadAsync(ReleaseInfo rel)
    {
        var dir = _stagingDir = Path.Combine(Path.GetTempPath(), $"umbra-update-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, rel.AssetName);
            Progress = 0;
            _app.SettingsChangedElsewhere();
            using (var resp = await Http.GetAsync(rel.AssetUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                var final = resp.RequestMessage?.RequestUri;
                if (final is null || final.Scheme != Uri.UriSchemeHttps || !Updates.IsAllowedDownloadHost(final.Host))
                    throw new InvalidOperationException("Download was redirected to an unexpected host");
                var length = resp.Content.Headers.ContentLength;
                if (length > Updates.MaxDownloadBytes) throw new InvalidOperationException("Installer is too large");
                await using var src = await resp.Content.ReadAsStreamAsync();
                await using var dst = File.Create(file);
                var buf = new byte[81920];
                long total = 0;
                int n;
                while ((n = await src.ReadAsync(buf)) > 0)
                {
                    total += n;
                    if (total > Updates.MaxDownloadBytes) throw new InvalidOperationException("Installer is too large");
                    await dst.WriteAsync(buf.AsMemory(0, n));
                    if (length is > 0 && (int)Math.Min(100, total * 100 / length.Value) is var pct && pct != Progress)
                    {
                        Progress = pct;
                        _app.SettingsChangedElsewhere();
                    }
                }
            }
            await VerifyAsync(file, rel);
            return file;
        }
        catch
        {
            DiscardStaged(dir);
            throw;
        }
        finally
        {
            Progress = null;
            _app.SettingsChangedElsewhere();
        }
    }

    /// <summary>Size, SHA-256 against GitHub's digest, then Authenticode. Runs after the download and again right before the installer starts.</summary>
    static async Task VerifyAsync(string file, ReleaseInfo rel)
    {
        if (new FileInfo(file).Length < 1_000_000) throw new InvalidOperationException("Downloaded installer looks incomplete");
        string hash;
        await using (var fs = File.OpenRead(file))
            hash = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(fs));
        if (!Updates.DigestMatches(rel.Digest, hash)) throw new InvalidOperationException("Installer checksum does not match GitHub's digest");
        // Valid, or unsigned (the digest above still protects it); anything else is refused.
        if (!Updates.SignatureAcceptable(SignatureStatus(file))) throw new InvalidOperationException("Installer signature is not valid");
    }

    /// <summary>
    /// Runs the downloaded installer invisibly and exits Umbra; the installer starts the new version again. Downloads first
    /// when the background download has not finished. Only the host calls this (tray, About): there is no control command for it.
    /// </summary>
    public async Task InstallAsync()
    {
        var rel = CheckInstallable();
        if (_installing) throw new InvalidOperationException("Update already in progress");
        _installing = true;
        _app.SettingsChangedElsewhere(); // About disables the button right away and keeps it disabled
        try
        {
            var file = await StageAsync();
            try { await VerifyAsync(file, rel); }
            catch { DiscardStaged(); throw; } // changed on disk since the download: never run it
            var log = Path.Combine(Path.GetTempPath(), "UmbraUpdate.log");
            // The next start compares the running version with this to tell "updated" from "installer failed".
            File.WriteAllText(PendingFile, new JsonObject { ["from"] = CurrentVersion, ["to"] = rel.Version, ["log"] = log }.ToJsonString());
            _app.SaveSettings(); // options and widget positions are on disk before Umbra goes away
            Log.Write($"Running {file}");
            try { if (!StartUpdaterWindow(file, rel.Version, log)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file, Updates.InstallerArguments(log)) { UseShellExecute = true }); }
            catch { try { File.Delete(PendingFile); } catch { /* best effort */ } throw; }
            _started = true;
            _app.QuitSoon();
        }
        finally
        {
            // Once the installer has started Umbra is quitting: the button stays disabled until the process is gone.
            if (!_started) { _installing = false; _app.SettingsChangedElsewhere(); }
        }
    }

    /// <summary>
    /// Starts the update window (a temp copy: the installer overwrites the one in the install folder) that runs the installer
    /// and shows its progress. False when it is missing or fails to start, so the caller runs the installer invisibly as before.
    /// </summary>
    static bool StartUpdaterWindow(string installer, string version, string log)
    {
        try
        {
            var source = Path.Combine(AppContext.BaseDirectory, UpdaterArgs.FileName);
            if (!File.Exists(source)) return false;
            var dir = Path.Combine(Path.GetTempPath(), $"umbra-updater-{Guid.NewGuid():N}");
            Directory.CreateDirectory(dir);
            var copy = Path.Combine(dir, UpdaterArgs.FileName);
            File.Copy(source, copy);
            var args = UpdaterArgs.Build(new UpdaterArgs.Request(installer, version, log, Environment.ProcessId, AppContext.BaseDirectory));
            return System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(copy, args) { UseShellExecute = false }) is not null;
        }
        catch (Exception ex)
        {
            Log.Write($"Update window could not start, installing without it: {ex.Message}");
            return false;
        }
    }

    /// <summary>Removes update-window copies an earlier update left in the temp folder (the window cannot delete itself while it runs).</summary>
    static void CleanOldUpdaterCopies()
    {
        try
        {
            foreach (var d in Directory.EnumerateDirectories(Path.GetTempPath(), "umbra-updater-*"))
                try { Directory.Delete(d, true); } catch { /* still running or locked: next start */ }
        }
        catch { /* best effort */ }
    }

    /// <summary>After a start: if Umbra handed over to the installer last time and is still on the old version, say so (the installer starts Umbra again even when it fails).</summary>
    void ReportPreviousUpdate()
    {
        CleanOldUpdaterCopies();
        try
        {
            if (!File.Exists(PendingFile)) return;
            var (outcome, to, log) = Updates.ReadPending(File.ReadAllText(PendingFile), CurrentVersion);
            File.Delete(PendingFile);
            if (outcome == Updates.UpdateOutcome.Applied) Log.Write($"Updated to {CurrentVersion}");
            else if (outcome == Updates.UpdateOutcome.Failed)
            {
                Error = $"The update to v{to} failed, Umbra is still on v{CurrentVersion}";
                Log.Write($"{Error}. Installer log: {log}");
                _app.ShowTrayMessage($"{Error}. Open Settings > About to try again.", ToolTipIcon.Error);
                _app.SettingsChangedElsewhere();
            }
        }
        catch (Exception ex) { Log.Write($"Could not read the update marker: {ex.Message}"); }
    }

    /// <summary>Authenticode check through WinVerifyTrust (hash, chain and revocation).</summary>
    static int SignatureStatus(string file)
    {
        var fileInfo = new WinTrustFileInfo { cbStruct = Marshal.SizeOf<WinTrustFileInfo>(), pcwszFilePath = file };
        var pFile = Marshal.AllocHGlobal(Marshal.SizeOf<WinTrustFileInfo>());
        try
        {
            Marshal.StructureToPtr(fileInfo, pFile, false);
            var data = new WinTrustData
            {
                cbStruct = Marshal.SizeOf<WinTrustData>(), dwUIChoice = 2, fdwRevocationChecks = 0,
                dwUnionChoice = 1, pFile = pFile, dwStateAction = 0, dwProvFlags = 0x10, // cache-only URL retrieval off
            };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            return WinVerifyTrust(new IntPtr(-1), ref action, ref data);
        }
        finally { Marshal.FreeHGlobal(pFile); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WinTrustFileInfo { public int cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }

    [StructLayout(LayoutKind.Sequential)]
    struct WinTrustData
    {
        public int cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData;
        public int dwUIChoice, fdwRevocationChecks, dwUnionChoice; public IntPtr pFile;
        public int dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference;
        public int dwProvFlags, dwUIContext; public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true)]
    static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WinTrustData data);

    public JsonObject ToJson() => new()
    {
        ["enabled"] = _app.Settings.General.CheckForUpdates,
        ["portable"] = AppPaths.IsPortable,
        ["current"] = CurrentVersion,
        ["available"] = Available is null ? null : new JsonObject
        {
            ["version"] = Available.Version, ["url"] = Available.PageUrl, ["asset"] = Available.AssetName, ["notes"] = Available.Notes,
        },
        ["whatsNew"] = WhatsNewVersion is null ? null : new JsonObject
        {
            ["version"] = WhatsNewVersion, ["url"] = WhatsNew?.PageUrl ?? Updates.ReleasePageUrl(WhatsNewVersion), ["notes"] = WhatsNew?.Notes ?? "",
        },
        ["ready"] = Ready,
        ["button"] = Updates.ButtonState(Available is not null, Ready, _installing, Progress, AppPaths.IsPortable),
        ["installing"] = _installing,
        ["progress"] = Progress,
        ["lastChecked"] = LastChecked?.ToString("o"),
        ["error"] = Error,
    };

    public void Dispose()
    {
        _timer.Dispose();
        _first.Dispose();
        _outcome.Dispose();
        if (!_started) DiscardStaged(); // the installer needs its file after Umbra exits
    }
}
