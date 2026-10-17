using Windows.UI.ViewManagement;

namespace Umbra;

/// <summary>
/// The Windows accent color (Settings > Personalization > Colors), read through <see cref="UISettings"/>.
/// The callback fires on a thread-pool thread whenever Windows reports new colors (accent or light/dark switch).
/// </summary>
sealed class WindowsAccent : IDisposable
{
    readonly UISettings? _ui;
    readonly Action _changed;

    public WindowsAccent(Action changed)
    {
        _changed = changed;
        try
        {
            _ui = new UISettings();
            _ui.ColorValuesChanged += OnChanged;
        }
        catch (Exception ex)
        {
            Log.Write($"Windows accent color unavailable: {ex.Message}");
        }
    }

    void OnChanged(UISettings sender, object args) => _changed();

    /// <summary>The current accent as readable-on-black colors, or null when Windows can't tell us.</summary>
    public Prefs.AccentPair? Read()
    {
        if (_ui is null) return null;
        try
        {
            var a = _ui.GetColorValue(UIColorType.Accent);
            var l = _ui.GetColorValue(UIColorType.AccentLight2);
            return Prefs.FromWindows((a.R, a.G, a.B), (l.R, l.G, l.B));
        }
        catch (Exception ex)
        {
            Log.Write($"Could not read the Windows accent color: {ex.Message}");
            return null;
        }
    }

    public void Dispose()
    {
        if (_ui is not null) _ui.ColorValuesChanged -= OnChanged;
    }
}
