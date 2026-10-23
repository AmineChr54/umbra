using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Umbra;

/// <summary>Where a group's tab strip goes: just above the widget, or inside its top edge when the screen has no room above.</summary>
static class TabStripGeometry
{
    public const int Cell = 30, Pad = 3, Gap = 2, Bar = Cell + 2 * Pad, Space = 3, Inset = 6;

    public static Size SizeFor(int count, float k)
    {
        var n = Math.Max(1, count);
        return new Size((int)Math.Round((n * Cell + (n - 1) * Gap + 2 * Pad) * k), (int)Math.Round(Bar * k));
    }

    /// <summary>Strip bounds for a widget at <paramref name="target"/> (physical pixels); <paramref name="above"/> is false for the inside fallback.</summary>
    public static Rectangle Place(Rectangle target, Rectangle workArea, float k, int count, out bool above)
    {
        var size = SizeFor(count, k);
        size.Width = Math.Min(size.Width, Math.Max(size.Height, target.Width));
        var top = target.Y - size.Height - (int)Math.Round(Space * k);
        above = top >= workArea.Y;
        if (!above) top = target.Y + (int)Math.Round(Inset * k);
        var x = above ? target.X : target.X + (int)Math.Round(Inset * k);
        return new Rectangle(x, top, size.Width, size.Height);
    }
}

/// <summary>
/// The host-drawn tab strip of a widget group: one icon per member, attached above the visible widget so it covers none of its content.
/// Like <see cref="EditPill"/> it is its own non-activating window owned by Progman (no WebView), so no widget can draw into it
/// and <c>umbractl capture</c> never includes it. Colours come from the active theme and accent.
/// </summary>
sealed class GroupTabs : Form
{
    /// <summary>The strip's colours, resolved from the theme tokens (alpha blended over the background) and the accent setting.</summary>
    sealed record Palette(Color Bg, Color Cell, Color Hover, Color Line, Color Text, Color Muted, Color Accent, Color AccentSoft)
    {
        public static Palette For(GeneralSettings g)
        {
            var values = Theme.DiscoverAll().FirstOrDefault(t => t.Id == g.Theme)?.Values ?? new();
            var bg = Token(values, "--bg", "#000000", Color.Black);
            Color T(string name, string fallback) => Token(values, name, fallback, bg);
            var accent = T("--accent", "#8b93ff");
            if (Prefs.IsWindowsAccent(g.Accent) && Prefs.SystemAccent is { } sys && Prefs.TryColor(sys.Accent, out var sh)) accent = Hex(sh, accent);
            else if (Prefs.TryColor(g.Accent, out var ah) && ah.Length > 0) accent = Hex(ah, accent);
            var line = Prefs.TryColor(g.BorderColor, out var bc) && bc.Length > 0 && g.BorderEnabled ? Hex(bc, T("--line-strong", "rgba(255,255,255,0.12)")) : T("--line-strong", "rgba(255,255,255,0.12)");
            return new Palette(bg, T("--surface-2", "#111114"), T("--surface-3", "#17171c"), line, T("--text", "#f4f5f7"), T("--text-2", "#a3a7b1"),
                accent, Blend(accent, bg, 0.16));
        }

        static Color Hex(string h, Color fallback) =>
            Theme.TryRgb(h, out var c) ? Color.FromArgb((int)c.R, (int)c.G, (int)c.B) : fallback;

        static Color Blend(Color a, Color over, double alpha) => Color.FromArgb(
            (int)Math.Round(a.R * alpha + over.R * (1 - alpha)), (int)Math.Round(a.G * alpha + over.G * (1 - alpha)), (int)Math.Round(a.B * alpha + over.B * (1 - alpha)));

