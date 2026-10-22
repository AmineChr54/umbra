using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// System-wide hotkeys through RegisterHotKey on a message-only window. Pressing one runs the action on the UI thread;
/// it never touches a widget window, so nothing is activated or takes keyboard focus.
/// </summary>
sealed class HotkeyService : NativeWindow, IDisposable
{
    const int WM_HOTKEY = 0x0312, ERROR_HOTKEY_ALREADY_REGISTERED = 1409;
    const uint MOD_NOREPEAT = 0x4000;
    static readonly IntPtr HWND_MESSAGE = new(-3);

    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    readonly Action<string> _run;
    readonly Dictionary<int, string> _ids = new();
    /// <summary>Registration failures by action (reason text); empty for actions that are off or registered.</summary>
    public Dictionary<string, string> Failures { get; } = new();

    public HotkeyService(Action<string> run)
    {
        _run = run;
        CreateHandle(new CreateParams { Parent = HWND_MESSAGE });
    }

    /// <summary>Drops every registration and registers the given combinations; failures are recorded per action.</summary>
    public void Apply(IReadOnlyDictionary<string, string> map)
    {
        foreach (var id in _ids.Keys) UnregisterHotKey(Handle, id);
        _ids.Clear();
        Failures.Clear();
        foreach (var (action, reason) in Hotkey.Validate(map)) Failures[action] = reason;
        var n = 1;
        foreach (var (action, keys) in map)
        {
            if (Failures.ContainsKey(action) || string.IsNullOrWhiteSpace(keys)) continue;
            Hotkey.TryParse(keys, out var mods, out var vk, out _);
            if (RegisterHotKey(Handle, n, mods | MOD_NOREPEAT, vk)) _ids[n++] = action;
            else
            {
                var code = Marshal.GetLastWin32Error();
                Failures[action] = code == ERROR_HOTKEY_ALREADY_REGISTERED
                    ? $"{Hotkey.Normalize(keys)} is already in use by another app"
                    : $"Windows refused {Hotkey.Normalize(keys)}: {new Win32Exception(code).Message}";
                Log.Write($"Hotkey '{action}' ({keys}) not registered: {Failures[action]}");
            }
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && _ids.TryGetValue((int)m.WParam, out var action))
        {
            try { _run(action); }
            catch (Exception ex) { Log.Write($"Hotkey '{action}' failed: {ex.Message}"); }
            return;
        }
        base.WndProc(ref m);
    }

    /// <summary>The state shared by the control protocol and the Settings page.</summary>
    public JsonArray Describe(IReadOnlyDictionary<string, string> map) => new(Hotkey.Actions.Select(a =>
    {
        map.TryGetValue(a.Id, out var keys);
        var off = string.IsNullOrWhiteSpace(keys);
        var o = new JsonObject { ["action"] = a.Id, ["label"] = a.Label, ["keys"] = off ? null : Hotkey.Normalize(keys) ?? keys };
        o["status"] = off ? "off" : Failures.ContainsKey(a.Id) ? "failed" : "active";
        if (Failures.TryGetValue(a.Id, out var why)) o["error"] = why;
        return (JsonNode?)o;
    }).ToArray());

    public void Dispose()
    {
        foreach (var id in _ids.Keys) UnregisterHotKey(Handle, id);
        _ids.Clear();
        DestroyHandle();
    }
}
