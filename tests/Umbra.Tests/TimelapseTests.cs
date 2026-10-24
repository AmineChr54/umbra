extern alias cli;

using System.Text.Json.Nodes;
using McpServer = cli::Umbra.Cli.McpServer;

namespace Umbra.Tests;

/// <summary>umbra.timelapse: the plan arithmetic, the frame schedule, the session lifecycle and what automation can't do.</summary>
public class TimelapseTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), "umbra-timelapse-" + Guid.NewGuid().ToString("N"));

    public TimelapseTests() => TestEnv.Init();

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (DirectoryNotFoundException) { }
    }

    [Theory]
    [InlineData(5, 10, 30, 300, 1495)]   // 10 s of video at 30 fps: 300 stills, 299 gaps of 5 s
    [InlineData(60, 20, 24, 480, 28740)] // a 8 h study session in 20 s
    [InlineData(1, 0.5, 25, 13, 12)]     // 12.5 frames round up to 13
    public void Plan_counts_frames_and_session(double interval, double length, int fps, int frames, double sessionSeconds)
    {
        var p = TimelapsePlan.Create(interval, length, fps);
        Assert.Equal(frames, p.Frames);
        Assert.Equal(sessionSeconds, p.Session.TotalSeconds, 6);
    }

    [Theory]
    [InlineData(0.5, 10, 30)]
    [InlineData(5, 0, 30)]
    [InlineData(5, 10, 0)]
    [InlineData(5, 10, 61)]
    [InlineData(5, 10, 29.5)]
    [InlineData(double.NaN, 10, 30)]
    [InlineData(5, 3601, 30)]
    [InlineData(60, 60, 30)] // 1800 stills a minute apart = 30 h, over the 12 h cap
    public void Plan_refuses_bad_numbers_and_sessions_over_12_hours(double interval, double length, double fps) =>
        Assert.Throws<TimelapseException>(() => TimelapsePlan.Create(interval, length, fps));

    [Fact]
    public void Plan_at_exactly_12_hours_is_allowed()
    {
        var p = TimelapsePlan.Create(60, 721.0 / 30, 30); // 721 stills, 720 minutes
        Assert.Equal(TimelapsePlan.MaxSession, p.Session);
    }

    [Theory]
    [InlineData(30)]
    [InlineData(24)]
    [InlineData(60)]
    [InlineData(7)]
    public void Clip_durations_add_up_to_exactly_frames_over_fps(int fps)
    {
        var p = TimelapsePlan.Create(2, 10, fps);
        var total = Enumerable.Range(0, p.Frames).Sum(i => p.ClipDuration(i).Ticks);
        Assert.Equal(TimeSpan.FromSeconds(p.Frames / (double)fps).Ticks, total);
        Assert.Equal(total, p.VideoLength(p.Frames).Ticks);
        Assert.All(Enumerable.Range(0, p.Frames), i => Assert.InRange(p.ClipDuration(i).Ticks, TimeSpan.TicksPerSecond / fps - 1, TimeSpan.TicksPerSecond / fps + 1));
    }

    [Fact]
    public void NextDue_keeps_the_grid_and_restarts_after_a_long_gap()
    {
        var t = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc);
        var i = TimeSpan.FromSeconds(10);
        Assert.Equal(t.AddSeconds(10), TimelapsePlan.NextDue(t, i, t.AddSeconds(1)));
        Assert.Equal(t.AddSeconds(10), TimelapsePlan.NextDue(t, i, t.AddSeconds(15))); // a bit late: catch up once, no drift
        Assert.Equal(t.AddHours(1), TimelapsePlan.NextDue(t, i, t.AddHours(1)));        // after sleep: no burst of stills
    }

    [Fact]
    public void OutputPath_never_overwrites()
    {
        var taken = new HashSet<string> { Path.Combine("C:\\v", "Timelapse 2026-10-24 14-05.mp4"), Path.Combine("C:\\v", "Timelapse 2026-10-24 14-05 (2).mp4") };
        Assert.Equal(Path.Combine("C:\\v", "Timelapse 2026-10-24 14-05 (3).mp4"), TimelapsePlan.OutputPath("C:\\v", new DateTime(2026, 10, 24, 14, 5, 59), taken.Contains));
    }

    /// <summary>A camera that writes a tiny file per still and can fail on demand.</summary>
    sealed class FakeCamera : ITimelapseCamera
    {
        public int Shots, FailFrom = int.MaxValue;
        public bool Opened, Disposed;
        public Task OpenAsync(CancellationToken ct) { Opened = true; return Task.CompletedTask; }
        public Task CaptureAsync(string path, CancellationToken ct)
        {
            if (Shots >= FailFrom) throw new IOException("camera gone");
            File.WriteAllBytes(path, [0xFF, 0xD8, (byte)Shots++]);
            return Task.CompletedTask;
        }
        public void Dispose() => Disposed = true;
    }

    /// <summary>A clock that moves forward by exactly what the service waits, so a 12 h session runs instantly.</summary>
    sealed class FakeClock
    {
        public DateTime Now = new(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc);
        public TimeSpan ExtraPerWait = TimeSpan.Zero;
        public int Polls;
        public Task Delay(TimeSpan d, CancellationToken ct) { ct.ThrowIfCancellationRequested(); Now += d + ExtraPerWait; return Task.CompletedTask; }
    }

    (TimelapseService Service, FakeCamera Camera, FakeClock Clock, List<(IReadOnlyList<string> Frames, string Output)> Renders) Make(Func<TimelapseService, Task>? onRender = null)
    {
        var cam = new FakeCamera();
        var clock = new FakeClock();
        var renders = new List<(IReadOnlyList<string>, string)>();
        TimelapseService? svc = null;
        svc = new TimelapseService(_root, () => cam,
            async (frames, plan, output, ct) =>
            {
                Assert.All(frames, f => Assert.True(File.Exists(f))); // stills still there while rendering
                renders.Add((frames.ToList(), output));
                if (onRender is not null) await onRender(svc!);
                ct.ThrowIfCancellationRequested();
                File.WriteAllText(output, "mp4");
            },
            () => clock.Now, clock.Delay);
        return (svc, cam, clock, renders);
    }

    string Out => Path.Combine(_root, "out");

    [Fact]
    public async Task Full_session_renders_every_still_then_deletes_them()
    {
        var (svc, cam, _, renders) = Make();
        var events = new List<string>();
        svc.Changed += (_, s) => events.Add(s["state"]!.GetValue<string>());
        svc.Start("demo", "demo", TimelapsePlan.Create(5, 1, 10), Out);
        await svc.Completion;

        Assert.Equal(10, cam.Shots);
        Assert.True(cam.Disposed);
        var r = Assert.Single(renders);
        Assert.Equal(10, r.Frames.Count);
        Assert.True(File.Exists(r.Output));
        Assert.False(Directory.Exists(Path.Combine(_root, "demo")));
        var status = svc.Status("demo");
        Assert.Equal("idle", status["state"]!.GetValue<string>());
        Assert.Equal(Path.GetFileName(r.Output), status["file"]!.GetValue<string>());
        Assert.Equal("recording", events[0]);
        Assert.Contains("rendering", events);
        Assert.Equal("idle", events[^1]);
        Assert.False(svc.Recording);
    }

    [Fact]
    public async Task Session_stops_at_the_12_hour_cap_and_renders_what_it_has()
    {
        var (svc, cam, clock, renders) = Make();
        clock.ExtraPerWait = TimeSpan.FromMinutes(1); // every still comes a minute late, so the plan can't finish in 12 h
        svc.Start("demo", "demo", TimelapsePlan.Create(600, 73.0 / 1, 1), Out); // 73 stills, 12 h apart from the first
        await svc.Completion;

        Assert.True(cam.Shots < 73);
        Assert.Equal(cam.Shots, Assert.Single(renders).Frames.Count);
        Assert.True(svc.Status("demo")["capReached"]!.GetValue<bool>());
        Assert.False(Directory.Exists(Path.Combine(_root, "demo")));
    }

    [Fact]
    public async Task Cancel_during_render_deletes_the_stills_and_makes_no_video()
    {
        var (svc, _, _, renders) = Make(s => { s.Cancel("demo"); return Task.CompletedTask; });
        svc.Start("demo", "demo", TimelapsePlan.Create(5, 1, 5), Out);
        await svc.Completion;

        Assert.Single(renders);
        Assert.False(File.Exists(renders[0].Output));
        Assert.False(Directory.Exists(Path.Combine(_root, "demo")));
        var status = svc.Status("demo");
        Assert.True(status["cancelled"]!.GetValue<bool>());
        Assert.Null(status["file"]);
    }

    [Fact]
    public async Task A_dead_camera_ends_the_session_with_an_error()
    {
        var (svc, cam, _, renders) = Make();
        cam.FailFrom = 3;
        svc.Start("demo", "demo", TimelapsePlan.Create(5, 2, 10), Out);
        await svc.Completion;

        Assert.Equal(3, cam.Shots);
        Assert.Equal(3, Assert.Single(renders).Frames.Count); // the 3 good stills still become a video
        Assert.Contains("camera", svc.Status("demo")["error"]!.GetValue<string>());
    }

    [Fact]
    public void Only_one_session_at_a_time_and_dispose_deletes_stills()
    {
        var cam = new FakeCamera();
        var gate = new TaskCompletionSource();
        var svc = new TimelapseService(_root, () => cam, (_, _, _, _) => Task.CompletedTask, () => DateTime.UtcNow, (_, ct) => gate.Task.WaitAsync(ct));
        svc.Start("a", "a", TimelapsePlan.Create(5, 1, 10), Out);
        Assert.Throws<TimelapseException>(() => svc.Start("b", "b", TimelapsePlan.Create(5, 1, 10), Out));
        Assert.Throws<TimelapseException>(() => svc.Start("a", "a", TimelapsePlan.Create(5, 1, 10), Out));
        svc.Dispose();
        Assert.False(Directory.Exists(Path.Combine(_root, "a")));
    }

    [Fact]
    public void PurgeLeftovers_removes_stills_from_an_earlier_run()
    {
        Directory.CreateDirectory(Path.Combine(_root, "old"));
        File.WriteAllText(Path.Combine(_root, "old", "000000.jpg"), "x");
        new TimelapseService(_root).PurgeLeftovers();
        Assert.False(Directory.Exists(Path.Combine(_root, "old")));
    }

    [Fact]
    public void Camera_permission_is_parsed_and_listed_in_the_update_review()
    {
        var before = WidgetManifest.Parse("""{ "id": "demo", "name": "Demo", "version": "1.0.0" }""");
        var after = WidgetManifest.Parse("""{ "id": "demo", "name": "Demo", "version": "1.1.0", "permissions": { "camera": true } }""");
        Assert.True(after.Permissions.Camera);
        var diff = PermissionDiff.Compute(before, after);
        Assert.False(diff.IsEmpty);
        Assert.Contains(diff.Describe(), l => l.Contains("webcam"));
        Assert.True(PermissionDiff.Compute(after, after).IsEmpty);
    }

    [Fact]
    public void Automation_cannot_reach_the_camera()
    {
        static bool CameraLike(string s) => s.Contains("camera", StringComparison.OrdinalIgnoreCase)
            || s.Contains("timelapse", StringComparison.OrdinalIgnoreCase) || s.Contains("record", StringComparison.OrdinalIgnoreCase)
            || s.Contains("webcam", StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Protocol.Commands, c => CameraLike(c.Cmd));
        Assert.DoesNotContain(McpServer.ToolNames, CameraLike);
    }

    [Fact]
    public void Tray_tooltip_puts_recording_first()
    {
        Assert.StartsWith("Umbra · Recording timelapse", Tray.Tooltip(3, true, true, true, "Recording timelapse"));
        Assert.DoesNotContain("Recording", Tray.Tooltip(3, false, false, false));
    }

    [Fact]
    public void Plan_caps_the_number_of_stills()
    {
        Assert.Throws<TimelapseException>(() => TimelapsePlan.Create(1, 3600, 30)); // 108000 stills
        Assert.Equal(TimelapsePlan.MaxFrames, TimelapsePlan.Create(1, 120, 30).Frames);
        Assert.Throws<TimelapseException>(() => TimelapsePlan.Create(1, 120.1, 30));
    }

    [Fact]
    public void Folder_label_is_the_last_segment_only()
    {
        Assert.Equal("Umbra Timelapses", TimelapseFolders.Label(Path.Combine("C:", "Users", "me", "Videos", "Umbra Timelapses") + Path.DirectorySeparatorChar));
        Assert.Equal("Videos", TimelapseFolders.Label(Path.Combine("C:", "Videos")));
    }

    [Fact]
    public async Task Status_reports_file_name_and_folder_label_only()
    {
        var (svc, _, _, _) = Make();
        svc.Start("demo", "demo", TimelapsePlan.Create(5, 1, 3), Out);
        await svc.Completion;
        var st = svc.Status("demo");
        var file = st["file"]!.GetValue<string>();
        Assert.StartsWith("Timelapse ", file);
        Assert.Equal(Path.GetFileName(file), file);
        Assert.Equal("out", st["folder"]!.GetValue<string>());
        Assert.DoesNotContain("umbra-timelapse-", st.ToJsonString());
    }

    [Fact]
    public void Start_refuses_when_the_disk_is_too_small()
    {
        var svc = new TimelapseService(_root, () => new FakeCamera(), (_, _, _, _) => Task.CompletedTask, freeBytes: _ => 10_000_000);
        Assert.Throws<TimelapseException>(() => svc.Start("demo", "demo", TimelapsePlan.Create(5, 1, 10), Out));
        Assert.Null(svc.ActiveInstance);
    }

    [Fact]
    public async Task Hiding_the_widget_pauses_and_closes_the_camera_then_resumes()
    {
        var cams = new List<FakeCamera>();
        var clock = new FakeClock();
        TimelapseService? svc = null;
        var hidden = false;
        svc = new TimelapseService(_root, () => { var c = new FakeCamera(); cams.Add(c); return c; },
            (_, _, o, _) => { File.WriteAllText(o, "x"); return Task.CompletedTask; }, () => clock.Now,
            async (d, ct) =>
            {
                // after the 2nd still the widget is hidden; it is shown again after three pause polls
                if (cams.Sum(c => c.Shots) == 2 && !hidden) { hidden = true; svc!.SetPaused("demo", true); }
                else if (hidden && d == TimelapseService.PausePoll && ++clock.Polls == 3) svc!.SetPaused("demo", false);
                await clock.Delay(d, ct);
            });
        svc.Start("demo", "demo", TimelapsePlan.Create(5, 0.5, 8), Out); // 4 stills
        await svc.Completion;
        Assert.Equal(4, cams.Sum(c => c.Shots));
        Assert.Equal(2, cams.Count);              // closed on hide, reopened on show
        Assert.All(cams, c => Assert.True(c.Disposed));
    }

    [Fact]
    public void ClickGate_accepts_only_a_fresh_left_press_outside_edit_mode()
    {
        Assert.True(ClickGate.IsLeftPress((IntPtr)((0x0201 << 16) | 1)));
        Assert.False(ClickGate.IsLeftPress((IntPtr)((0x0204 << 16) | 1))); // WM_RBUTTONDOWN
        Assert.False(ClickGate.IsLeftPress((IntPtr)((0x0207 << 16) | 1))); // WM_MBUTTONDOWN
        Assert.True(ClickGate.Allows(1000, 0, 2500, false));
        Assert.False(ClickGate.Allows(1000, 0, 3500, false));     // older than 2 s
        Assert.False(ClickGate.Allows(1000, 0, 1500, true));      // edit mode (drags, resizes)
        Assert.False(ClickGate.Allows(1000, 1200, 1500, false));  // the host menu opened after the press
        Assert.False(ClickGate.Allows(long.MinValue / 2, long.MinValue / 2, 1500, false));
    }

    static WidgetManifest CamWidget(bool camera = true) =>
        WidgetManifest.Parse($$"""{ "id": "demo", "name": "Demo", "version": "1.0.0", "permissions": { "camera": {{(camera ? "true" : "false")}} } }""");

    CameraConsent Consent(Func<bool> answer, out List<string> asked, Func<DateTime>? now = null)
    {
        var list = new List<string>();
        asked = list;
        var approvals = new CommandApprovals(Path.Combine(_root, "approvals-" + Guid.NewGuid().ToString("N") + ".json"));
        return new CameraConsent(approvals, name => { list.Add(name); return Task.FromResult(answer()); }, now);
    }

    [Fact]
    public async Task Consent_needs_the_permission_and_a_click_and_asks_once()
    {
        Directory.CreateDirectory(_root);
        var c = Consent(() => true, out var asked);
        await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(camera: false), true));
        await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(), false));
        Assert.Empty(asked); // no prompt without a click
        await c.EnsureAsync(CamWidget(), true);
        Assert.Single(asked);
        Assert.True(c.Approvals.CameraApproved("demo"));
        Assert.False(c.Approvals.CameraApproved("other"));
        Assert.Equal(1, c.Approvals.RevokeCamera("demo"));
        Assert.False(c.Approvals.CameraApproved("demo"));
    }

    [Fact]
    public async Task Consent_refusal_rate_limit_and_denial_cap()
    {
        Directory.CreateDirectory(_root);
        var t = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var c = Consent(() => false, out var asked, () => t);
        await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(), true));
        await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(), true)); // too soon: not even asked
        Assert.Single(asked);
        Assert.False(c.Approvals.CameraApproved("demo"));
        for (var i = 0; i < 2; i++) { t = t.AddMinutes(1); await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(), true)); }
        Assert.Equal(3, asked.Count);
        t = t.AddMinutes(1);
        await Assert.ThrowsAsync<TimelapseException>(() => c.EnsureAsync(CamWidget(), true));
        Assert.Equal(3, asked.Count); // three refusals: no more prompts
    }

    [Fact]
    public void Camera_approval_persists_and_is_not_listed_as_a_command()
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "ap.json");
        var a = new CommandApprovals(path);
        a.ApproveCamera("demo");
        Assert.True(new CommandApprovals(path).CameraApproved("demo"));
        Assert.Empty(a.Describe([CamWidget()]));
    }
}
