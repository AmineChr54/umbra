using System.Text.Json.Nodes;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Umbra;

/// <summary><c>umbra.media</c> on Windows: the current System Media Transport Controls session (rules in <see cref="MediaService"/>).</summary>
static class WindowsMedia
{
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
                if (stream.Size is > 0 and <= MediaService.MaxArtBytes)
                {
                    var buf = new byte[stream.Size];
                    using var reader = new DataReader(stream);
                    await reader.LoadAsync((uint)stream.Size);
                    reader.ReadBytes(buf);
                    if (MediaService.SniffImage(buf) is { } mime) o["art"] = $"data:{mime};base64,{Convert.ToBase64String(buf)}";
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
