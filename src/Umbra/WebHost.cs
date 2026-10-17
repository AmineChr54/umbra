using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Umbra;

/// <summary>Shared WebView2 environment + common hardening for every Umbra web surface.</summary>
static class WebHost
{
    /// <summary>App files: shared/, settings/, built-in widgets/.</summary>
    public const string Host = "umbra.local";
    /// <summary>Installed community widgets (%APPDATA%\Umbra\widgets).</summary>
    public const string CommunityHost = "community.umbra.local";

    public static string Url(string relative) => $"https://{Host}/{relative.TrimStart('/')}";
    public static string CommunityUrl(string relative) => $"https://{CommunityHost}/{relative.TrimStart('/')}";

    static Task<CoreWebView2Environment>? _env;

    public static Task<CoreWebView2Environment> Environment() =>
        _env ??= CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewDataDir,
            new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = Prefs.WebViewArguments(WebSettings) });

    /// <summary>Set by App before the first WebView2 is created (hardware acceleration and proxy are read once).</summary>
    public static GeneralSettings WebSettings { get; set; } = new();

    public static bool RuntimeInstalled()
    {
        try { return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()); }
        catch { return false; }
    }

    static bool IsLocal(string uri) =>
        uri.StartsWith($"https://{Host}/", StringComparison.OrdinalIgnoreCase)
        || uri.StartsWith($"https://{CommunityHost}/", StringComparison.OrdinalIgnoreCase);

    /// <param name="sandbox">
    /// For widget pages: every request that is not to an Umbra virtual host or to a host the widget
    /// declared in widget.json is answered with 403, so a widget cannot talk to undeclared servers.
    /// </param>
    public static async Task InitAsync(WebView2 view, WidgetManifest? sandbox = null)
    {
        await view.EnsureCoreWebView2Async(await Environment());
        var core = view.CoreWebView2;
        var s = core.Settings;
        s.AreDevToolsEnabled = System.Diagnostics.Debugger.IsAttached || (sandbox is not null && Prefs.DeveloperMode);
        // Widget pages raise ContextMenuRequested, and WidgetWindow answers it with the host-drawn menu (Handled), so
        // the Edge menu itself never shows. Settings keeps the default menus off.
        s.AreDefaultContextMenusEnabled = sandbox is not null;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;

        core.SetVirtualHostNameToFolderMapping(Host, AppPaths.AppDir, CoreWebView2HostResourceAccessKind.Allow);
        core.SetVirtualHostNameToFolderMapping(CommunityHost, AppPaths.CommunityDir, CoreWebView2HostResourceAccessKind.Allow);

        // Top-level pages may only be Umbra's own; links open in the user's browser instead.
        core.NavigationStarting += (_, e) =>
        {
            if (!IsLocal(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); }
        };
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };

        if (sandbox is not null)
        {
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) =>
            {
                var uri = e.Request.Uri;
                if (IsLocal(uri) || uri.StartsWith("data:") || uri.StartsWith("blob:")) return;
                if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme == "https" && sandbox.AllowsHost(u.Host)) return;
                e.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked by Umbra sandbox", "");
                Log.Write($"[{sandbox.Id}] sandbox blocked {uri}");
            };
        }
    }

    public static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http")) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { Log.Write($"Open URL failed: {ex.Message}"); }
    }
}
