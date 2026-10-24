using System.Text.Json.Nodes;

namespace Umbra.Cli;

/// <summary>
/// umbractl dev: loads a widget folder like install-local, watches it and reloads on every change (about half a second after
/// the last save), and prints the widget's sandbox-blocked requests and errors from umbra.log as they happen.
/// </summary>
static class DevLoop
{
    static readonly string[] Interesting = { "blocked", "error", "fail", "exception", "crash", "refused", "skipping" };

    /// <summary>Log lines about widget <paramref name="id"/> (or its copies) that are worth showing a developer.</summary>
    public static bool IsRelevant(string line, string id) =>
        (line.Contains($"[{id}]", StringComparison.Ordinal) || line.Contains($"[{id}#", StringComparison.Ordinal) || line.Contains($"widget {id}:", StringComparison.Ordinal))
        && Interesting.Any(w => line.Contains(w, StringComparison.OrdinalIgnoreCase));

    /// <summary>The lines after the last occurrence of <paramref name="lastSeen"/> in <paramref name="lines"/> (all of them when it is not there).</summary>
    public static IReadOnlyList<string> After(IReadOnlyList<string> lines, string? lastSeen)
    {
        if (lastSeen is null) return lines;
        for (var i = lines.Count - 1; i >= 0; i--)
            if (lines[i] == lastSeen) return lines.Skip(i + 1).ToList();
        return lines;
    }

    public static async Task<int> RunAsync(string folder, bool acceptPermissions, Func<string, JsonObject, Task<JsonObject>> send, TextWriter output, CancellationToken ct)
    {
        folder = Path.GetFullPath(folder);
        if (!Directory.Exists(folder)) throw new ArgumentException($"'{folder}' is not a folder");
        var id = Path.GetFileName(folder.TrimEnd('\\', '/'));
        string? lastSeen = null;

        async Task<bool> LoadAsync()
        {
            var args = new JsonObject { ["path"] = folder };
            if (acceptPermissions) args["acceptPermissions"] = true;
            var reply = await send("install-local", args);
            if (reply["ok"]?.GetValue<bool>() == true) { output.WriteLine($"{DateTime.Now:HH:mm:ss} loaded {id}"); return true; }
            output.WriteLine($"{DateTime.Now:HH:mm:ss} NOT loaded: {reply["error"]?.GetValue<string>()}");
            return false;
        }

        async Task PollLogAsync()
        {
            var reply = await send("logs", new JsonObject { ["lines"] = 300 });
            if (reply["result"] is not JsonArray arr) return;
            var lines = arr.Select(n => n?.GetValue<string>() ?? "").ToList();
            foreach (var l in After(lines, lastSeen)) if (IsRelevant(l, id)) output.WriteLine(l);
            if (lines.Count > 0) lastSeen = lines[^1];
        }

        await LoadAsync();
        await PollLogAsync();
        output.WriteLine($"Watching {folder} (Ctrl+C to stop)");

        var changed = new SemaphoreSlim(0, 1);
        using var watcher = new FileSystemWatcher(folder) { IncludeSubdirectories = true, EnableRaisingEvents = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.DirectoryName | NotifyFilters.Size };
        void Poke(object? s, EventArgs e) { try { changed.Release(); } catch (SemaphoreFullException) { } }
        watcher.Changed += Poke; watcher.Created += Poke; watcher.Deleted += Poke; watcher.Renamed += Poke;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (await changed.WaitAsync(1000, ct))
                {
                    await Task.Delay(400, ct); // an editor saves in bursts; reload once
                    while (changed.CurrentCount > 0) await changed.WaitAsync(0, ct);
                    await LoadAsync();
                }
                await PollLogAsync();
            }
        }
        catch (OperationCanceledException) { }
        return 0;
    }
}
