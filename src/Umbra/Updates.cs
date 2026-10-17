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

/// <summary>Checks GitHub for a newer release (at start and every 24 hours) and runs the installer on request.</summary>
sealed class UpdateService : IDisposable
{
    static readonly HttpClient Http = CreateClient();
    readonly App _app;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = (int)TimeSpan.FromHours(24).TotalMilliseconds };
    readonly System.Windows.Forms.Timer _first = new() { Interval = 20_000 };
    bool _installing;

    public ReleaseInfo? Available { get; private set; }
    /// <summary>Set for this session when Umbra was just updated; About shows it. Null otherwise.</summary>
    public ReleaseInfo? WhatsNew { get; private set; }
    public string? WhatsNewVersion { get; private set; }
    public DateTime? LastChecked { get; private set; }
    public string? Error { get; private set; }

    public UpdateService(App app)
    {
        _app = app;
        _timer.Tick += async (_, _) => await CheckAsync(manual: false);
        _timer.Start();
        // Let the desktop settle before the first request.
        _first.Tick += async (_, _) => { _first.Stop(); await CheckAsync(manual: false); };
        _first.Start();
    }

    static HttpClient CreateClient()
    {
        var c = new HttpClient(Prefs.CreateHandler()) { Timeout = TimeSpan.FromMinutes(5) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd($"Umbra/{CurrentVersion}");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return c;
    }

    public static string CurrentVersion => Application.ProductVersion.Split('+')[0];

    /// <summary>Queries GitHub. An automatic check does nothing when the user turned update checks off.</summary>
    public async Task CheckAsync(bool manual)
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
        _app.SettingsChangedElsewhere();
    }

    /// <summary>
    /// Marks this session as "just updated to <paramref name="version"/>" and fetches that release's notes (skipped when update
    /// checks are off; About then offers only the link). The notes are plain text for the panel, never HTML.
    /// </summary>
    public async Task LoadWhatsNewAsync(string version)
    {
        WhatsNewVersion = version;
        _app.SettingsChangedElsewhere();
        if (!_app.Settings.General.CheckForUpdates) return;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var json = await Http.GetStringAsync(Updates.ReleaseByTagApi(version), cts.Token);
            var rel = Updates.ParseRelease(json);
            if (rel is not null && rel.Version == version) WhatsNew = rel;
        }
        catch (Exception ex) { Log.Write($"Could not fetch release notes for {version}: {ex.Message}"); }
        _app.SettingsChangedElsewhere();
    }

    /// <summary>Downloads the installer for <see cref="Available"/> to a temp folder, runs it silently and exits Umbra.</summary>
    public async Task InstallAsync()
    {
        if (AppPaths.IsPortable) throw new InvalidOperationException("Portable copies don't self-update: download the new zip from the release page");
        var rel = Available ?? throw new InvalidOperationException("No update available");
        if (_installing) throw new InvalidOperationException("Update already in progress");
        if (!Updates.IsValidInstaller(rel.AssetUrl, rel.AssetName, rel.Version))
            throw new InvalidOperationException("Update download failed validation");
        if (rel.Digest is null) throw new InvalidOperationException("Release has no SHA-256 digest; refusing to install");
        _installing = true;
        var dir = Path.Combine(Path.GetTempPath(), $"umbra-update-{Guid.NewGuid():N}");
        var started = false;
        try
        {
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, rel.AssetName);
            using (var resp = await Http.GetAsync(rel.AssetUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                var final = resp.RequestMessage?.RequestUri;
                if (final is null || final.Scheme != Uri.UriSchemeHttps || !Updates.IsAllowedDownloadHost(final.Host))
                    throw new InvalidOperationException("Download was redirected to an unexpected host");
                if (resp.Content.Headers.ContentLength > Updates.MaxDownloadBytes) throw new InvalidOperationException("Installer is too large");
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
                }
            }
            if (new FileInfo(file).Length < 1_000_000) throw new InvalidOperationException("Downloaded installer looks incomplete");
            string hash;
            await using (var fs = File.OpenRead(file))
                hash = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(fs));
            if (!Updates.DigestMatches(rel.Digest, hash)) throw new InvalidOperationException("Installer checksum does not match GitHub's digest");
            if (SignatureStatus(file) is not (0 or unchecked((int)0x800B0100))) // valid, or unsigned (the digest above still protects it) throw new InvalidOperationException("Installer signature is not valid");
            Log.Write($"Running {file}");
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file, "/SILENT /NORESTART") { UseShellExecute = true });
            started = true;
            _app.QuitSoon();
        }
        finally
        {
            _installing = false;
            if (!started) try { Directory.Delete(dir, true); } catch { /* best effort */ }
        }
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
        ["lastChecked"] = LastChecked?.ToString("o"),
        ["error"] = Error,
    };

    public void Dispose()
    {
        _timer.Dispose();
        _first.Dispose();
    }
}
