using Microsoft.Web.WebView2.Core;

namespace Umbra.Tests;

public class CrashRecoveryTests
{
    [Fact]
    public void A_hung_renderer_is_only_logged_a_dead_one_reloads()
    {
        Assert.Equal(CrashReaction.Ignore, CrashRecovery.Classify(CoreWebView2ProcessFailedKind.RenderProcessUnresponsive));
        Assert.Equal(CrashReaction.Reload, CrashRecovery.Classify(CoreWebView2ProcessFailedKind.RenderProcessExited));
        Assert.Equal(CrashReaction.RecreateBrowser, CrashRecovery.Classify(CoreWebView2ProcessFailedKind.BrowserProcessExited));
    }

    [Fact]
    public void Only_host_written_log_lines_count_as_crashes()
    {
        var real = "2026-01-02 03:04:05  [todo] widget process failed: RenderProcessExited (Crashed, exit code 1)";
        Assert.Matches(CrashRecovery.LogLine, real);
        Assert.Equal("todo", CrashRecovery.LogLine.Match(real).Groups[1].Value);
        // A widget-controlled string inside another line must not forge one.
        Assert.DoesNotMatch(CrashRecovery.LogLine, "2026-01-02 03:04:05  [evil] notify: [todo] widget process failed: x");
        Assert.DoesNotMatch(CrashRecovery.LogLine, "[todo] widget process failed: x");
    }
}
