using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Umbra.Updater;

/// <summary>
/// Borderless true-black window: logo, phase text and a thin progress bar. Closes Umbra's process, runs the installer
/// invisibly and follows its log; the installer starts the new Umbra itself (<c>--updated</c>).
/// </summary>
sealed class UpdaterForm : Form
{
    static readonly Color Back = Color.Black, Text1 = Color.FromArgb(245, 245, 247), Text2 = Color.FromArgb(142, 142, 147),
        Track = Color.FromArgb(38, 38, 40), Edge = Color.FromArgb(44, 44, 48), Accent = Color.FromArgb(124, 140, 255), Bad = Color.FromArgb(255, 105, 97);

    readonly UpdaterArgs.Request _req;
    readonly Icon _icon;
    readonly Bitmap _logo;   // the 256 px frame: Graphics.DrawIcon ignores the scale transform, DrawImage does not
    readonly System.Windows.Forms.Timer _tick = new() { Interval = 16 };
    readonly Button _open = new(), _close = new();
    string _title = "Updating Umbra", _sub = "Getting ready…";
    double _target, _shown;   // 0..1; _shown eases toward _target so the bar never jumps
    bool _indeterminate = true, _failed;
    float _sweep;
    float _scale = 1f;   // layout is designed in W x H logical pixels and scaled to the monitor's DPI
    const int W = 440, H = 260;

    public UpdaterForm(UpdaterArgs.Request req)
    {
        _req = req;
        using (var s = typeof(UpdaterForm).Assembly.GetManifestResourceStream("umbra.ico")!) _icon = new Icon(s, 64, 64);
        Icon = _icon;
        using (var s = typeof(UpdaterForm).Assembly.GetManifestResourceStream("umbra.ico")!) { using var big = new Icon(s, 256, 256); _logo = big.ToBitmap(); }
        Text = "Umbra Update";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Back;
        DoubleBuffered = true;
        ShowInTaskbar = true;
        TopMost = true;

        foreach (var b in new[] { _open, _close })
        {
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Track;
            b.BackColor = Color.FromArgb(24, 24, 26);
            b.ForeColor = Text1;
            b.Visible = false;
            Controls.Add(b);
        }
        _open.Text = "Open log";
        _close.Text = "Close";
        LayoutForDpi();
        _open.Click += (_, _) => { try { Process.Start(new ProcessStartInfo(_req.Log) { UseShellExecute = true }); } catch { /* no log yet */ } };
        _close.Click += (_, _) => Close();

        _tick.Tick += (_, _) =>
        {
            _shown += (_target - _shown) * 0.12;
            _sweep = (_sweep + 0.012f) % 1f;
            Invalidate();
        };
        _tick.Start();
        Shown += async (_, _) => await RunAsync();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        LayoutForDpi(); // the monitor's DPI is only known once the window exists
        int round = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        int dark = 1;
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
    }


    protected override void OnDpiChanged(DpiChangedEventArgs e) { base.OnDpiChanged(e); LayoutForDpi(); }

    /// <summary>The one place that sizes the window and buttons: logical W x H times the monitor's scale.</summary>
    void LayoutForDpi()
    {
        _scale = DeviceDpi / 96f;
        // Borderless: Size is the client area. (ClientSize here would add a frame that is no longer there once the handle exists.)
        Size = new Size((int)(W * _scale), (int)(H * _scale));
        foreach (var b in new[] { _open, _close }) b.Size = new Size((int)(104 * _scale), (int)(32 * _scale));
        _open.Location = new Point((int)((W - 28 - 104 * 2 - 8) * _scale), (int)(208 * _scale));
        _close.Location = new Point((int)((W - 28 - 104) * _scale), (int)(208 * _scale));
        Invalidate();
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);

    // Drag the window by any empty part (there is no title bar).
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.ScaleTransform(_scale, _scale);

        using (var edge = new Pen(Edge, 1f / _scale)) g.DrawRectangle(edge, 0, 0, W - 1f / _scale, H - 1f / _scale);
        g.DrawImage(_logo, new RectangleF((W - 72) / 2f, 36, 72, 72));
        using var title = new Font("Segoe UI Variable Display", 20f, FontStyle.Bold, GraphicsUnit.Pixel);
        using var sub = new Font("Segoe UI Variable Text", 13f, GraphicsUnit.Pixel);
        var center = new StringFormat { Alignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter };
        using (var b = new SolidBrush(_failed ? Bad : Text1)) g.DrawString(_title, title, b, new RectangleF(16, 128, W - 32, 30), center);
        using (var b = new SolidBrush(Text2)) g.DrawString(_sub, sub, b, new RectangleF(40, 162, W - 80, _failed ? 44 : 22), center);
        if (_failed) return;

