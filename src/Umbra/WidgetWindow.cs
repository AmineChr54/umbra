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
    readonly TaskCompletionSource _readyTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource _renderedTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    DateTime _renderedAt;
    long _pressedAt = long.MinValue / 2;
    IntPtr _foregroundAtPress;

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
                MarkPressed(); // only real clicks on this window send it
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
                _readyTcs.TrySetResult();
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
                if (!_renderedTcs.Task.IsCompleted) _renderedAt = DateTime.UtcNow;
                _renderedTcs.TrySetResult();
                await CaptureIfRequested();
                break;

            case "openUrl":
                var url = msg?["url"]?.GetValue<string>();
                if (url is not null) WebHost.OpenExternal(url);
                break;

            case "fetchJson":
                await HandleFetch(msg!);
                break;

            case "store":
                HandleStore(msg!);
                break;

            case "pointer":
                if (PressedOnThisWindow()) MarkPressed();
                break;

            case "focus":
                if (PressedOnThisWindow()) MarkPressed();
                TakeKeyboardFocus();
                break;
        }
    }

    /// <summary>Remembers a real press on this window, and which window was in front at that moment.</summary>
    void MarkPressed()
    {
        _pressedAt = System.Environment.TickCount64;
        _foregroundAtPress = Native.GetForegroundWindow();
    }

    /// <summary>
    /// Is a mouse button physically down with the cursor over this (visible, uncovered) window?
    /// The page can't fake this, which is what makes the focus gate trustworthy.
    /// </summary>
    bool PressedOnThisWindow()
    {
        if ((Native.GetAsyncKeyState(Native.VK_LBUTTON) & 0x8000) == 0 && (Native.GetAsyncKeyState(Native.VK_RBUTTON) & 0x8000) == 0) return false;
        var p = Cursor.Position;
        var hit = Native.WindowFromPoint(new Native.POINT { X = p.X, Y = p.Y });
        return hit != IntPtr.Zero && Native.GetAncestor(hit, Native.GA_ROOT) == Handle;
    }

    /// <summary>
    /// Widgets never take focus on their own (WS_EX_NOACTIVATE), so text fields can't receive typing.
    /// When the user has just pressed the mouse on this widget, the page may ask for the keyboard;
    /// any other request is ignored, so a widget can't pull focus away while the user types elsewhere.
    /// </summary>
    void TakeKeyboardFocus()
    {
        var fg = Native.GetForegroundWindow();
        // Too long since the press, or the user has moved on to another window since: ignore.
        if (System.Environment.TickCount64 - _pressedAt > 1000 || (fg != _foregroundAtPress && fg != Handle)) return;
        if (fg != Handle)
        {
            // The foreground lock only lets the foreground thread hand over focus, so join its input queue briefly.
            uint me = Native.GetCurrentThreadId();
            uint other = fg == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(fg, out _);
            bool attached = other != 0 && other != me && Native.AttachThreadInput(me, other, true);
            try { Native.SetForegroundWindow(Handle); }
            finally { if (attached) Native.AttachThreadInput(me, other, false); }
        }
        _view.Focus();
    }

    /// <summary>umbra.store: get/set/remove/keys on this widget's own data file, never another widget's.</summary>
    void HandleStore(JsonNode msg)
    {
        var id = msg["id"]?.GetValue<int>() ?? 0;
        var reply = new JsonObject { ["type"] = "storeResult", ["id"] = id };
        try
        {
            var op = msg["op"]?.GetValue<string>();
            var key = msg["key"]?.GetValue<string>() ?? "";
            switch (op)
            {
                case "get":
                    var (found, value) = WidgetStore.Get(Manifest.Id, key);
                    reply["data"] = new JsonObject { ["found"] = found, ["value"] = value };
                    break;
                case "set":
                    WidgetStore.Set(Manifest.Id, key, msg["value"]);
                    break;
                case "remove":
                    WidgetStore.Remove(Manifest.Id, key);
                    break;
                case "keys":
                    reply["data"] = new JsonArray(WidgetStore.Keys(Manifest.Id).Select(k => (JsonNode?)k).ToArray());
                    break;
                default:
                    throw new InvalidOperationException($"Unknown store operation '{op}'");
            }
            reply["ok"] = true;
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            reply["ok"] = false;
            reply["error"] = ex.Message;
            Log.Write($"[{Manifest.Id}] store {msg["op"]} failed: {ex.Message}");
        }
        Post(reply);
    }

    /// <summary>Tells the page that its stored data was changed from outside (umbractl data, MCP).</summary>
    public void StoreChanged(string? key)
    {
        if (_ready) Post(new JsonObject { ["type"] = "storeChanged", ["key"] = key });
    }

    /// <summary>
    /// Dev hook: with UMBRA_CAPTURE_DIR set, each widget saves a pixel-exact PNG of itself
    /// (used for README screenshots and catalog preview.png files). umbractl capture does the same on demand.
    /// </summary>
    async Task CaptureIfRequested()
    {
        var dir = System.Environment.GetEnvironmentVariable("UMBRA_CAPTURE_DIR");
        if (string.IsNullOrEmpty(dir) || _view.CoreWebView2 is null) return;
        var png = await CaptureAsync();
        Directory.CreateDirectory(dir);
        await File.WriteAllBytesAsync(Path.Combine(dir, $"{Manifest.Id}.png"), png);
    }

    /// <summary>
    /// PNG of this widget's web content. Waits for the page to be ready and for its first "rendered"
    /// signal (widgets that never send one get a few seconds), then lets draw-in animations finish.
    /// </summary>
    public async Task<byte[]> CaptureAsync()
    {
        await _readyTcs.Task.WaitAsync(TimeSpan.FromSeconds(20));
        await Task.WhenAny(_renderedTcs.Task, Task.Delay(3000));
        var settle = _renderedTcs.Task.IsCompleted ? TimeSpan.FromMilliseconds(2500) - (DateTime.UtcNow - _renderedAt) : TimeSpan.Zero;
        if (settle > TimeSpan.Zero) await Task.Delay(settle);
        using var ms = new MemoryStream();
        await _view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, ms);
        return ms.ToArray();
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
