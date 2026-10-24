using System.Text.Json.Nodes;
using Windows.Media.Capture;
using Windows.Media.Editing;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Windows.Storage;

namespace Umbra;

/// <summary>Takes one webcam still per call. Opened for a recording stretch; the camera light stays on while it is open.</summary>
interface ITimelapseCamera : IDisposable
{
    Task OpenAsync(CancellationToken ct);
    Task CaptureAsync(string jpegPath, CancellationToken ct);
}

/// <summary>
/// Runs <c>umbra.timelapse</c> recordings in the host: the page only starts, stops and watches; it never sees a frame
/// or a full path. One session at a time (one camera). Stills go to %APPDATA%\Umbra\data\timelapse\&lt;instance&gt;, are
/// rendered to an MP4 with Windows' own encoder (<see cref="RenderMp4Async"/>, no external program), then deleted.
/// Cancel, nothing captured, and Umbra exiting delete the stills without rendering. While the widget is hidden the
/// session pauses with the camera closed. Local only: nothing here touches the network. Per-still work runs off the UI thread.
/// </summary>
sealed class TimelapseService : IDisposable
{
    /// <summary>The session gives up after this many failed stills in a row (camera unplugged, taken by another app).</summary>
    public const int MaxFailures = 5;

    /// <summary>How often a paused session checks whether it may go on.</summary>
    public static readonly TimeSpan PausePoll = TimeSpan.FromSeconds(1);

    public enum Phase { Idle, Recording, Rendering }

    sealed class Session
    {
        public required string Instance, WidgetId, Dir, OutputFolder;
        public required TimelapsePlan Plan;
        public required DateTime StartedAt, Deadline;
        public readonly CancellationTokenSource Capture = new(), Render = new();
        // Everything below is read and written under _gate.
        public Phase Phase = Phase.Recording;
        public int Captured;
        public bool Discard, CapReached, Paused, LowDisk, Done;
        public string? Target, Output, Error;
        public Task Loop = Task.CompletedTask;
    }

    readonly Func<ITimelapseCamera> _camera;
    readonly Func<IReadOnlyList<string>, TimelapsePlan, string, CancellationToken, Task> _render;
    readonly Func<DateTime> _now;
    readonly Func<TimeSpan, CancellationToken, Task> _delay;
    readonly Func<string, long> _freeBytes;
    readonly string _root;
    readonly object _gate = new();
    Session? _session;
    /// <summary>The last finished session's result per instance, so status() after the end still reports the file or error.</summary>
    readonly Dictionary<string, JsonObject> _last = new();

    /// <summary>Raised (instance, state) whenever a session changes: started, a still taken, paused, rendering, finished. Any thread.</summary>
    public event Action<string, JsonObject>? Changed;

    public TimelapseService(string framesRoot,
        Func<ITimelapseCamera>? camera = null,
        Func<IReadOnlyList<string>, TimelapsePlan, string, CancellationToken, Task>? render = null,
        Func<DateTime>? now = null,
        Func<TimeSpan, CancellationToken, Task>? delay = null,
        Func<string, long>? freeBytes = null)
    {
        _root = framesRoot;
        _camera = camera ?? (() => new WindowsCamera());
        _render = render ?? RenderMp4Async;
        _now = now ?? (() => DateTime.UtcNow);
        _delay = delay ?? Task.Delay;
        _freeBytes = freeBytes ?? FreeBytes;
    }

    /// <summary>The app-wide stills folder.</summary>
    public static string DefaultRoot => Path.Combine(AppPaths.DataDir, "data", "timelapse");

    /// <summary>The instance currently recording, paused or rendering, or null.</summary>
    public string? ActiveInstance { get { lock (_gate) return _session?.Instance; } }

    /// <summary>"Recording timelapse", "Timelapse paused", "Making timelapse video" or null: the tray's one source for this.</summary>
    public string? TrayLabel
    {
        get
        {
            lock (_gate)
                return _session is not { } s ? null
                    : s.Phase == Phase.Rendering ? "Making timelapse video"
                    : s.Paused ? "Timelapse paused" : "Recording timelapse";
        }
    }

    /// <summary>True while the camera may be on (recording and not paused): the tray's red dot.</summary>
    public bool Recording { get { lock (_gate) return _session is { Phase: Phase.Recording, Paused: false }; } }

    /// <summary>Deletes stills a crash or power loss left behind (they are never kept across runs). Call off the UI thread.</summary>
    public void PurgeLeftovers()
    {
        try
        {
            if (!Directory.Exists(_root)) return;
            var active = ActiveInstance is { } a ? Path.Combine(_root, InstanceId.FileName(a)) : null;
            foreach (var dir in Directory.GetDirectories(_root))
                if (!string.Equals(dir, active, StringComparison.OrdinalIgnoreCase)) DeleteDir(dir);
        }
        catch (Exception ex) { Log.Write($"Timelapse: could not delete old stills: {ex.Message}"); }
    }