        var bar = new RectangleF(60, 204, W - 120, 6);
        using (var b = new SolidBrush(Track)) g.FillPath(b, Pill(bar));
        g.SetClip(Pill(bar));
        using var fill = new SolidBrush(Accent);
        if (_indeterminate)
        {
            var w = bar.Width * 0.35f;
            var x = bar.X - w + (bar.Width + w) * _sweep;
            g.FillRectangle(fill, x, bar.Y, w, bar.Height);
        }
        else
        {
            var w = bar.Width * (float)_shown;
            g.FillRectangle(fill, bar.X, bar.Y, w, bar.Height);
            if (w > 8) // a soft highlight at the leading edge
            {
                using var glow = new LinearGradientBrush(new RectangleF(bar.X + w - 28, bar.Y, 28, bar.Height), Color.FromArgb(0, 255, 255, 255), Color.FromArgb(110, 255, 255, 255), LinearGradientMode.Horizontal);
                g.FillRectangle(glow, bar.X + w - 28, bar.Y, 28, bar.Height);
            }
        }
    }

    static GraphicsPath Pill(RectangleF r)
    {
        var p = new GraphicsPath();
        float d = r.Height;
        p.AddArc(r.X, r.Y, d, d, 90, 180);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 180);
        p.CloseFigure();
        return p;
    }

    void Set(string title, string sub, double? progress)
    {
        _title = title;
        _sub = sub;
        _indeterminate = progress is null;
        if (progress is { } p) _target = Math.Max(_target, p);
        Invalidate();
    }

    async Task RunAsync()
    {
        try
        {
            Set("Updating Umbra", "Closing Umbra…", null);
            await WaitForUmbraAsync();

            Set($"Updating to v{_req.Version}", "Installing…", null);
            var expected = Directory.Exists(_req.InstallDir) ? Directory.EnumerateFiles(_req.InstallDir, "*", SearchOption.AllDirectories).Count() : 0;
            try { File.Delete(_req.Log); } catch { /* a stale log only skews the estimate */ }
            using var setup = Process.Start(new ProcessStartInfo(_req.Installer, UpdaterArgs.InstallerArguments(_req.Log)) { UseShellExecute = false })
                ?? throw new InvalidOperationException("The installer did not start");
            while (!setup.HasExited)
            {
                await Task.Delay(150);
                if (ReadLog() is { } text) Set($"Updating to v{_req.Version}", "Installing…", UpdaterArgs.InstallProgress(text, expected));
            }
            if (setup.ExitCode != 0) throw new InvalidOperationException($"The installer stopped with code {setup.ExitCode}");

            Set($"Umbra v{_req.Version}", "Starting Umbra…", 1);
            await Task.Delay(1200);
            CleanUp();
            Close();
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    async Task WaitForUmbraAsync()
    {
        try
        {
            using var umbra = Process.GetProcessById(_req.Pid);
            await Task.Run(() => umbra.WaitForExit(15_000));
        }
        catch (ArgumentException) { /* already gone */ }
        catch (InvalidOperationException) { /* already gone */ }
    }

    string? ReadLog()
    {
        try
        {
            using var fs = new FileStream(_req.Log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs);
            return sr.ReadToEnd();
        }
        catch { return null; } // not created yet, or locked for a moment
    }

    /// <summary>Never leave the user without Umbra: show what went wrong and start the version that is still there.</summary>
    void Fail(string message)
    {
        _failed = true;
        _tick.Stop();
        Set("Update didn't finish", $"{message}. Umbra is starting again on its current version.", 0);
        _open.Visible = _close.Visible = true;
        try
        {
            var exe = Path.Combine(_req.InstallDir, "Umbra.exe");
            if (File.Exists(exe)) Process.Start(new ProcessStartInfo(exe, "--updated") { UseShellExecute = false });
        }
        catch { /* nothing more to try */ }
        Invalidate();
    }

    /// <summary>The downloaded installer is no longer needed (Umbra's own temp folder, named umbra-update-*).</summary>
    void CleanUp()
    {
        try
        {
            var dir = Path.GetDirectoryName(_req.Installer);
            if (dir is not null && Path.GetFileName(dir).StartsWith("umbra-update-", StringComparison.Ordinal)) Directory.Delete(dir, true);
        }
        catch { /* best effort */ }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _tick.Dispose(); _icon.Dispose(); _logo.Dispose(); }
        base.Dispose(disposing);
    }
}
