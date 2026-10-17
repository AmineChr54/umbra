using System.Text.Json.Nodes;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Umbra;

/// <summary>
/// Backs <c>umbra.media</c>: the current Windows media session (System Media Transport Controls). Reading needs
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

    static async Task<GlobalSystemMediaTransportControlsSession?> CurrentAsync()
    {
        var mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        return mgr.GetCurrentSession();
    }

    /// <summary>The current session as { playing, status, title, artist, album, app, canPlay..., art? }; null when nothing is playing.</summary>
    public static async Task<JsonObject?> NowPlayingAsync()
    {
        var s = await CurrentAsync();
        if (s is null) return null;
        var props = await s.TryGetMediaPropertiesAsync();
        var pb = s.GetPlaybackInfo();
        var c = pb.Controls;
        var o = new JsonObject
        {
            ["status"] = pb.PlaybackStatus.ToString().ToLowerInvariant(),
            ["playing"] = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
            ["title"] = props.Title,
            ["artist"] = props.Artist,
            ["album"] = props.AlbumTitle,
            ["app"] = s.SourceAppUserModelId,
            ["canPlay"] = c.IsPlayEnabled || c.IsPlayPauseToggleEnabled,
            ["canPause"] = c.IsPauseEnabled || c.IsPlayPauseToggleEnabled,
            ["canNext"] = c.IsNextEnabled,
            ["canPrevious"] = c.IsPreviousEnabled,
        };
        try
        {
            if (props.Thumbnail is { } t)
            {
                using var stream = await t.OpenReadAsync();
                if (stream.Size is > 0 and <= MaxArtBytes)
                {
                    var buf = new byte[stream.Size];
                    using var reader = new DataReader(stream);
                    await reader.LoadAsync((uint)stream.Size);
                    reader.ReadBytes(buf);
                    if (SniffImage(buf) is { } mime) o["art"] = $"data:{mime};base64,{Convert.ToBase64String(buf)}";
                }
            }
        }
        catch { /* art is optional */ }
        return o;
    }

    public static async Task<bool> ControlAsync(string command)
    {
        var s = await CurrentAsync();
        if (s is null) return false;
        return command switch
        {
            "play" => await s.TryPlayAsync(),
            "pause" => await s.TryPauseAsync(),
            "toggle" => await s.TryTogglePlayPauseAsync(),
            "next" => await s.TrySkipNextAsync(),
            "previous" => await s.TrySkipPreviousAsync(),
            _ => false,
        };
    }
}