    /// <summary>
    /// Starts recording for <paramref name="instance"/>. The caller has already checked the click gate and the camera
    /// approval. Refuses when another session runs or the disk can't hold the stills and the video.
    /// </summary>
    public JsonObject Start(string instance, string widgetId, TimelapsePlan plan, string outputFolder)
    {
        var dir = Path.Combine(_root, InstanceId.FileName(instance));
        Directory.CreateDirectory(_root);
        Directory.CreateDirectory(outputFolder);
        foreach (var where in new[] { _root, outputFolder }.Distinct(StringComparer.OrdinalIgnoreCase))
            if (_freeBytes(where) is var free && free >= 0 && free < plan.DiskNeeded + TimelapsePlan.MinFreeBytes)
                throw new TimelapseException($"Not enough free disk space: this timelapse needs about {plan.DiskNeeded / 1_000_000 + TimelapsePlan.MinFreeBytes / 1_000_000} MB free");
        Session s;
        lock (_gate)
        {
            if (_session is { } busy)
                throw new TimelapseException(busy.Instance == instance ? "A timelapse is already running for this widget" : "Another widget is recording a timelapse; stop it first");
            var now = _now();
            s = new Session
            {
                Instance = instance, WidgetId = widgetId, Plan = plan, OutputFolder = outputFolder, Dir = dir,
                StartedAt = now, Deadline = now + TimelapsePlan.MaxSession,
            };
            _session = s;
            _last.Remove(instance);
        }
        DeleteDir(dir);
        Directory.CreateDirectory(dir);
        Log.Write($"[{instance}] timelapse started: {plan.Frames} stills every {plan.Interval.TotalSeconds:0.#} s, {plan.Fps} fps");
        var state = StateOf(s);
        s.Loop = Task.Run(() => RunAsync(s));
        Raise(s.Instance, state);
        return state;
    }

    /// <summary>Ends recording early and renders what was captured. False when this instance has no session.</summary>
    public bool Stop(string instance) => End(instance, discard: false);

    /// <summary>Ends recording (or rendering) and deletes the stills without making a video.</summary>
    public bool Cancel(string instance) => End(instance, discard: true);

    bool End(string instance, bool discard)
    {
        lock (_gate)
        {
            if (_session is not { } s || s.Instance != instance) return false;
            if (discard) { s.Discard = true; s.Render.Cancel(); }
            s.Capture.Cancel();
            return true;
        }
    }

    /// <summary>The widget was hidden (paused: no stills, camera closed) or shown again. The 12 h cap keeps running.</summary>
    public void SetPaused(string instance, bool paused)
    {
        JsonObject? state = null;
        lock (_gate)
        {
            if (_session is { Phase: Phase.Recording } s && s.Instance == instance && s.Paused != paused)
            {
                s.Paused = paused;
                state = StateOfLocked(s);
            }
        }
        if (state is not null) Raise(instance, state);
    }

    public JsonObject Status(string instance)
    {
        lock (_gate)
        {
            if (_session is { } s && s.Instance == instance) return StateOfLocked(s);
            return _last.TryGetValue(instance, out var last) ? (JsonObject)last.DeepClone() : new JsonObject { ["state"] = "idle" };
        }
    }

    /// <summary>Waits for the current session (tests).</summary>
    public Task Completion { get { lock (_gate) return _session?.Loop ?? Task.CompletedTask; } }

    JsonObject StateOf(Session s) { lock (_gate) return StateOfLocked(s); }

    /// <summary>What the page sees: counts, times and the video's file name only (never a full path).</summary>
    static JsonObject StateOfLocked(Session s) => new()
    {
        ["state"] = s.Phase switch { Phase.Recording => s.Paused ? "paused" : "recording", Phase.Rendering => "rendering", _ => "idle" },
        ["framesCaptured"] = s.Captured,
        ["framesPlanned"] = s.Plan.Frames,
        ["startedAt"] = s.StartedAt.ToString("o"),
        ["endsBy"] = s.Deadline.ToString("o"),
        ["plan"] = s.Plan.ToJson(),
        ["file"] = s.Output is null ? null : Path.GetFileName(s.Output),
        ["folder"] = TimelapseFolders.Label(s.OutputFolder),
        ["error"] = s.Error,
        ["capReached"] = s.CapReached,
        ["lowDisk"] = s.LowDisk,
        ["cancelled"] = s.Discard,
    };

