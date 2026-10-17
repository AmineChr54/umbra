using System.Globalization;
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
    long _lastZoomAt = long.MinValue / 2;

    public WidgetManifest Manifest { get; }

    /// <summary>Which copy of the widget this is: the widget id, or "id#2" and up for extra copies.</summary>
    public string Instance { get; }

    readonly WidgetSettings _detached = new();

    /// <summary>
    /// This copy's settings. Never creates an entry: once the copy was removed, a closing window or a late
    /// message gets throwaway defaults instead of resurrecting it in settings.json.
    /// </summary>
    WidgetSettings Ws => _app.Settings.Widgets.TryGetValue(Instance, out var ws) ? ws : _detached;

    /// <summary>False once the window is disposed or its copy was removed: nothing may be written for it.</summary>
    bool Alive => !IsDisposed && _app.Settings.Widgets.ContainsKey(Instance);

    /// <summary>Changing the widget by hand (corner handle, Ctrl+wheel) needs edit mode and an unlocked widget.</summary>
    bool CanArrange => WidgetGeometry.CanArrange(_app.EditMode, Ws.Locked);

    /// <summary>The window size for a scale: manifest size (logical pixels) x monitor DPI x scale.</summary>
    Size ScaledSize(double scale) => WidgetGeometry.ScaledSize(Manifest.Width, Manifest.Height, DeviceDpi, scale);

    /// <summary>The scale a window width stands for at the current DPI.</summary>
    double ScaleForWidth(int width) => WidgetGeometry.ScaleForWidth(Manifest.Width, DeviceDpi, width);

    public WidgetWindow(App app, WidgetManifest manifest, string instance)
    {
        _app = app;
        Manifest = manifest;
        Instance = instance;

        Text = $"Umbra - {App.InstanceLabel(manifest, instance)}";
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

    /// <summary>WinForms re-parents a window that is shown with ShowInTaskbar off, which drops the Progman owner set in OnHandleCreated.</summary>
    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible) DesktopPin.Apply(Handle);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == DesktopPin.TaskbarCreated) DesktopPin.Apply(Handle); // Explorer restarted: Progman is a new window
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
            case Native.WM_MOVING when _app.EditMode && !Ws.Locked && !_resizing:
                SnapMove(m.LParam);
                m.Result = 1;
                return;
            case Native.WM_SIZING when _resizing:
                KeepAspect(m.LParam);
                m.Result = 1;
                return;
        }
        base.WndProc(ref m);
    }

    /// <summary>WM_MOVING in edit mode: snap to the grid and to screen/widget edges unless Shift is held.</summary>
    unsafe void SnapMove(IntPtr lParam)
    {
        var g = _app.Settings.General;
        if (!Snap.IsActive(g) || (ModifierKeys & Keys.Shift) != 0) return;
        var r = (Native.RECT*)lParam;
        var rect = Rectangle.FromLTRB(r->Left, r->Top, r->Right, r->Bottom);
        var areas = Placement.Monitors().Select(s => s.WorkArea).ToList();
        var others = _app.OpenWindows.Where(w => w != this && w.Visible).Select(w => w.Bounds).ToList();
        var s2 = Snap.Move(rect, g.SnapGrid, g.SnapEdges, areas, others, (int)(10 * DeviceDpi / 96.0));
        r->Left = s2.Left; r->Top = s2.Top; r->Right = s2.Right; r->Bottom = s2.Bottom;
    }

    /// <summary>Esc while this widget has keyboard focus (it only gets it after a real press) ends edit mode.</summary>
    void OnViewKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode != Keys.Escape || !_app.EditMode) return;
        e.Handled = true;
        _app.SetEditMode(false);
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
        var size = WidgetGeometry.KeepAspect(Manifest.Width, Manifest.Height, DeviceDpi, r->Right - r->Left, r->Bottom - r->Top);
        r->Right = r->Left + size.Width;
        r->Bottom = r->Top + size.Height;
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        // While the corner handle is dragged, zoom the page along with the window.
        if (_resizing)
        {
            var scale = ScaleForWidth(Width);
            ApplyZoom(scale);
            if (_ready) Post(new JsonObject { ["type"] = "editScale", ["scale"] = scale }); // keeps the overlay outline steady
        }
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
            _view.KeyDown += OnViewKeyDown; // WebView2 forwards accelerator keys (Esc included) here
            _view.CoreWebView2.Navigate(Manifest.PageUrl);
        }
        catch (Exception ex)
        {
            Log.Write($"[{Instance}] WebView2 init failed: {ex}");
        }
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        // Keep the spot Windows picked (the window may be mid-drag onto another monitor); only the size follows the new DPI.
        ApplyBounds(e.SuggestedRectangle.Location);
        if (Alive) { RememberPosition(); _app.SaveSettings(); } // else the next PushSettings snaps back to the old spot
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
        else if (ws.RelX is int rx && ws.RelY is int ry && ws.Monitor is not null)
            loc = Placement.Resolve(Placement.Monitors(), ws.Monitor, rx, ry, size);
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
        ws.Monitor = null; ws.RelX = ws.RelY = null;
        _app.SaveSettings();
        ApplyBounds();
    }

    /// <summary>Re-places the window from its saved monitor and offset (monitors were added, removed or rearranged).</summary>
    public void ReapplyPlacement() => ApplyBounds();

    /// <summary>Puts the widget on another monitor, keeping its offset from the monitor's corner (24 px if it had none).</summary>
    public void MoveToMonitor(string monitor)
    {
        var ws = Ws;
        if (ws.RelX is null || ws.RelY is null)
        {
            var cur = Placement.Find(Placement.Monitors(), Bounds);
            ws.RelX = cur is MonitorInfo c ? Left - c.Bounds.X : 24;
            ws.RelY = cur is MonitorInfo d ? Top - d.Bounds.Y : 24;
        }
        ws.Monitor = monitor;
        ApplyBounds();
        ws.X = Left; ws.Y = Top;
        _app.SaveSettings();
    }

    /// <summary>Records where the window is now: absolute spot plus monitor and offset from its corner, so it survives monitor changes.</summary>
    void RememberPosition()
    {
        var ws = Ws;
        ws.X = Left; ws.Y = Top;
        var mon = Placement.Find(Placement.Monitors(), Bounds);
        if (mon is MonitorInfo m)
        {
            ws.Monitor = m.Name;
            ws.RelX = Left - m.Bounds.X;
            ws.RelY = Top - m.Bounds.Y;
        }
    }

    /// <summary>Zooms the widget by hand (corner handle, Ctrl+wheel): the top-left corner stays where it is.</summary>
    void SetScaleByHand(double scale)
    {
        var ws = Ws;
        ws.Scale = scale;
        _app.NoteHandScale(Instance);
        RememberPosition();
        PushSettings();
        SaveSoon();
    }

    /// <summary>A wheel notch or a held arrow key can fire many times a second: write settings.json and refresh the tray/Settings once it settles.</summary>
    void SaveSoon()
    {
        _saveTimer ??= new System.Windows.Forms.Timer { Interval = 300 };
        _saveTimer.Tick -= FlushScale;
        _saveTimer.Tick += FlushScale;
        _saveTimer.Stop(); _saveTimer.Start();
    }

    System.Windows.Forms.Timer? _saveTimer;

    void FlushScale(object? sender, EventArgs e)
    {
        _saveTimer?.Stop();
        if (!Alive) return;
        _app.SaveSettings();
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
                if (Ws.Locked || _resizing) return;
                Native.ReleaseCapture();
                Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, Native.HTCAPTION, IntPtr.Zero);
                // SendMessage returns when the move loop ends: persist the new spot.
                RememberPosition();
                _app.SaveSettings();
                DesktopPin.SendToBottom(Handle);
                _app.RefreshEditPills();
                break;

            case "resize":
                // The edit-mode corner handle. Only a real press on this window starts the native size loop.
                // Messages still arrive during the modal size loop, so a second "resize" must not nest.
                if (_resizing || !CanArrange || !PressedOnThisWindow()) return;
                SelectForEdit();
                var before = Size;
                _resizing = true;
                try
                {
                    Native.ReleaseCapture();
                    Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, Native.HTBOTTOMRIGHT, IntPtr.Zero);
                }
                finally { _resizing = false; }
                // Edit mode may have been turned off (or the widget locked) during the drag: put the saved size back.
                if (!CanArrange) ApplyBounds();
                else if (Size != before) SetScaleByHand(ScaleForWidth(Width));
                DesktopPin.SendToBottom(Handle);
                break;

            case "zoom":
                // Ctrl+wheel in edit mode: one 10 % step per message, at most one every 50 ms.
                // The page can't fake Ctrl being physically down over this window.
                if (_resizing || !CanArrange || !CtrlWheelOverThisWindow()) return;
                if (msg?["steps"] is not JsonNode stepsNode || stepsNode.GetValueKind() != JsonValueKind.Number) return;
                var steps = Math.Sign(stepsNode.GetValue<double>());
                var now = System.Environment.TickCount64;
                if (steps == 0 || now - _lastZoomAt < 50) return;
                _lastZoomAt = now;
                SetScaleByHand(Ws.Scale + 0.1 * steps);
                break;

            case "nudge":
                Nudge(msg?["dir"]?.GetValue<string>());
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
            case "fetchText":
                await HandleFetch(msg!, type == "fetchText");
                break;

            case "store":
                HandleStore(msg!);
                break;

            case "system":
                HandleSystem(msg!);
                break;

            case "notify":
                HandleNotify(msg!);
                break;

            case "media":
                await HandleMedia(msg!);
                break;

            case "run":
                await HandleRun(msg!);
                break;

            case "exitEdit":
                // The page saw Esc. Only honoured while this window is the foreground one and Esc is physically down (a page can't fake it).
                if (_app.EditMode && Native.GetForegroundWindow() == Handle && IsKeyDown(Native.VK_ESCAPE)) _app.SetEditMode(false);
                break;

            case "pointer":
                if (PressedOnThisWindow()) { MarkPressed(); SelectForEdit(); }
                break;

            case "focus":
                if (PressedOnThisWindow()) { MarkPressed(); SelectForEdit(); }
                TakeKeyboardFocus();
                break;
        }
    }

    /// <summary>A physical press on this widget in edit mode makes it the one the arrow keys move.</summary>
    void SelectForEdit()
    {
        if (CanArrange) _app.SelectForEdit(Instance);
    }

    /// <summary>Redraws the stronger outline when this widget becomes (or stops being) the selected one.</summary>
    public void ShowEditSelected(bool selected)
    {
        if (_ready) Post(new JsonObject { ["type"] = "editSelected", ["selected"] = selected });
    }

    /// <summary>
    /// Arrow-key nudge in edit mode: 1 px, Shift 10 px (one grid step when snapping is on). The page only reports which
    /// arrow it saw; the host moves the window only for the selected, unlocked widget while it holds the foreground
    /// (which a widget gets only after a physical click) and that arrow key is physically down. The widget can't leave
    /// its work area completely, and the new spot is saved like after a drag.
    /// </summary>
    void Nudge(string? dir)
    {
        var (sx, sy, vk) = dir switch
        {
            "left" => (-1, 0, Native.VK_LEFT),
            "right" => (1, 0, Native.VK_RIGHT),
            "up" => (0, -1, Native.VK_UP),
            "down" => (0, 1, Native.VK_DOWN),
            _ => (0, 0, 0),
        };
        if (vk == 0 || _resizing || !CanArrange || !Alive || _app.EditSelection != Instance) return;
        if (Native.GetForegroundWindow() != Handle || !IsKeyDown(vk)) return;

        var grid = _app.Settings.General.SnapGrid;
        bool big = IsKeyDown(Native.VK_SHIFT);
        var to = new Point(
            sx == 0 ? Left : WidgetGeometry.NudgeTo(Left, sx, big, grid),
            sy == 0 ? Top : WidgetGeometry.NudgeTo(Top, sy, big, grid));
        var areas = Placement.Monitors().Select(s => s.WorkArea).ToList();
        if (!WidgetGeometry.KeepsOnScreen(new Rectangle(to, Size), areas, (int)(WidgetGeometry.NudgeKeepVisible * DeviceDpi / 96.0))) return;

        Location = to;
        RememberPosition();
        SaveSoon();
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

    /// <summary>Did the user physically press the mouse on this window in the last two seconds? Gates the first-approval prompt.</summary>
    bool RecentUserPress() => System.Environment.TickCount64 - _pressedAt <= 2000;

    /// <summary>Cancelled when the window closes (widget disabled or removed): running commands are killed.</summary>
    readonly CancellationTokenSource _closing = new();

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _closing.Cancel();
        base.OnFormClosed(e);
    }

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
        if (!Alive) return; // removed copy: don't recreate its data file
        try
        {
            var op = msg["op"]?.GetValue<string>();
            var key = msg["key"]?.GetValue<string>() ?? "";
            switch (op)
            {
                case "get":
                    var (found, value) = WidgetStore.Get(Instance, key);
                    reply["data"] = new JsonObject { ["found"] = found, ["value"] = value };
                    break;
                case "set":
                    WidgetStore.Set(Instance, key, msg["value"]);
                    break;
                case "remove":
                    WidgetStore.Remove(Instance, key);
                    break;
                case "keys":
                    reply["data"] = new JsonArray(WidgetStore.Keys(Instance).Select(k => (JsonNode?)k).ToArray());
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
            Log.Write($"[{Instance}] store {msg["op"]} failed: {ex.Message}");
        }
        Post(reply);
    }

    /// <summary>
    /// umbra.run: asks the host to run one of this widget's declared commands (permissions.commands). The page sends
    /// only a command id and string parameters; <see cref="CommandService"/> does the checking and the approval.
    /// </summary>
    /// <summary>Answers umbra.system() with only the metric kinds the manifest declared (none declared: rejected).</summary>
    void HandleSystem(JsonNode msg)
    {
        var reply = new JsonObject { ["type"] = "systemResult", ["id"] = msg["id"]?.DeepClone() };
        if (Manifest.Permissions.System.Count == 0 || !(Alive && Ws.Enabled))
        {
            reply["ok"] = false;
            reply["error"] = "This widget has no permissions.system";
        }
        else
        {
            reply["ok"] = true;
            reply["data"] = SystemMetrics.Read(Manifest.Permissions.System);
        }
        Post(reply);
    }

    /// <summary>umbra.notify: needs permissions.notifications, the user's switch for this widget, and stays within the rate limit.</summary>
    void HandleNotify(JsonNode msg)
    {
        var reply = new JsonObject { ["type"] = "notifyResult", ["id"] = msg["id"]?.DeepClone() };
        string? error = null;
        var title = Notifier.Clean(msg["title"] is JsonValue t && t.GetValueKind() == JsonValueKind.String ? t.GetValue<string>() : null, Notifier.MaxTitle);
        var body = Notifier.Clean(msg["body"] is JsonValue b && b.GetValueKind() == JsonValueKind.String ? b.GetValue<string>() : null, Notifier.MaxBody);
        var url = msg["url"] is JsonValue u && u.GetValueKind() == JsonValueKind.String ? u.GetValue<string>() : null;
        if (!Manifest.Permissions.Notifications) error = "This widget has no permissions.notifications";
        else if (!(Alive && Ws.Enabled) || !Ws.Notifications) error = "Notifications are off for this widget (Settings)";
        else if (title.Length == 0) error = "A title is required";
        else if (url is not null && !(Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http"))) error = "url must be http(s)";
        else if (!_app.Notify(Instance, App.InstanceLabel(Manifest, Instance), title, body, url)) error = "Rate limit reached (5 per 10 minutes)";
        reply["ok"] = error is null;
        if (error is not null) reply["error"] = error;
        Post(reply);
    }

    /// <summary>umbra.media: "get" needs permissions.media "read"; "control" needs "control" and a recent physical press on the widget.</summary>
    async Task HandleMedia(JsonNode msg)
    {
        var reply = new JsonObject { ["type"] = "mediaResult", ["id"] = msg["id"]?.DeepClone() };
        try
        {
            var media = Manifest.Permissions.Media;
            if (!(Alive && Ws.Enabled)) throw new WidgetCommandException("The widget is disabled");
            var action = msg["action"] is JsonValue a && a.GetValueKind() == JsonValueKind.String ? a.GetValue<string>() : null;
            if (action == "get")
            {
                if (!media.Contains("read")) throw new WidgetCommandException("This widget has no permissions.media \"read\"");
                reply["data"] = await MediaService.NowPlayingAsync();
            }
            else if (action == "control")
            {
                if (!media.Contains("control")) throw new WidgetCommandException("This widget has no permissions.media \"control\"");
                var cmd = msg["command"] is JsonValue c && c.GetValueKind() == JsonValueKind.String ? c.GetValue<string>() : null;
                if (!MediaService.IsCommand(cmd)) throw new WidgetCommandException("Unknown media command");
                if (!RecentUserPress()) throw new WidgetCommandException("Click the widget first: media controls need a physical click");
                reply["data"] = await MediaService.ControlAsync(cmd!);
            }
            else throw new WidgetCommandException("Unknown media action");
            reply["ok"] = true;
        }
        catch (Exception ex)
        {
            reply["ok"] = false;
            reply["error"] = ex is WidgetCommandException ? ex.Message : "Media is not available";
            if (ex is not WidgetCommandException) Log.Write($"[{Manifest.Id}] media failed: {ex.Message}");
        }
        Post(reply);
    }

    async Task HandleRun(JsonNode msg)
    {
        var reply = new JsonObject { ["type"] = "runResult", ["id"] = msg["id"]?.DeepClone() };
        try
        {
            if (msg["command"] is not JsonValue c || c.GetValueKind() != JsonValueKind.String)
                throw new WidgetCommandException("A command id is required");
            if (msg["params"] is not null && msg["params"] is not JsonObject)
                throw new WidgetCommandException("params must be an object of strings");
            reply["data"] = await _app.Commands.RunAsync(Manifest, Alive && Ws.Enabled, RecentUserPress(),
                c.GetValue<string>(), msg["params"] as JsonObject, _closing.Token, Instance);
            reply["ok"] = true;
        }
        catch (Exception ex)
        {
            reply["ok"] = false;
            reply["error"] = ex is WidgetCommandException ? ex.Message : "The command failed";
            if (ex is not WidgetCommandException) Log.Write($"[{Manifest.Id}] run failed: {ex}");
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
        await File.WriteAllBytesAsync(Path.Combine(dir, $"{InstanceId.FileName(Instance)}.png"), png);
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

    async Task HandleFetch(JsonNode msg, bool asText)
    {
        var id = msg["id"]?.GetValue<int>() ?? 0;
        var url = msg["url"]?.GetValue<string>() ?? "";
        var reply = new JsonObject { ["type"] = "fetchResult", ["id"] = id };

        if (!Manifest.AllowsUrl(url))
        {
            reply["ok"] = false;
            reply["error"] = "Host not allowed by widget.json permissions";
            Log.Write($"[{Instance}] blocked fetch: {url}");
        }
        else
        {
            try
            {
                reply["data"] = asText ? JsonValue.Create(await Fetcher.GetTextAsync(url)) : await Fetcher.GetJsonAsync(url);
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
        ["widget"] = new JsonObject { ["id"] = Manifest.Id, ["instance"] = Instance, ["name"] = Manifest.Name },
        ["settings"] = SettingsPayload(),
    });

    public void PushSettings()
    {
        ApplyBounds();
        Opacity = Ws.Opacity is double o ? Prefs.ClampOpacity(o, _app.Settings.General.ReduceTransparency) : 1.0;
        if (_ready) Post(new JsonObject { ["type"] = "settings", ["settings"] = SettingsPayload() });
    }

    /// <summary>Tells the page that pausing or Energy Saver changed (#104); unlike <see cref="PushSettings"/> it leaves the window alone.</summary>
    public void PushPower()
    {
        if (_ready) Post(new JsonObject { ["type"] = "settings", ["settings"] = SettingsPayload() });
    }

    public void RefreshData()
    {
        if (_ready) Post(new JsonObject { ["type"] = "refresh" });
    }

    /// <summary>The system clock or time zone changed: the SDK runs the page's onTimeChanged handlers, or its refresh handlers when it has none.</summary>
    public void NotifyTimeChanged()
    {
        if (_ready) Post(TimeChange.Message());
    }

    JsonObject SettingsPayload()
    {
        var ws = Ws;
        var saver = _app.Power.EnergySaver && _app.Settings.General.SlowOnEnergySaver; // true = intervals are stretched
        return new JsonObject
        {
            ["refreshSeconds"] = PowerPolicy.Refresh(Prefs.EffectiveRefresh(ws, _app.Settings.General), saver, true),
            ["paused"] = _app.Power.Paused,
            ["energySaver"] = saver,
            ["animations"] = Prefs.MotionOn(_app.Settings.General),
            ["appearanceCss"] = Manifest.Themeable ? Prefs.AppearanceCss(_app.Settings.General) : "",
            ["themeCss"] = Manifest.Themeable ? _app.ThemeCss : "",
            ["locked"] = ws.Locked,
            ["accent"] = Prefs.ResolveAccent(_app.Settings.General, Prefs.SystemAccent),
            ["scale"] = ws.Scale,
            ["locale"] = Prefs.LocaleOf(CultureInfo.CurrentCulture),
            ["hour12"] = Prefs.Hour12Of(CultureInfo.CurrentCulture),
            ["editMode"] = _app.EditMode,
            ["editSelected"] = _app.EditMode && _app.EditSelection == Instance,
            ["options"] = ws.Options.DeepClone(),
        };
    }

    void Post(JsonNode node)
    {
        if (IsDisposed || _view.CoreWebView2 is null) return;
        _view.CoreWebView2.PostWebMessageAsJson(node.ToJsonString());
    }

}
