using System.IO.Pipes;

namespace Umbra;

/// <summary>
/// One Umbra per user session. A second launch (e.g. from the Start menu) sends "settings"
/// over a named pipe to the running instance, which then opens its Settings window.
/// </summary>
sealed class SingleInstance : IDisposable
{
    static readonly string Id = $"Umbra-{Environment.UserName}";
    readonly Mutex _mutex;
    readonly CancellationTokenSource _cts = new();

    public bool IsFirst { get; }

    public SingleInstance()
    {
        _mutex = new Mutex(true, $@"Local\{Id}", out var created);
        IsFirst = created;
    }

    public static void SignalFirst(string message)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", Id, PipeDirection.Out);
            client.Connect(2000);
            using var w = new StreamWriter(client);
            w.WriteLine(message);
        }
        catch (Exception ex)
        {
            Log.Write($"Could not reach running instance: {ex.Message}");
        }
    }

    public void Listen(Action<string> onMessage)
    {
        _ = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(Id, PipeDirection.In, 1);
                    await server.WaitForConnectionAsync(_cts.Token);
                    using var r = new StreamReader(server);
                    var line = await r.ReadLineAsync(_cts.Token);
                    if (!string.IsNullOrEmpty(line)) onMessage(line);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { Log.Write($"Pipe error: {ex.Message}"); await Task.Delay(500); }
            }
        });
    }

    public void Dispose()
    {
        _cts.Cancel();
        if (IsFirst) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}