    void Raise(string instance, JsonObject state)
    {
        try { Changed?.Invoke(instance, state); }
        catch (Exception ex) { Log.Write($"[{instance}] timelapse event handler failed: {ex.Message}"); }
    }

    bool Paused(Session s) { lock (_gate) return s.Paused; }

    async Task RunAsync(Session s)
    {
        var ct = s.Capture.Token;
        var frames = new List<string>();
        ITimelapseCamera? camera = null;
        void Close()
        {
            try { camera?.Dispose(); } catch (Exception ex) { Log.Write($"[{s.Instance}] closing the camera failed: {ex.Message}"); }
            camera = null;
        }
        try
        {
            var due = _now();
            var failures = 0;
            while (frames.Count < s.Plan.Frames)
            {
                var wait = due - _now();
                if (wait > TimeSpan.Zero) await _delay(wait, ct).ConfigureAwait(false);
                ct.ThrowIfCancellationRequested();
                if (_now() >= s.Deadline) { lock (_gate) s.CapReached = true; break; }
                if (Paused(s))
                {
                    Close(); // hidden widget: the camera goes off until it is shown again
                    while (Paused(s) && _now() < s.Deadline) await _delay(PausePoll, ct).ConfigureAwait(false);
                    due = _now();
                    continue;
                }
                if (_freeBytes(s.Dir) is var free && free >= 0 && free < TimelapsePlan.MinFreeBytes)
                {
                    lock (_gate) { s.LowDisk = true; s.Error = "The disk is almost full, so recording stopped"; }
                    break;
                }
                if (camera is null)
                {
                    camera = _camera();
                    await camera.OpenAsync(ct).ConfigureAwait(false);
                }
                var file = TimelapsePlan.FramePath(s.Dir, frames.Count);
                try
                {
                    await camera.CaptureAsync(file, ct).ConfigureAwait(false);
                    frames.Add(file);
                    failures = 0;
                    lock (_gate) s.Captured = frames.Count;
                    Raise(s.Instance, StateOf(s));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    Log.Write($"[{s.Instance}] timelapse still failed: {ex.Message}");
                    if (++failures >= MaxFailures) { lock (_gate) s.Error = $"The camera stopped answering ({ex.Message})"; break; }
                }
                due = TimelapsePlan.NextDue(due, s.Plan.Interval, _now());
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            lock (_gate) s.Error = CameraError(ex);
            Log.Write($"[{s.Instance}] timelapse camera failed: {ex}");
        }
        finally { Close(); }

        bool render;
        lock (_gate)
        {
            render = !s.Discard && frames.Count > 0;
            if (render) s.Phase = Phase.Rendering;
        }
        if (render)
        {
            Raise(s.Instance, StateOf(s));
            try
            {
                Directory.CreateDirectory(s.OutputFolder);
                var output = TimelapsePlan.OutputPath(s.OutputFolder, s.StartedAt.ToLocalTime(), File.Exists);
                lock (_gate) s.Target = output;
                await _render(frames, s.Plan, output, s.Render.Token).ConfigureAwait(false);
                lock (_gate) { s.Output = output; s.Target = null; }
                Log.Write($"[{s.Instance}] timelapse saved: {frames.Count} stills -> {output}");
            }
            catch (OperationCanceledException) { lock (_gate) s.Discard = true; DeletePartial(s); }
            catch (Exception ex)
            {
                lock (_gate) s.Error = $"The video could not be made: {ex.Message}";
                Log.Write($"[{s.Instance}] timelapse render failed: {ex}");
                DeletePartial(s);
            }
        }

        DeleteDir(s.Dir);
        JsonObject final;
        lock (_gate)
        {
            s.Phase = Phase.Idle;
            s.Done = true;
            final = StateOfLocked(s);
            _last[s.Instance] = final;
            if (_session == s) _session = null;
        }
        Raise(s.Instance, (JsonObject)final.DeepClone());
    }

    /// <summary>A render that did not finish leaves no half-written video behind.</summary>
    void DeletePartial(Session s)
    {
        string? target;
        lock (_gate) { target = s.Target; s.Target = null; }
        try { if (target is not null && File.Exists(target)) File.Delete(target); }
        catch (Exception ex) { Log.Write($"Timelapse: could not delete a partial video: {ex.Message}"); }
    }

    static string CameraError(Exception ex) => ex switch
    {
        UnauthorizedAccessException => "Windows blocked the camera. Turn on Settings > Privacy & security > Camera > Let desktop apps access your camera.",
        _ when ex.HResult == unchecked((int)0xC00D36D5) => "No camera was found",
        _ => $"The camera could not be opened: {ex.Message}",
    };

    static long FreeBytes(string path)
    {
        try { return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path))!).AvailableFreeSpace; }
        catch (Exception) { return -1; } // unknown (network share...): don't block on it
    }

    static void DeleteDir(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); }
        catch (Exception ex) { Log.Write($"Timelapse: could not delete stills in {dir}: {ex.Message}"); }
    }

    /// <summary>Umbra is exiting: stop the camera, delete every still and any half-written video (no render).</summary>
    public void Dispose()
    {
        Session? s;
        lock (_gate) s = _session;
        if (s is null) return;
        Cancel(s.Instance);
        // The loop runs on the thread pool and finishes the cleanup itself; wait briefly, then clean up anyway.
        try { s.Loop.Wait(TimeSpan.FromSeconds(3)); } catch (AggregateException) { }
        DeletePartial(s);
        DeleteDir(s.Dir);
    }

    /// <summary>
    /// Stills to MP4 (H.264) with Windows' MediaComposition: each still is a clip of exactly one frame at the plan's fps
    /// (<see cref="TimelapsePlan.ClipDuration"/>), encoded at 720p and the plan's frame rate.
    /// </summary>
    internal static async Task RenderMp4Async(IReadOnlyList<string> frames, TimelapsePlan plan, string output, CancellationToken ct)
    {
        var composition = new MediaComposition();
        for (var i = 0; i < frames.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var still = await StorageFile.GetFileFromPathAsync(frames[i]).AsTask(ct).ConfigureAwait(false);
            composition.Clips.Add(await MediaClip.CreateFromImageFileAsync(still, plan.ClipDuration(i)).AsTask(ct).ConfigureAwait(false));
        }
        var profile = MediaEncodingProfile.CreateMp4(VideoEncodingQuality.HD720p);
        profile.Video.FrameRate.Numerator = (uint)plan.Fps;
        profile.Video.FrameRate.Denominator = 1;
        var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(output)!).AsTask(ct).ConfigureAwait(false);
        var file = await folder.CreateFileAsync(Path.GetFileName(output), CreationCollisionOption.FailIfExists).AsTask(ct).ConfigureAwait(false);
        var result = await composition.RenderToFileAsync(file, MediaTrimmingPreference.Precise, profile).AsTask(ct).ConfigureAwait(false);
        if (result != TranscodeFailureReason.None) throw new TimelapseException($"Windows could not encode the video ({result})");
    }

    /// <summary>The default webcam through Windows.Media.Capture (no WebView involved, so no page ever gets the stream).</summary>
    sealed class WindowsCamera : ITimelapseCamera
    {
        /// <summary>Stills are taken at the largest photo size up to this width (720p): enough for a 720p video, small on disk.</summary>
        const uint MaxWidth = 1280;
        MediaCapture? _capture;

        public async Task OpenAsync(CancellationToken ct)
        {
            _capture = new MediaCapture();
            await _capture.InitializeAsync(new MediaCaptureInitializationSettings
            {
                StreamingCaptureMode = StreamingCaptureMode.Video,
                MemoryPreference = MediaCaptureMemoryPreference.Cpu,
            }).AsTask(ct).ConfigureAwait(false);
            try
            {
                var best = _capture.VideoDeviceController.GetAvailableMediaStreamProperties(MediaStreamType.Photo)
                    .OfType<VideoEncodingProperties>()
                    .Where(p => p.Width <= MaxWidth)
                    .OrderByDescending(p => p.Width * p.Height)
                    .FirstOrDefault()
                    ?? _capture.VideoDeviceController.GetAvailableMediaStreamProperties(MediaStreamType.VideoPreview)
                    .OfType<VideoEncodingProperties>()
                    .Where(p => p.Width <= MaxWidth)
                    .OrderByDescending(p => p.Width * p.Height)
                    .FirstOrDefault();
                if (best is not null)
                    await _capture.VideoDeviceController.SetMediaStreamPropertiesAsync(MediaStreamType.Photo, best).AsTask(ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Log.Write($"Timelapse: could not pick a 720p photo size, using the camera default: {ex.Message}");
            }
            await Task.Delay(1500, ct).ConfigureAwait(false); // let auto exposure and white balance settle before the first still
        }

        public async Task CaptureAsync(string jpegPath, CancellationToken ct)
        {
            var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(jpegPath)!).AsTask(ct).ConfigureAwait(false);
            var file = await folder.CreateFileAsync(Path.GetFileName(jpegPath), CreationCollisionOption.ReplaceExisting).AsTask(ct).ConfigureAwait(false);
            await _capture!.CapturePhotoToStorageFileAsync(ImageEncodingProperties.CreateJpeg(), file).AsTask(ct).ConfigureAwait(false);
        }

        public void Dispose() => _capture?.Dispose();
    }
}
