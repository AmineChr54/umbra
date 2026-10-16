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
    bool _resizing;

    public WidgetManifest Manifest { get; }

    WidgetSettings Ws => _app.Settings.For(Manifest);

    /// <summary>Changing the widget by hand (corner handle, Ctrl+wheel) needs edit mode and an unlocked widget.</summary>
    bool CanArrange => _app.EditMode && !Ws.Locked;

    /// <summary>The window size for a scale: manifest size (logical pixels) x monitor DPI x scale.</summary>
    Size ScaledSize(double scale) => new(
        (int)Math.Round(Manifest.Width * DeviceDpi / 96.0 * scale),
        (int)Math.Round(Manifest.Height * DeviceDpi / 96.0 * scale));

    /// <summary>The scale a window width stands for at the current DPI.</summary>
    double ScaleForWidth(int width) => width / (Manifest.Width * DeviceDpi / 96.0);

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
            case Native.WM_GETMINMAXINFO:
                base.WndProc(ref m);
                LimitTrackSize(m.LParam);
                return;
            case Native.WM_SIZING when _resizing:
                KeepAspect(m.LParam);
                m.Result = 1;
                return;
        }
        base.WndProc(ref m);
    }

    /// <summary>The resize loop may only produce sizes between 50 % and 300 % of the manifest size.</summary>
    unsafe void LimitTrackSize(IntPtr lParam)
    {
        var mmi = (Native.MINMAXINFO*)lParam;
        Size min = ScaledSize(WidgetSettings.MinScale), max = ScaledSize(WidgetSettings.MaxScale);
        mmi->MinTrackSize = new Native.POINT { X = min.Width, Y = min.Height };
        mmi->MaxTrackSize = new Native.POINT { X = max.Width + 1, Y = max.Height + 1 };
    }

    /// <summary>
    /// WM_SIZING from the corner handle: the widget zooms rather than reflows, so keep the manifest's aspect ratio.
    /// The top-left corner stays put; the larger of the two stretches wins.
    /// </summary>
    unsafe void KeepAspect(IntPtr lParam)
    {
        var r = (Native.RECT*)lParam;
        var one = ScaledSize(1);
        var s = Math.Max((r->Right - r->Left) / (double)one.Width, (r->Bottom - r->Top) / (double)one.Height);
        var size = ScaledSize(Math.Clamp(s, WidgetSettings.MinScale, WidgetSettings.MaxScale));
        r->Right = r->Left + size.Width;
        r->Bottom = r->Top + size.Height;
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        // While the corner handle is dragged, zoom the page along with the window.
        if (_resizing) ApplyZoom(ScaleForWidth(Width));
    }

    void ApplyZoom(double zoom)
    {
        if (Math.Abs(_view.ZoomFactor - zoom) > 0.0001) _view.ZoomFactor = zoom;
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
        // Keep the spot Windows picked (the window may be mid-drag onto another monitor); only the size follows the new DPI.
        ApplyBounds(e.SuggestedRectangle.Location);
    }

    /// <summary>
    /// Manifest size is in logical (96-DPI) pixels: scale it to the monitor's DPI and the user's scale, and zoom
    /// the page by the same scale, so the content is laid out at the manifest size and rendered sharply.
    /// </summary>
    void ApplyBounds(Point? at = null)
    {
        var ws = Ws;
        float dpi = DeviceDpi / 96f;
        var size = ScaledSize(ws.Scale);

        Point loc;
        if (at is Point p) loc = p;
        else if (ws.X is int x && ws.Y is int y) loc = new Point(x, y);
        else
        {
            var wa = Screen.PrimaryScreen!.WorkingArea;
            var d = Manifest.DefaultPosition;
            loc = d is null
                ? new Point(wa.Right - size.Width - (int)(24 * dpi), wa.Top + (int)(24 * dpi))
                : new Point(wa.Left + (int)(d.X * dpi), wa.Top + (int)(d.Y * dpi));
        }

        // Keep at least part of the widget on a visible screen (monitors may have changed).
        var rect = new Rectangle(loc, size);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect)))
        {
            var wa = Screen.PrimaryScreen!.WorkingArea;
            rect.Location = new Point(wa.Right - size.Width - 24, wa.Top + 24);
        }
        Bounds = rect;
        ApplyZoom(ws.Scale);
    }

    public void ResetPosition()
    {
        var ws = Ws;
        ws.X = ws.Y = null;
        _app.SaveSettings();
        ApplyBounds();
    }

    /// <summary>Zooms the widget by hand (corner handle, Ctrl+wheel): the top-left corner stays where it is.</summary>
    void SetScaleByHand(double scale)
    {
        var ws = Ws;
        ws.Scale = scale;
        ws.X = Left; ws.Y = Top;
        _app.SaveSettings();
        PushSettings();
        _app.SettingsChangedElsewhere();
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
                if (Ws.Locked) return;
                Native.ReleaseCapture();
                Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, Native.HTCAPTION, IntPtr.Zero);
                // SendMessage returns when the move loop ends: persist the new spot.
                var ws = Ws;
                ws.X = Left; ws.Y = Top;
                _app.SaveSettings();
                DesktopPin.SendToBottom(Handle);
                break;

            case "resize":
                // The edit-mode corner handle. Only a real press on this window starts the native size loop.
                if (!CanArrange || !PressedOnThisWindow()) return;
                _resizing = true;
                try
                {
                    Native.ReleaseCapture();
                    Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, Native.HTBOTTOMRIGHT, IntPtr.Zero);
                }
                finally { _resizing = false; }
                SetScaleByHand(ScaleForWidth(Width));
                DesktopPin.SendToBottom(Handle);
                break;

            case "zoom":
                // Ctrl+wheel in edit mode: one step is 10 %. The page can't fake it: Ctrl must be down over this window.
                if (!CanArrange || !CtrlWheelOverThisWindow()) return;
                if (msg?["steps"] is not JsonNode stepsNode || stepsNode.GetValueKind() != JsonValueKind.Number) return;
                var steps = Math.Clamp(stepsNode.GetValue<double>(), -3, 3);
                if (steps != 0) SetScaleByHand(Ws.Scale + 0.1 * steps);
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
    bool PressedOnThisWindow() =>
        (IsKeyDown(Native.VK_LBUTTON) || IsKeyDown(Native.VK_RBUTTON)) && CursorOverThisWindow();

    /// <summary>Ctrl physically held with the cursor over this window: a wheel zoom the user is really doing.</summary>
    bool CtrlWheelOverThisWindow() => IsKeyDown(Native.VK_CONTROL) && CursorOverThisWindow();

    static bool IsKeyDown(int vk) => (Native.GetAsyncKeyState(vk) & 0x8000) != 0;

    bool CursorOverThisWindow()
    {
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
        var ws = Ws;
        return new JsonObject
        {
            ["refreshSeconds"] = _app.Settings.General.RefreshSeconds,
            ["animations"] = _app.Settings.General.Animations,
            ["locked"] = ws.Locked,
            ["scale"] = ws.Scale,
            ["editMode"] = _app.EditMode,
            ["options"] = ws.Options.DeepClone(),
        };
    }

    void Post(JsonNode node)
    {
        if (IsDisposed || _view.CoreWebView2 is null) return;
        _view.CoreWebView2.PostWebMessageAsJson(node.ToJsonString());
    }

}
