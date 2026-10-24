using System.Text.Json.Nodes;

namespace Umbra.Cli;

/// <summary>
/// umbractl dev: loads a widget folder like install-local, watches it and reloads on every change (about half a second after
/// the last save), and prints the widget's sandbox-blocked requests and errors from umbra.log as they happen.
/// Deliberately a CLI loop over existing commands (install-local, logs) with no Control/MCP counterpart: it is a long-running
/// foreground process for the person at the terminal, and an agent already has create_widget, read_logs and capture.
/// </summary>
static class DevLoop
{
    static readonly string[] Interesting = { "blocked", "error", "fail", "exception", "crash", "refused", "skipping" };

    /// <summary>Log lines about widget <paramref name="id"/> (or its copies) that are worth showing a developer.</summary>
    public static bool IsRelevant(string line, string id) =>
        (line.Contains($"[{id}]", StringComparison.Ordinal) || line.Contains($"[{id}#", StringComparison.Ordinal) || line.Contains($"widget {id}:", StringComparison.Ordinal))
        && Interesting.Any(w => line.Contains(w, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The lines of <paramref name="lines"/> that were not in <paramref name="previous"/>, for a log read as "the last N lines": the
    /// window moves forward, so the longest tail of the previous read that is also the head of this one is old. The first read
    /// (<paramref name="previous"/> null) has no new lines: history is not replayed.
    /// </summary>
    public static IReadOnlyList<string> Fresh(IReadOnlyList<string>? previous, IReadOnlyList<string> lines)
    {
        if (previous is null) return Array.Empty<string>();
        for (var k = Math.Min(previous.Count, lines.Count); k > 0; k--)
        {
            var same = true;
            for (var i = 0; i < k && same; i++) same = previous[previous.Count - k + i] == lines[i];
            if (same) return lines.Skip(k).ToList();
        }
        return lines;
    }

    public static async Task<int> RunAsync(string folder, bool acceptPermissions, Func<string, JsonObject, Task<JsonObject>> send, TextWriter output, CancellationToken ct)
    {
        folder = Path.GetFullPath(folder);
        if (!Directory.Exists(folder)) throw new ArgumentException($"'{folder}' is not a folder");
        var id = Path.GetFileName(folder.TrimEnd('\\', '/'));
        IReadOnlyList<string>? previous = null;
        var reachable = true;

        // Umbra restarting or the pipe dropping is normal while developing: report it once, keep trying.
        async Task<JsonObject?> TrySend(string cmd, JsonObject args)
        {
            try
            {
                var reply = await send(cmd, args);
                if (!reachable) { reachable = true; output.WriteLine($"{DateTime.Now:HH:mm:ss} Umbra is back"); previous = null; }
                return reply;
            }
            catch (Exception ex) when (ex is IOException or TimeoutException or InvalidOperationException)
            {
                if (reachable) output.WriteLine($"{DateTime.Now:HH:mm:ss} Umbra is not reachable ({ex.Message}); retrying");
                reachable = false;
                return null;
            }
        }

        async Task<bool> LoadAsync()
        {
            var args = new JsonObject { ["path"] = folder };
            if (acceptPermissions) args["acceptPermissions"] = true;
            var reply = await TrySend("install-local", args);
            if (reply is null) return false;
            if (reply["ok"]?.GetValue<bool>() == true) { output.WriteLine($"{DateTime.Now:HH:mm:ss} loaded {id}"); return true; }
            output.WriteLine($"{DateTime.Now:HH:mm:ss} NOT loaded: {reply["error"]?.GetValue<string>()}");
            return false;
        }

        async Task PollLogAsync()
        {
            var reply = await TrySend("logs", new JsonObject { ["lines"] = 300 });
            if (reply?["result"] is not JsonArray arr) return;
            var lines = arr.Select(n => n?.GetValue<string>() ?? "").ToList();
            foreach (var l in Fresh(previous, lines)) if (IsRelevant(l, id)) output.WriteLine(l);
            previous = lines;
        }

        await LoadAsync();
        await PollLogAsync();
        output.WriteLine($"Watching {folder} (Ctrl+C to stop)");

        var changed = new SemaphoreSlim(0, 1);
        using var watcher = new FileSystemWatcher(folder) { IncludeSubdirectories = true, EnableRaisingEvents = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.DirectoryName | NotifyFilters.Size };
        void Poke(object? s, EventArgs e) { try { changed.Release(); } catch (SemaphoreFullException) { } }
        watcher.Changed += Poke; watcher.Created += Poke; watcher.Deleted += Poke; watcher.Renamed += Poke;
        // A buffer overflow or a vanished folder may have lost events: say so and reload once.
        watcher.Error += (_, e) => { output.WriteLine($"{DateTime.Now:HH:mm:ss} file watcher error ({e.GetException().Message}); reloading"); Poke(null, EventArgs.Empty); };

        try
        {
            var needsLoad = false;
            while (!ct.IsCancellationRequested)
            {
                if (await changed.WaitAsync(1000, ct))
                {
                    await Task.Delay(400, ct); // an editor saves in bursts; reload once
                    while (changed.CurrentCount > 0) await changed.WaitAsync(0, ct);
                    needsLoad = true;
                }
                if (needsLoad && Directory.Exists(folder)) needsLoad = !await LoadAsync() && !reachable; // retry only while Umbra is down
                await PollLogAsync();
            }
        }
        catch (OperationCanceledException) { }
        return 0;
    }
}
