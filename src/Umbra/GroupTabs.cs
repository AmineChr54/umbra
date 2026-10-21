namespace Umbra;

/// <summary>
/// The host-drawn tab strip of a widget group: one chip per member, shown at the top of the visible widget while the pointer is over it.
/// Like <see cref="EditPill"/> it is its own non-activating window owned by Progman (no WebView), so no widget can draw into it
/// and <c>umbractl capture</c> never includes it.
/// </summary>
sealed class GroupTabs : Form
{
    static readonly Color Back = Color.FromArgb(0x1c, 0x1c, 0x22), Accent = Color.FromArgb(0x8b, 0x93, 0xff);
    static readonly Color Text1 = Color.FromArgb(0xf2, 0xf2, 0xf5), Text2 = Color.FromArgb(0x9a, 0x9a, 0xa6);

    readonly App _app;
    readonly string _groupId;
    readonly List<(Rectangle Rect, string Instance, string Label)> _chips = new();
    string? _active;
    int _hover = -1;

    public string GroupId => _groupId;

    public GroupTabs(App app, string groupId, Rectangle near)
    {
        _app = app;
        _groupId = groupId;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Back;
        DoubleBuffered = true;
        Text = "Umbra - widget tabs";
        Bounds = new Rectangle(near.X + near.Width / 2, near.Y, 1, 1); // on the right monitor, so the handle gets its DPI
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        DesktopPin.RoundCorners(Handle);
        DesktopPin.Apply(Handle);
    }

    /// <summary>WinForms re-parents a window shown with ShowInTaskbar off, which drops the Progman owner.</summary>
    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible) DesktopPin.Apply(Handle);
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Relayout(true);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == DesktopPin.TaskbarCreated) DesktopPin.Apply(Handle);
        switch (m.Msg)
        {
            case Native.WM_WINDOWPOSCHANGING:
                DesktopPin.KeepAtBottom(m.LParam);
                break;
            case Native.WM_MOUSEACTIVATE:
                m.Result = Native.MA_NOACTIVATE; // a click on a tab must not take focus from the user's app
                return;
        }
        base.WndProc(ref m);
    }

    float Dpi => DeviceDpi / 96f;

    Font MakeFont(FontStyle style = FontStyle.Regular) => new("Segoe UI Variable Text", 9f, style, GraphicsUnit.Point);

    Rectangle _target;
    string _signature = "";

    /// <summary>Lays the chips out at the top centre of <paramref name="target"/> (the visible widget, physical pixels); returns true if the window moved or changed.</summary>
    public bool Place(Rectangle target)
    {
        _target = target;
        return Relayout(false);
    }

    bool Relayout(bool force)
    {
        if (!_app.Settings.Groups.TryGetValue(_groupId, out var g)) return false;
        var active = Groups.ActiveOf(g);
        var labels = g.Members.Select(m => (m, _app.Resolve(m) is { } r ? App.InstanceLabel(r.Manifest, m) : m)).ToList();
        var sig = $"{active}|{string.Join(",", labels.Select(l => l.Item2))}|{_target}|{DeviceDpi}";
        if (!force && sig == _signature) return false;
        _signature = sig;
        _active = active;

        float k = Dpi;
        using var font = MakeFont(FontStyle.Bold);
        int pad = (int)(5 * k), h = (int)(30 * k), ch = h - 2 * pad, gap = (int)(4 * k), cp = (int)(12 * k);
        var widths = labels.Select(l => TextRenderer.MeasureText(l.Item2, font).Width + 2 * cp).ToList();
        int maxTotal = Math.Max((int)(80 * k), _target.Width - (int)(16 * k));
        int total = 2 * pad + widths.Sum() + gap * (widths.Count - 1);
        if (total > maxTotal)
        {
            var avail = Math.Max(1, maxTotal - 2 * pad - gap * (widths.Count - 1));
            var each = Math.Max((int)(36 * k), avail / Math.Max(1, widths.Count));
            widths = widths.Select(w => Math.Min(w, each)).ToList();
            total = 2 * pad + widths.Sum() + gap * (widths.Count - 1);
        }
        _chips.Clear();
        int x = pad;
        for (var i = 0; i < labels.Count; i++)
        {
            _chips.Add((new Rectangle(x, pad, widths[i], ch), labels[i].m, labels[i].Item2));
            x += widths[i] + gap;
        }
        var size = new Size(total, h);
        var at = new Point(_target.X + (_target.Width - total) / 2, _target.Y + (int)(8 * k));
        var moved = Size != size || Location != at;
        if (moved) Bounds = new Rectangle(at, size);
        Invalidate();
        return true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var font = MakeFont(FontStyle.Bold);
        var fmt = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        for (var i = 0; i < _chips.Count; i++)
        {
            var (r, inst, label) = _chips[i];
            var on = inst == _active;
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            int d = r.Height;
            path.AddArc(r.X, r.Y, d, d, 90, 180);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 180);
            path.CloseFigure();
            var fill = on ? Accent : i == _hover ? Color.FromArgb(0x34, 0x34, 0x3e) : Color.FromArgb(0x2a, 0x2a, 0x32);
            using var br = new SolidBrush(fill);
            g.FillPath(br, path);
            TextRenderer.DrawText(g, label, font, r, on ? Color.Black : i == _hover ? Text1 : Text2, fmt);
        }
    }

    int HitChip(Point p) => _chips.FindIndex(c => c.Rect.Contains(p));

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var i = HitChip(e.Location);
        if (i == _hover) return;
        _hover = i;
        Cursor = i >= 0 ? Cursors.Hand : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (_hover < 0) return;
        _hover = -1;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        var i = HitChip(e.Location);
        if (i >= 0 && _chips[i].Instance != _active) _app.ActivateTab(_groupId, _chips[i].Instance);
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        _app.StepTab(_groupId, e.Delta < 0 ? 1 : -1);
    }
}