        /// <summary>A theme token as an opaque colour: rgba() is blended over <paramref name="over"/>; an unusable value falls back.</summary>
        static Color Token(Dictionary<string, string> values, string name, string fallback, Color over)
        {
            var v = values.GetValueOrDefault(name, fallback);
            if (!Theme.TryRgb(v, out var c)) Theme.TryRgb(fallback, out c);
            var alpha = 1.0;
            var m = Regex.Match(v, @"^rgba?\(\s*[^,\s/]+[\s,]+[^,\s/]+[\s,]+[^,\s/]+[\s,/]+([\d.]+)(%?)\s*\)$");
            if (m.Success && double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var a))
                alpha = Math.Clamp(m.Groups[2].Value == "%" ? a / 100 : a, 0, 1);
            var fg = Color.FromArgb((int)c.R, (int)c.G, (int)c.B);
            return alpha >= 1 ? fg : Blend(fg, over, alpha);
        }
    }

    readonly App _app;
    readonly string _groupId;
    readonly List<(Rectangle Rect, string Instance, string Label)> _chips = new();
    readonly Dictionary<string, Bitmap?> _icons = new();
    readonly ToolTip _tip = new() { InitialDelay = 250, ReshowDelay = 100, AutoPopDelay = 4000 };
    Palette _pal;
    string _palKey = "";
    string? _active;
    int _hover = -1;

    public string GroupId => _groupId;

    public GroupTabs(App app, string groupId, Rectangle near)
    {
        _app = app;
        _groupId = groupId;
        _pal = Palette.For(app.Settings.General);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = _pal.Bg;
        DoubleBuffered = true;
        Text = "Umbra - widget tabs";
        Bounds = new Rectangle(near.X, near.Y, 1, 1); // on the right monitor, so the handle gets its DPI
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

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tip.Dispose();
            foreach (var b in _icons.Values) b?.Dispose();
        }
        base.Dispose(disposing);
    }

    float Dpi => DeviceDpi / 96f;

    Rectangle _target;
    string _signature = "";

    /// <summary>Repaints the chips (a tab icon changed).</summary>
    public void Redraw() => Invalidate();

    /// <summary>Puts the strip on the visible widget at <paramref name="target"/> (physical pixels); returns true if anything moved or changed.</summary>
    public bool Place(Rectangle target)
    {
        _target = target;
        return Relayout(false);
    }

    bool Relayout(bool force)
    {
        if (!_app.Settings.Groups.TryGetValue(_groupId, out var g)) return false;
        var general = _app.Settings.General;
        var key = $"{general.Theme}|{general.Accent}|{general.BorderColor}|{general.BorderEnabled}";
        if (key != _palKey) { _palKey = key; _pal = Palette.For(general); BackColor = _pal.Bg; force = true; }

        var active = Groups.ActiveOf(g);
        var sig = $"{active}|{string.Join(",", g.Members)}|{_target}|{DeviceDpi}";
        if (!force && sig == _signature) return false;
        _signature = sig;
        _active = active;

        float k = Dpi;
        var screens = Placement.Monitors();
        var work = Placement.Find(screens, _target) is MonitorInfo mi ? mi.WorkArea : _target;
        var bounds = TabStripGeometry.Place(_target, work, k, g.Members.Count, out _);
        _chips.Clear();
        int pad = (int)Math.Round(TabStripGeometry.Pad * k), cell = (int)Math.Round(TabStripGeometry.Cell * k), gap = (int)Math.Round(TabStripGeometry.Gap * k);
        int x = pad;
        foreach (var m in g.Members)
        {
            if (x + cell > bounds.Width) break; // a widget narrower than its tabs: the rest stay reachable through the menu
            _chips.Add((new Rectangle(x, pad, cell, cell), m, _app.Resolve(m) is { } r ? App.InstanceLabel(r.Manifest, m) : m));
            x += cell + gap;
        }
        if (Bounds != bounds) Bounds = bounds;
        Invalidate();
        return true;
    }

    /// <summary>The widget's icon as a bitmap (up to 128 px, 64 KB), or null for a letter badge.</summary>
    Bitmap? IconFor(string instance)
    {
        _app.Settings.Widgets.TryGetValue(instance, out var ws);
        // The user's own pick wins; the widget's suggestion (umbra.setTabIcon) only fills in when there is none.
        var chosen = Groups.ChooseIcon(ws?.TabIcon, ws?.SuggestedTabIcon);
        var cacheKey = instance + "|" + chosen;
        if (_icons.TryGetValue(cacheKey, out var cached)) return cached;
        Bitmap? bmp = null;
        try
        {
            if (Groups.IconPath(chosen) is { } own)
            {
                using var src = Image.FromFile(own);
                bmp = new Bitmap(src);
            }
            else if (_app.Resolve(instance) is { } r && r.Manifest.Icon is { } file)
            {
                var root = r.Manifest.Source == WidgetSource.BuiltIn ? AppPaths.WidgetsDir : AppPaths.CommunityDir;
                var path = Path.Combine(root, r.Manifest.Folder, file);
                var info = new FileInfo(path);
                if (info.Exists && info.Length <= 64 * 1024)
                {
                    using var src = Image.FromFile(path);
                    if (src.Width <= 128 && src.Height <= 128) bmp = new Bitmap(src);
                }
            }
        }
        catch (Exception ex) { Log.Write($"Tab icon for {instance} unusable: {ex.Message}"); }
        return _icons[cacheKey] = bmp;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        float k = Dpi;
        int radius = (int)Math.Round(8 * k);
        using var font = new Font("Segoe UI Variable Text", 10.5f, FontStyle.Bold, GraphicsUnit.Point);
        for (var i = 0; i < _chips.Count; i++)
        {
            var (r, inst, _) = _chips[i];
            var on = inst == _active;
            using (var path = RoundRect(r, radius))
            {
                using var fill = new SolidBrush(on ? _pal.AccentSoft : i == _hover ? _pal.Hover : _pal.Cell);
                g.FillPath(fill, path);
                if (on) { using var pen = new Pen(_pal.Accent, Math.Max(1f, k)); g.DrawPath(pen, path); }
            }
            var size = (int)Math.Round(18 * k);
            var box = new Rectangle(r.X + (r.Width - size) / 2, r.Y + (r.Height - size) / 2, size, size);
            var alpha = on ? 1f : i == _hover ? 0.9f : 0.6f;
            if (IconFor(inst) is { } icon)
            {
                using var attrs = new ImageAttributes();
                // Icons are light grey on transparent; the active one is tinted with the accent, the others dimmed.
                var tint = on ? _pal.Accent : _pal.Text;
                var blend = on ? 1f : 0f;
                var cm = new ColorMatrix(new[]
                {
                    new[] { 1 - blend, 0, 0, 0, 0 }, new[] { 0, 1 - blend, 0, 0, 0 }, new[] { 0, 0, 1 - blend, 0, 0 }, new[] { 0, 0, 0, alpha, 0 },
                    new[] { blend * tint.R / 255f, blend * tint.G / 255f, blend * tint.B / 255f, 0, 1 },
                });
                attrs.SetColorMatrix(cm);
                g.DrawImage(icon, box, 0, 0, icon.Width, icon.Height, GraphicsUnit.Pixel, attrs);
            }
            else
            {
                var letter = (_chips[i].Label.TrimStart().FirstOrDefault(char.IsLetterOrDigit) is var ch && ch != 0 ? char.ToUpperInvariant(ch) : '?').ToString();
                var color = on ? _pal.Accent : i == _hover ? _pal.Text : _pal.Muted;
                TextRenderer.DrawText(g, letter, font, r, color, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
            }
        }
        using var border = new Pen(_pal.Line, Math.Max(1f, k));
        g.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
    }

    static GraphicsPath RoundRect(Rectangle r, int radius)
    {
        var d = Math.Max(1, radius * 2);
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    int HitChip(Point p) => _chips.FindIndex(c => c.Rect.Contains(p));

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var i = HitChip(e.Location);
        if (i == _hover) return;
        _hover = i;
        Cursor = i >= 0 ? Cursors.Hand : Cursors.Default;
        if (i >= 0) _tip.Show(_chips[i].Label, this, _chips[i].Rect.X, _chips[i].Rect.Bottom + (int)(6 * Dpi), 4000);
        else _tip.Hide(this);
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _tip.Hide(this);
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
