namespace Umbra;

/// <summary>
/// The host-drawn "Editing widgets · Snap: Shift · Done" pill shown at the top centre of a monitor while edit mode is on.
/// Like a widget it is owned by Progman, never activates and sits just above the widgets and below normal windows.
/// It is its own window (no WebView), so no widget can draw into it and <c>umbractl capture</c> never includes it.
/// </summary>
sealed class EditPill : Form
{
    static readonly Color Back = Color.FromArgb(0x1c, 0x1c, 0x22), Accent = Color.FromArgb(0x8b, 0x93, 0xff);
    static readonly Color Text1 = Color.FromArgb(0xf2, 0xf2, 0xf5), Text2 = Color.FromArgb(0x9a, 0x9a, 0xa6);

    readonly App _app;
    readonly Rectangle _area;

    /// <summary>The work area (physical pixels) of the monitor this pill sits on.</summary>
    public Rectangle Area => _area;
    Rectangle _snapRect, _doneRect;
    bool _overSnap, _overDone;

    public EditPill(App app, Rectangle workArea)
    {
        _app = app;
        _area = workArea;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Back;
        DoubleBuffered = true;
        Text = "Umbra - editing widgets";
        Bounds = new Rectangle(workArea.X + workArea.Width / 2, workArea.Y, 1, 1); // on the right monitor, so the handle gets its DPI
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
        Relayout();
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
        Relayout();
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == DesktopPin.TaskbarCreated) DesktopPin.Apply(Handle);
        switch (m.Msg)
        {
            case Native.WM_WINDOWPOSCHANGING:
                DesktopPin.KeepAtBottom(m.LParam); // below every normal window; the app puts the widgets back under the pill
                break;
            case Native.WM_MOUSEACTIVATE:
                m.Result = Native.MA_NOACTIVATE; // a click on the pill must not take focus from the user's app
                return;
        }
        base.WndProc(ref m);
    }

    string SnapText => Snap.Label(_app.Settings.General);
    string Hint => Snap.Hint(_app.Settings.General);
    const string Title = "Editing widgets", Done = "Done";

    /// <summary>Re-reads the snap state (the label may have changed from the CLI or Settings).</summary>
    public void RefreshState() { if (IsHandleCreated) Relayout(); }

    float Dpi => DeviceDpi / 96f;

    Font MakeFont(float pt, FontStyle style = FontStyle.Regular) => new("Segoe UI Variable Text", pt, style, GraphicsUnit.Point);

    /// <summary>Sizes the pill to its text at this monitor's DPI and centres it at the top of the work area.</summary>
    void Relayout()
    {
        float k = Dpi;
        using var f = MakeFont(9.5f);
        using var fb = MakeFont(9.5f, FontStyle.Bold);
        int pad = (int)(14 * k), gap = (int)(12 * k), h = (int)(36 * k);
        int tw = TextRenderer.MeasureText(Title, fb).Width;
        int sw = TextRenderer.MeasureText(SnapText, fb).Width + (int)(16 * k);
        int hw = TextRenderer.MeasureText(Hint, f).Width;
        int dw = TextRenderer.MeasureText(Done, fb).Width + (int)(28 * k);
        int w = pad + tw + gap + sw + gap + hw + gap + dw + (int)(5 * k);
        int bh = h - (int)(10 * k);
        int x = pad + tw + gap;
        _snapRect = new Rectangle(x, (h - bh) / 2, sw, bh);
        _doneRect = new Rectangle(w - (int)(5 * k) - dw, (h - bh) / 2, dw, bh);
        var size = new Size(w, h);
        var at = new Point(_area.X + (_area.Width - w) / 2, _area.Y + (int)(12 * k));
        var changed = Size != size || Location != at;
        if (changed) Bounds = new Rectangle(at, size);
        Invalidate();
        if (changed) { DesktopPin.SendToBottom(Handle); _app.LowerWidgets(); }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        float k = Dpi;
        using var f = MakeFont(9.5f);
        using var fb = MakeFont(9.5f, FontStyle.Bold);
        int pad = (int)(14 * k), gap = (int)(12 * k);
        var fmt = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine;
        int tw = TextRenderer.MeasureText(Title, fb).Width;
        TextRenderer.DrawText(g, Title, fb, new Rectangle(pad, 0, tw, Height), Text1, fmt);

        Chip(g, _snapRect, SnapText, fb, Text1, _overSnap ? Color.FromArgb(0x34, 0x34, 0x3e) : Color.FromArgb(0x2a, 0x2a, 0x32), k);
        var hintX = _snapRect.Right + gap;
        TextRenderer.DrawText(g, Hint, f, new Rectangle(hintX, 0, _doneRect.Left - hintX, Height), Text2, fmt | TextFormatFlags.EndEllipsis);
        Chip(g, _doneRect, Done, fb, Color.Black, _overDone ? Color.FromArgb(0xa6, 0xac, 0xff) : Accent, k);
    }

    static void Chip(Graphics g, Rectangle r, string text, Font font, Color fore, Color fill, float k)
    {
        using var path = new System.Drawing.Drawing2D.GraphicsPath();
        int d = r.Height;
        path.AddArc(r.X, r.Y, d, d, 90, 180);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 180);
        path.CloseFigure();
        using var br = new SolidBrush(fill);
        g.FillPath(br, path);
        TextRenderer.DrawText(g, text, font, r, fore, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        bool s = _snapRect.Contains(e.Location), d = _doneRect.Contains(e.Location);
        if (s == _overSnap && d == _overDone) return;
        _overSnap = s; _overDone = d;
        Cursor = s || d ? Cursors.Hand : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (!_overSnap && !_overDone) return;
        _overSnap = _overDone = false;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        if (_doneRect.Contains(e.Location)) _app.SetEditMode(false);
        else if (_snapRect.Contains(e.Location)) _app.ToggleSnap();
    }
}
