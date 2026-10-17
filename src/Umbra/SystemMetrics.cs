using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Read-only machine totals for <c>umbra.system()</c>: CPU load, memory and network throughput. Numbers only: no process,
/// adapter or user names. A widget gets only the kinds it declared in <c>permissions.system</c>.
/// </summary>
public static class SystemMetrics
{
    public static readonly string[] Kinds = ["cpu", "memory", "network"];

    /// <summary>Throws when the list holds anything but the known kinds.</summary>
    public static void Validate(IEnumerable<string> kinds)
    {
        foreach (var k in kinds)
            if (!Kinds.Contains(k)) throw new InvalidOperationException($"permissions.system: unknown metric '{k}' (allowed: {string.Join(", ", Kinds)})");
    }

    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Lo, Hi; public readonly ulong Value => ((ulong)Hi << 32) | Lo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MemoryStatus
    {
        public uint Length, MemoryLoad;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MemoryStatus s);

    static readonly object Gate = new();
    static ulong _idle, _total;
    static long _cpuAt, _netAt, _bytesIn, _bytesOut;
    static double _cpu, _down, _up;

    /// <summary>Samples at most twice a second, shared by all widgets, so rates stay meaningful whoever asks.</summary>
    public static JsonObject Read(IReadOnlyCollection<string> allowed)
    {
        var o = new JsonObject();
        lock (Gate)
        {
            if (allowed.Contains("cpu")) o["cpu"] = new JsonObject { ["percent"] = Math.Round(Cpu(), 1) };
            if (allowed.Contains("memory"))
            {
                var s = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
                if (GlobalMemoryStatusEx(ref s))
                    o["memory"] = new JsonObject
                    {
                        ["totalBytes"] = (long)s.TotalPhys,
                        ["usedBytes"] = (long)(s.TotalPhys - s.AvailPhys),
                        ["percent"] = (int)s.MemoryLoad,
                    };
            }
            if (allowed.Contains("network"))
            {
                Net();
                o["network"] = new JsonObject { ["downBytesPerSec"] = (long)_down, ["upBytesPerSec"] = (long)_up };
            }
        }
        return o;
    }

    static double Cpu()
    {
        var now = Environment.TickCount64;
        if (now - _cpuAt < 500 && _cpuAt != 0) return _cpu;
        if (!GetSystemTimes(out var i, out var k, out var u)) return _cpu;
        var idle = i.Value; var total = k.Value + u.Value; // kernel time includes idle
        if (_cpuAt != 0 && total > _total)
            _cpu = Math.Clamp(100.0 * (1.0 - (double)(idle - _idle) / (total - _total)), 0, 100);
        _idle = idle; _total = total; _cpuAt = now;
        return _cpu;
    }

    static void Net()
    {
        var now = Environment.TickCount64;
        if (now - _netAt < 500 && _netAt != 0) return;
        long rx = 0, tx = 0;
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var st = n.GetIPStatistics();
                rx += st.BytesReceived; tx += st.BytesSent;
            }
        }
        catch (Exception ex) { Log.Write($"system metrics: network read failed: {ex.Message}"); }
        if (_netAt != 0 && now > _netAt && rx >= _bytesIn && tx >= _bytesOut)
        {
            var secs = (now - _netAt) / 1000.0;
            _down = (rx - _bytesIn) / secs; _up = (tx - _bytesOut) / secs;
        }
        _bytesIn = rx; _bytesOut = tx; _netAt = now;
    }
}
