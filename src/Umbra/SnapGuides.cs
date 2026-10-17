namespace Umbra;

/// <summary>
/// A transparent, click-through, topmost overlay over the whole desktop that draws the alignment guides of
/// <see cref="Snap"/> while a widget is moved in edit mode. It never takes focus or mouse input and is hidden
/// as soon as the move ends.
/// </summary>
sealed class SnapGuides : Form
{
    static readonly Color Key = Color.Magenta; // drawn as "transparent"; no guide is ever this color
    IReadOnlyList<Snap.Guide> _guides = Array.Empty<Snap.Guide>();
    Color _color = Color.FromArgb(0x8b, 0x93, 0xff);
    int _width = 1;
    Point _origin;

    public SnapGuides()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Key;
        TransparencyKey = Key;
        TopMost = true;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    /// <summary>Shows these guides (physical screen pixels) in the accent color, or hides the overlay when there are none.</summary>
    public void SetGuides(IReadOnlyList<Snap.Guide> guides, string accent, int dpi)
    {
        if (guides.Count == 0)
        {
            if (Visible) Hide();
            _guides = Array.Empty<Snap.Guide>();
            return;
        }
        var color = Prefs.TryColor(accent, out var hex) && hex.Length == 7 ? ColorTranslator.FromHtml(hex) : Color.FromArgb(0x8b, 0x93, 0xff);
        var width = Math.Max(1, (int)Math.Round(dpi / 96.0));
        if (guides.SequenceEqual(_guides) && color == _color && width == _width && Visible) return;
        _guides = guides;
        _color = color == Key ? Color.FromArgb(0x8b, 0x93, 0xff) : color;
        _width = width;

        var vs = SystemInformation.VirtualScreen;
        _origin = vs.Location;
        if (!Visible) Show();
        // SetWindowPos instead of Bounds: the overlay spans monitors of different DPI and must not be rescaled.
        Native.SetWindowPos(Handle, Native.HWND_TOPMOST, vs.X, vs.Y, vs.Width, vs.Height, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(_color, _width);
        foreach (var g in _guides)
        {
            var p = g.Pos - (g.Vertical ? _origin.X : _origin.Y);
            var a = g.Start - (g.Vertical ? _origin.Y : _origin.X);
            var b = g.End - (g.Vertical ? _origin.Y : _origin.X);
            if (g.Vertical) e.Graphics.DrawLine(pen, p, a, p, b);
            else e.Graphics.DrawLine(pen, a, p, b, p);
        }
    }
}
