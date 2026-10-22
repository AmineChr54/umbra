using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Backs <c>umbra.media</c>: media session rules shared by every host (Windows reads System Media Transport Controls in <c>WindowsMedia</c>). Reading needs
/// <c>permissions.media</c> to contain "read", transport commands need "control" and a physical click on the widget.
/// </summary>
public static class MediaService
{
    public static readonly string[] Kinds = ["read", "control"];
    public static readonly string[] Commands = ["play", "pause", "toggle", "next", "previous"];
    /// <summary>Album art larger than this is left out (the data URL would be ~4/3 of it).</summary>
    public const int MaxArtBytes = 512 * 1024;

    public static void Validate(IEnumerable<string> kinds)
    {
        foreach (var k in kinds)
            if (!Kinds.Contains(k)) throw new InvalidOperationException($"permissions.media: unknown entry '{k}' (allowed: {string.Join(", ", Kinds)})");
    }

    /// <summary>"image/png" or "image/jpeg" from the leading bytes, else null (anything else is not sent to the page).</summary>
    public static string? SniffImage(ReadOnlySpan<byte> b) =>
        b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 ? "image/png"
        : b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? "image/jpeg" : null;

    public static bool IsCommand(string? c) => c is not null && Commands.Contains(c);
}
