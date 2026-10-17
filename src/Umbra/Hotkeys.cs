using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>A key combination such as "Ctrl+Alt+E": pure parsing, formatting and conflict checks (no Win32).</summary>
public static class Hotkey
{
    public const uint Alt = 0x1, Ctrl = 0x2, Shift = 0x4, Win = 0x8;

    /// <summary>The actions that can have a hotkey, with their labels.</summary>
    public static readonly (string Id, string Label)[] Actions =
    {
        ("edit-mode", "Toggle edit mode"),
        ("refresh-all", "Refresh all widgets"),
        ("toggle-widgets", "Show or hide all widgets"),
        ("open-settings", "Open Settings"),
    };

    public static bool IsAction(string id) => Actions.Any(a => a.Id == id);

    static readonly Dictionary<string, uint> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Space"] = 0x20, ["Enter"] = 0x0D, ["Tab"] = 0x09, ["Backspace"] = 0x08, ["Insert"] = 0x2D, ["Delete"] = 0x2E,
        ["Home"] = 0x24, ["End"] = 0x23, ["PageUp"] = 0x21, ["PageDown"] = 0x22,
        ["Left"] = 0x25, ["Up"] = 0x26, ["Right"] = 0x27, ["Down"] = 0x28,
    };

    /// <summary>
    /// Parses "Ctrl+Alt+E" (case-insensitive, any order, "Control"/"Cmd"/"Windows" accepted) into modifiers and a virtual key.
    /// A hotkey needs a main key (A-Z, 0-9, F1-F24 or a named key) and at least one of Ctrl, Alt or Win, so it can't hijack typing.
    /// </summary>
    public static bool TryParse(string? text, out uint modifiers, out uint vk, out string error)
    {
        modifiers = 0; vk = 0; error = "";
        if (string.IsNullOrWhiteSpace(text)) { error = "Empty key combination"; return false; }
        foreach (var raw in text.Split('+', StringSplitOptions.TrimEntries))
        {
            var t = raw.ToLowerInvariant();
            uint mod = t switch
            {
                "ctrl" or "control" => Ctrl, "alt" => Alt, "shift" => Shift, "win" or "windows" or "cmd" or "meta" => Win, _ => 0,
            };
            if (mod != 0) { modifiers |= mod; continue; }
            if (vk != 0) { error = "Only one main key is allowed"; return false; }
            if (t.Length == 1 && t[0] is >= 'a' and <= 'z') vk = (uint)char.ToUpperInvariant(t[0]);
            else if (t.Length == 1 && t[0] is >= '0' and <= '9') vk = t[0];
            else if (t.Length is 2 or 3 && t[0] == 'f' && int.TryParse(t.AsSpan(1), out var f) && f is >= 1 and <= 24) vk = (uint)(0x6F + f);
            else if (Named.TryGetValue(t, out var n)) vk = n;
            else { error = $"Unknown key '{raw}'"; return false; }
        }
        if (vk == 0) { error = "Add a main key, e.g. Ctrl+Alt+E"; return false; }
        if ((modifiers & (Ctrl | Alt | Win)) == 0) { error = "Use at least one of Ctrl, Alt or Win"; return false; }
        return true;
    }

    /// <summary>Canonical text for a valid combination (Ctrl+Alt+Shift+Win+Key), or null when invalid.</summary>
    public static string? Normalize(string? text)
    {
        if (!TryParse(text, out var m, out var vk, out _)) return null;
        var parts = new List<string>();
        if ((m & Ctrl) != 0) parts.Add("Ctrl");
        if ((m & Alt) != 0) parts.Add("Alt");
        if ((m & Shift) != 0) parts.Add("Shift");
        if ((m & Win) != 0) parts.Add("Win");
        if (vk is >= 0x70 and <= 0x87) parts.Add($"F{vk - 0x6F}");
        else if (Named.Where(kv => kv.Value == vk).Select(kv => kv.Key).FirstOrDefault() is { } name) parts.Add(name);
        else parts.Add(((char)vk).ToString());
        return string.Join('+', parts);
    }

    /// <summary>Checks a map of action to combination: unknown actions, invalid combinations and two actions sharing one. Returns the problems by action.</summary>
    public static Dictionary<string, string> Validate(IReadOnlyDictionary<string, string> map)
    {
        var problems = new Dictionary<string, string>();
        var seen = new Dictionary<string, string>();
        foreach (var (action, keys) in map)
        {
            if (!IsAction(action)) { problems[action] = "Unknown action"; continue; }
            if (string.IsNullOrWhiteSpace(keys)) continue;
            var norm = Normalize(keys);
            if (norm is null) { TryParse(keys, out _, out _, out var err); problems[action] = err; continue; }
            if (seen.TryGetValue(norm, out var other)) problems[action] = $"{norm} is already used by '{other}'";
            else seen[norm] = action;
        }
        return problems;
    }
}

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
