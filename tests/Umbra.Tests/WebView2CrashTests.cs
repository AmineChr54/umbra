using Microsoft.Web.WebView2.Core;

namespace Umbra.Tests;

public class WebView2CrashTests
{
    [Fact]
    public void A_hung_renderer_is_only_logged_a_dead_one_reloads()
    {
        Assert.Equal(CrashReaction.Ignore, WebView2Crash.Classify(CoreWebView2ProcessFailedKind.RenderProcessUnresponsive));
        Assert.Equal(CrashReaction.Reload, WebView2Crash.Classify(CoreWebView2ProcessFailedKind.RenderProcessExited));
        Assert.Equal(CrashReaction.RecreateBrowser, WebView2Crash.Classify(CoreWebView2ProcessFailedKind.BrowserProcessExited));
    }
}
