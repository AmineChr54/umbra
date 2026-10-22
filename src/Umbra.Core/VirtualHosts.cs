namespace Umbra;

/// <summary>
/// The two origins Umbra pages load from. Windows maps them to folders in WebView2 (<c>WebHost</c>); other hosts serve
/// the same URLs their own way, so widget pages and the sandbox rules are identical everywhere.
/// </summary>
static class VirtualHosts
{
    /// <summary>App files: shared/, settings/, built-in widgets/.</summary>
    public const string Host = "umbra.local";
    /// <summary>Installed community widgets (<c>widgets</c> in the data folder).</summary>
    public const string CommunityHost = "community.umbra.local";

    public static string Url(string relative) => $"https://{Host}/{relative.TrimStart('/')}";
    public static string CommunityUrl(string relative) => $"https://{CommunityHost}/{relative.TrimStart('/')}";
}
