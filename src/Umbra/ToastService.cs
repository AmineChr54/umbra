using Microsoft.Win32;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

namespace Umbra;

/// <summary>
/// Shows <c>umbra.notify</c> as real Windows toasts. Toasts need an AppUserModelID: the installer's Start-menu shortcut
/// carries <see cref="InstalledAumid"/>; a portable or source run registers its own under HKCU\Software\Classes\AppUserModelId.
/// Each toast keeps its own click target and button handlers, so an old toast in Notification Center still does the right thing.
/// </summary>
sealed class ToastService
{
    /// <summary>Same value as <c>AppUserModelID</c> on the shortcut in installer/Umbra.iss.</summary>
    public const string InstalledAumid = "AmineChr54.Umbra";
    const int KeepAlive = 64;

    readonly ToastNotifier _notifier;
    // A toast's Activated handler only fires while the ToastNotification object is alive, so the recent ones are kept.
    readonly Queue<ToastNotification> _recent = new();

    ToastService(ToastNotifier notifier) => _notifier = notifier;

    /// <summary>The AUMID to use and whether Umbra must register it itself (no installer shortcut, i.e. portable or run from source).</summary>
    public static (string Aumid, bool NeedsRegistration) ChooseAumid(bool installed, string appDir) =>
        installed ? (InstalledAumid, false) : ($"{InstalledAumid}.Local.{PortableMode.Hash(appDir)}", true);

    /// <summary>A toast service, or null when Windows refuses to create one (the caller then falls back to tray balloons).</summary>
    public static ToastService? TryCreate()
    {
        try
        {
            var shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Umbra.lnk");
            var (aumid, register) = ChooseAumid(!AppPaths.IsPortable && File.Exists(shortcut), AppPaths.AppDir);
            if (register) Register(aumid);
            return new ToastService(ToastNotificationManager.CreateToastNotifier(aumid));
        }
        catch (Exception ex)
        {
            Log.Write($"Toasts unavailable, using tray balloons: {ex.Message}");
            return null;
        }
    }

    static void Register(string aumid)
    {
        using var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\AppUserModelId\{aumid}");
        key.SetValue("DisplayName", "Umbra");
        try
        {
            var icon = Path.Combine(AppPaths.DataDir, "toast-icon.ico");
            if (!File.Exists(icon))
            {
                using var src = typeof(ToastService).Assembly.GetManifestResourceStream("umbra.ico");
                if (src is not null) { using var dst = File.Create(icon); src.CopyTo(dst); }
            }
            if (File.Exists(icon)) key.SetValue("IconUri", icon);
        }
        catch (Exception ex) { Log.Write($"Toast icon not written: {ex.Message}"); }
    }

    /// <summary>
    /// Shows one toast. <paramref name="tag"/> (a widget's own, may be null) replaces that widget's earlier toast with the same tag;
    /// without one every toast stacks. <paramref name="onUrl"/> / <paramref name="onAction"/> run on a thread-pool thread. Throws if Windows rejects it.
    /// </summary>
    public void Show(string instance, string widgetName, string title, string body, string? url, string? tag,
        IReadOnlyList<NotifyAction> actions, Action<string> onUrl, Action<string> onAction)
    {
        var xml = new XmlDocument();
        xml.LoadXml(Notifier.ToastXml(widgetName, title, body, actions));
        var toast = new ToastNotification(xml)
        {
            Group = Notifier.ToastKey(instance),
            Tag = Notifier.ToastKey(tag is { Length: > 0 } ? "t:" + tag : "u:" + Guid.NewGuid()),
        };
        toast.Activated += (_, args) =>
        {
            var arg = (args as ToastActivatedEventArgs)?.Arguments ?? "";
            if (arg.StartsWith(Notifier.ActionPrefix, StringComparison.Ordinal)) onAction(arg[Notifier.ActionPrefix.Length..]);
            else if (url is not null) onUrl(url);
        };
        _notifier.Show(toast);
        _recent.Enqueue(toast);
        while (_recent.Count > KeepAlive) _recent.Dequeue();
    }
}
