namespace Umbra;

/// <summary>Pure sizing rules for widget windows (kept free of WinForms state so they can be unit tested).</summary>
public static class WidgetGeometry
{
    /// <summary>Changing a widget by hand needs edit mode and an unlocked widget.</summary>
    public static bool CanArrange(bool editMode, bool locked) => editMode && !locked;

    /// <summary>Window size for a scale: manifest size (logical pixels) x monitor DPI x scale.</summary>
    public static Size ScaledSize(int width, int height, int dpi, double scale) => new(
        (int)Math.Round(width * dpi / 96.0 * scale),
        (int)Math.Round(height * dpi / 96.0 * scale));

    /// <summary>The scale a window width stands for at a DPI.</summary>
    public static double ScaleForWidth(int manifestWidth, int dpi, int windowWidth) => windowWidth / (manifestWidth * dpi / 96.0);

    /// <summary>The size a dragged rectangle snaps to: manifest aspect ratio, the larger stretch wins, clamped to the scale range.</summary>
    public static Size KeepAspect(int width, int height, int dpi, int dragWidth, int dragHeight)
    {
        var one = ScaledSize(width, height, dpi, 1);
        var s = Math.Max(dragWidth / (double)one.Width, dragHeight / (double)one.Height);
        return ScaledSize(width, height, dpi, Math.Clamp(s, WidgetSettings.MinScale, WidgetSettings.MaxScale));
    }
}
