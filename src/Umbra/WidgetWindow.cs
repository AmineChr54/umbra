using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Umbra;

/// <summary>A borderless, desktop-pinned window that hosts one widget's HTML in WebView2.</summary>
sealed class WidgetWindow : Form
{
    readonly App _app;
    readonly WebView2 _view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    bool _ready;

    public WidgetManifest Manifest { get; }

    public WidgetWindow(App app, WidgetManifest manifest)
    {
        _app = app;
        Manifest = manifest;

        Text = $"Umbra - {manifest.Name}";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;
        AutoScaleMode = AutoScaleMode.None;
        Controls.Add(_view);

        ApplyBounds();
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

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case Native.WM_WINDOWPOSCHANGING:
                DesktopPin.KeepAtBottom(m.LParam);
                break;
            case Native.WM_MOUSEACTIVATE:
                m.Result = Native.MA_NOACTIVATE;
                return;
        }
        base.WndProc(ref m);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await WebHost.InitAsync(_view, sandbox: Manifest);
            _view.CoreWebView2.WebMessageReceived += OnMessage;
            _view.CoreWebView2.Navigate(Manifest.PageUrl);
        }
        catch (Exception ex)
        {
            Log.Write($"[{Manifest.Id}] WebView2 init failed: {ex}");
        }
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        ApplyBounds();
    }

    /// <summary>Manifest size is in logical (96-DPI) pixels; scale it to the monitor's DPI.</summary>
    void ApplyBounds()
    {
        var ws = _app.Settings.For(Manifest);
        float scale = DeviceDpi / 96f;
        var size = new Size((int)Math.Round(Manifest.Width * scale), (int)Math.Round(Manifest.Height * scale));

        Point loc;
        if (ws.X is int x && ws.Y is int y) loc = new Point(x, y);
        else
        {
            var wa = Screen.PrimaryScreen!.WorkingArea;
            var d = Manifest.DefaultPosition;
            loc = d is null
                ? new Point(wa.Right - size.Width - (int)(24 * scale), wa.Top + (int)(24 * scale))
                : new Point(wa.Left + (int)(d.X * scale), wa.Top + (int)(d.Y * scale));
        }

        // Keep at least part of the widget on a visible screen (monitors may have changed).
        var rect = new Rectangle(loc, size);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect)))
        {
            var wa = Screen.PrimaryScreen!.WorkingArea;
            rect.Location = new Point(wa.Right - size.Width - 24, wa.Top + 24);
        }
        Bounds = rect;
    }

    public void ResetPosition()
    {
        var ws = _app.Settings.For(Manifest);
        ws.X = ws.Y = null;
        _app.SaveSettings();
        ApplyBounds();
    }

    // ---------- JS bridge ----------

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(e.WebMessageAsJson); } catch { return; }
        var type = msg?["type"]?.GetValue<string>();

        switch (type)
        {
            case "ready":
                _ready = true;
                SendInit();
                break;


            case "drag":
                if (_app.Settings.For(Manifest).Locked) return;
                Native.ReleaseCapture();
                Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, Native.HTCAPTION, IntPtr.Zero);
                // SendMessage returns when the move loop ends: persist the new spot.
                var ws = _app.Settings.For(Manifest);
                ws.X = Left; ws.Y = Top;
                _app.SaveSettings();
                DesktopPin.SendToBottom(Handle);
                break;

            case "rendered":
                await CaptureIfRequested();
                break;

            case "openUrl":
                var url = msg?["url"]?.GetValue<string>();
                if (url is not null) WebHost.OpenExternal(url);
                break;

            case "fetchJson":
                await HandleFetch(msg!);
                break;
        }
    }

    /// <summary>
    /// Dev hook: with UMBRA_CAPTURE_DIR set, each widget saves a pixel-exact PNG of itself
    /// (used for README screenshots and catalog preview.png files).
    /// </summary>
    async Task CaptureIfRequested()
    {
        var dir = System.Environment.GetEnvironmentVariable("UMBRA_CAPTURE_DIR");
        if (string.IsNullOrEmpty(dir) || _view.CoreWebView2 is null) return;
        await Task.Delay(2500); // let draw-in animations finish
        Directory.CreateDirectory(dir);
        await using var fs = File.Create(Path.Combine(dir, $"{Manifest.Id}.png"));
        await _view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
    }

    async Task HandleFetch(JsonNode msg)
    {
        var id = msg["id"]?.GetValue<int>() ?? 0;
        var url = msg["url"]?.GetValue<string>() ?? "";
        var reply = new JsonObject { ["type"] = "fetchResult", ["id"] = id };

        if (!Manifest.AllowsUrl(url))
        {
            reply["ok"] = false;
            reply["error"] = "Host not allowed by widget.json permissions";
            Log.Write($"[{Manifest.Id}] blocked fetch: {url}");
        }
        else
        {
            try
            {
                reply["data"] = await Fetcher.GetJsonAsync(url);
                reply["ok"] = true;
            }
            catch (Exception ex)
            {
                reply["ok"] = false;
                reply["error"] = ex.Message;
            }
        }
        Post(reply);
    }

    void SendInit() => Post(new JsonObject
    {
        ["type"] = "init",
        ["widget"] = new JsonObject { ["id"] = Manifest.Id, ["name"] = Manifest.Name },
        ["settings"] = SettingsPayload(),
    });

    public void PushSettings()
    {
        ApplyBounds();
        if (_ready) Post(new JsonObject { ["type"] = "settings", ["settings"] = SettingsPayload() });
    }

    public void RefreshData()
    {
        if (_ready) Post(new JsonObject { ["type"] = "refresh" });
    }

    JsonObject SettingsPayload()
    {
        var ws = _app.Settings.For(Manifest);
        return new JsonObject
        {
            ["refreshSeconds"] = _app.Settings.General.RefreshSeconds,
            ["animations"] = _app.Settings.General.Animations,
            ["locked"] = ws.Locked,
            ["options"] = ws.Options.DeepClone(),
        };
    }

    void Post(JsonNode node)
    {
        if (IsDisposed || _view.CoreWebView2 is null) return;
        _view.CoreWebView2.PostWebMessageAsJson(node.ToJsonString());
    }

}
