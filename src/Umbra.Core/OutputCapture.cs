using System.Text;

namespace Umbra;

/// <summary>
/// Capped, drained copy of a child's output stream: keeps at most <paramref name="max"/> bytes and keeps reading after that,
/// so the child never blocks on a full pipe. <see cref="Truncated"/> says whether anything was dropped.
/// </summary>
sealed class OutputCapture(int max)
{
    readonly MemoryStream _buf = new();
    readonly object _gate = new();
    public bool Truncated { get; private set; }

    /// <summary>Reads <paramref name="s"/> to its end.</summary>
    public async Task PumpAsync(Stream s)
    {
        var chunk = new byte[8192];
        int n;
        try
        {
            while ((n = await s.ReadAsync(chunk)) > 0) Add(chunk, n);
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    void Add(byte[] chunk, int n)
    {
        lock (_gate)
        {
            var room = max - (int)_buf.Length;
            if (room > 0) _buf.Write(chunk, 0, Math.Min(room, n));
            if (n > room) Truncated = true;
        }
    }

    /// <summary>What was kept, decoded as UTF-8 (a multi-byte character cut at the cap shows as a replacement character).</summary>
    public string Text()
    {
        lock (_gate) return Encoding.UTF8.GetString(_buf.GetBuffer(), 0, (int)_buf.Length);
    }
}
