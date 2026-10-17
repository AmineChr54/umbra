using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Umbra;

/// <summary>Pure rules for the idle and Energy Saver behaviour (issue #104); no Win32.</summary>
static class PowerPolicy
{
    /// <summary>Widget intervals are stretched by this factor while Energy Saver is on.</summary>
    public const int EnergySaverFactor = 4;

    /// <summary>Interval widgets should use: stretched while Energy Saver is on and the user allows it.</summary>
    public static int Refresh(int seconds, bool energySaver, bool slowOnEnergySaver) =>
        energySaver && slowOnEnergySaver ? seconds * EnergySaverFactor : seconds;

    /// <summary>GUID_CONSOLE_DISPLAY_STATE payload: 0 = off. On (1) and dimmed (2) count as on.</summary>
    public static bool DisplayOff(int state) => state == 0;

    /// <summary>GUID_POWER_SAVING_STATUS payload: non-zero = Energy Saver is on.</summary>
    public static bool SaverOn(int state) => state != 0;

    /// <summary>Whether a session switch locks (true) or unlocks (false) the session; null for every other reason.</summary>
    public static bool? LockChange(SessionSwitchReason reason) => reason switch
    {
        SessionSwitchReason.SessionLock => true,
        SessionSwitchReason.SessionUnlock => false,
        _ => null,
    };
}

/// <summary>
/// Tracks whether the session is locked, the display is off and Energy Saver is on. Widgets pause while locked or with
/// the display off (<see cref="Paused"/>); <see cref="Changed"/> fires on the UI thread when pausing or Energy Saver changes.
/// Windows sends the current display and Energy Saver state right after registering, so no initial query is needed.
/// </summary>
sealed class PowerState : NativeWindow, IDisposable
{
    const int WM_POWERBROADCAST = 0x0218, PBT_POWERSETTINGCHANGE = 0x8013;
    static readonly Guid ConsoleDisplayState = new("6fe69556-704a-47a0-8f24-c28d936fda47");
    static readonly Guid PowerSavingStatus = new("e00958c0-c213-4ace-ac77-fecced2eeea5");

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr RegisterPowerSettingNotification(IntPtr hRecipient, ref Guid setting, uint flags);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnregisterPowerSettingNotification(IntPtr handle);

    readonly SynchronizationContext _ui;
    readonly List<IntPtr> _registrations = new();
    bool _locked, _displayOff, _energySaver;

    public bool Paused => _locked || _displayOff;
    public bool EnergySaver => _energySaver;
    public event Action? Changed;

    public PowerState(SynchronizationContext ui)
    {
        _ui = ui;
        CreateHandle(new CreateParams()); // hidden top-level window: never shown, never activated
        foreach (var guid in new[] { ConsoleDisplayState, PowerSavingStatus })
        {
            var g = guid;
            var h = RegisterPowerSettingNotification(Handle, ref g, 0);
            if (h != IntPtr.Zero) _registrations.Add(h);
            else Log.Write($"Power notification {guid} not registered (error {Marshal.GetLastWin32Error()})");
        }
        SystemEvents.SessionSwitch += OnSessionSwitch;
    }

    void OnSessionSwitch(object? s, SessionSwitchEventArgs e)
    {
        if (PowerPolicy.LockChange(e.Reason) is not bool locked) return;
        _ui.Post(_ => Set(locked: locked), null); // SystemEvents raises this on its own thread
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_POWERBROADCAST && (int)m.WParam == PBT_POWERSETTINGCHANGE && m.LParam != IntPtr.Zero)
        {
            // POWERBROADCAST_SETTING: Guid PowerSetting; uint DataLength; byte Data[]
            var guid = Marshal.PtrToStructure<Guid>(m.LParam);
            if (Marshal.ReadInt32(m.LParam, 16) >= 4)
            {
                var value = Marshal.ReadInt32(m.LParam, 20);
                if (guid == ConsoleDisplayState) Set(displayOff: PowerPolicy.DisplayOff(value));
                else if (guid == PowerSavingStatus) Set(energySaver: PowerPolicy.SaverOn(value));
            }
        }
        base.WndProc(ref m);
    }

    void Set(bool? locked = null, bool? displayOff = null, bool? energySaver = null)
    {
        var (wasPaused, wasSaver) = (Paused, _energySaver);
        _locked = locked ?? _locked;
        _displayOff = displayOff ?? _displayOff;
        _energySaver = energySaver ?? _energySaver;
        if (wasPaused == Paused && wasSaver == _energySaver) return;
        Log.Write($"Power: widgets {(Paused ? "paused" : "active")}, Energy Saver {(_energySaver ? "on" : "off")}");
        Changed?.Invoke();
    }

    public void Dispose()
    {
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        foreach (var h in _registrations) UnregisterPowerSettingNotification(h);
        _registrations.Clear();
        DestroyHandle();
    }
}
