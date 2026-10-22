using System.IO.Pipes;

namespace Umbra;

/// <summary>
/// One Umbra per user session. The first instance serves the control pipe (see <see cref="Protocol"/>):
/// a second launch sends "settings" so the running copy opens its Settings window, and umbractl,
/// the MCP server and tests send JSON commands. The pipe only accepts the current Windows user.
/// </summary>
sealed class SingleInstance : IDisposable
{
    readonly Mutex _mutex;
    readonly CancellationTokenSource _cts = new();

    /// <summary>How long a restarted Umbra waits for the previous instance to exit.</summary>
    public static readonly TimeSpan RestartWait = TimeSpan.FromSeconds(15);

    public bool IsFirst { get; }

    /// <param name="waitForPrevious">A restart: wait (up to <see cref="RestartWait"/>) for the old instance to exit instead of treating it as a second launch.</param>
    public SingleInstance(bool waitForPrevious = false)
    {
        _mutex = new Mutex(true, $@"Local\{Protocol.PipeName}", out var created);
        if (!created && waitForPrevious)
        {
            try { created = _mutex.WaitOne(RestartWait); }
            catch (AbandonedMutexException) { created = true; } // the old instance died without releasing it; ours now
        }
        IsFirst = created;
    }

    public static void SignalFirst(string message)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", Protocol.PipeName, PipeDirection.Out);
            client.Connect(2000);
            using var w = new StreamWriter(client);
            w.WriteLine(message);
        }
        catch (Exception ex)
        {
            Log.Write($"Could not reach running instance: {ex.Message}");
        }
    }

    /// <param name="onLine">Handles one request line; a non-null result is written back as the reply.</param>
    public void Listen(Func<string, Task<string?>> onLine)
    {
        _ = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                NamedPipeServerStream? server = null;
                try
                {
                    server = new NamedPipeServerStream(Protocol.PipeName, PipeDirection.InOut,
                        NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await server.WaitForConnectionAsync(_cts.Token);
                    // Serve each client on its own task so a slow command (capture, install) never blocks the next one.
                    _ = Serve(server, onLine);
                }
                catch (OperationCanceledException) { server?.Dispose(); break; }
                catch (Exception ex) { server?.Dispose(); Log.Write($"Pipe error: {ex.Message}"); await Task.Delay(500); }
            }
        });
    }

    async Task Serve(NamedPipeServerStream server, Func<string, Task<string?>> onLine)
    {
        await using (server)
        {
            try
            {
                using var reader = new StreamReader(server, leaveOpen: true);
                var line = await reader.ReadLineAsync(_cts.Token);
                if (string.IsNullOrEmpty(line)) return;
                var reply = await onLine(line);
                if (reply is null) return;
                await using var writer = new StreamWriter(server, leaveOpen: true) { AutoFlush = true };
                await writer.WriteLineAsync(reply.AsMemory(), _cts.Token);
                if (OperatingSystem.IsWindows()) server.WaitForPipeDrain();
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or ObjectDisposedException)
            {
                // Client went away; nothing to do.
            }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        if (IsFirst) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}
