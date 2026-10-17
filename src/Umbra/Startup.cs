using Microsoft.Win32;

namespace Umbra;

/// <summary>"Start with Windows" (off in portable mode) = a value under HKCU\...\Run. The installer writes the same value.</summary>
static class Startup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string ValueName = "Umbra";

    static string Command => $"\"{AppPaths.ExePath}\" --background";

    public static bool IsEnabled()
    {
        if (AppPaths.IsPortable) return false;
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string s && s.Length > 0;
    }

    public static void Set(bool enabled)
    {
        if (AppPaths.IsPortable) return; // portable copies never write to the registry
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue(ValueName, Command);
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
