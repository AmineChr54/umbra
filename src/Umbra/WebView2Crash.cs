using Microsoft.Web.WebView2.Core;

namespace Umbra;

/// <summary>Maps <c>CoreWebView2.ProcessFailed</c> kinds onto the shared <see cref="CrashRecovery"/> policy.</summary>
static class WebView2Crash
{
    public static CrashReaction Classify(CoreWebView2ProcessFailedKind kind) => kind switch
    {
        CoreWebView2ProcessFailedKind.RenderProcessExited => CrashReaction.Reload,
        CoreWebView2ProcessFailedKind.BrowserProcessExited => CrashReaction.RecreateBrowser,
        _ => CrashReaction.Ignore,
    };
}
