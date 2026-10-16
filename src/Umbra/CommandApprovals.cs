using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>One saved user decision: this widget may run this exact command (identified by its hash).</summary>
public sealed record CommandApproval(string WidgetId, string CommandId, string Hash, DateTime ApprovedAt);

/// <summary>
/// Which widget commands the user has approved: %APPDATA%\Umbra\approvals.json, kept apart from settings.json so the
/// Settings page's "save" can't write it. Entries are keyed by widget id + command id and bound to the command's hash.
/// Only the host UI (the approval prompt, the Settings page) calls <see cref="Approve"/>; automation can only read.
/// </summary>
sealed class CommandApprovals(string path)
{
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    static CommandApprovals? _shared;
    /// <summary>The app-wide store at the data folder.</summary>
    public static CommandApprovals Shared => _shared ??= new(Path.Combine(AppPaths.DataDir, "approvals.json"));

    readonly object _gate = new();
    List<CommandApproval>? _items;

    List<CommandApproval> Items => _items ??= Load();

    List<CommandApproval> Load()
    {
        try
        {
            if (File.Exists(path))
                return JsonSerializer.Deserialize<List<CommandApproval>>(File.ReadAllText(path), Json) ?? new();
        }
        catch (Exception ex)
        {
            // An unreadable file means no approvals: failing closed.
            Log.Write($"approvals.json unreadable, treating all commands as unapproved: {ex.Message}");
        }
        return new();
    }

    void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(Items, Json));
            File.Move(tmp, path, overwrite: true);
        }
        catch (Exception ex) { Log.Write($"Could not save approvals: {ex.Message}"); }
    }

    public IReadOnlyList<CommandApproval> List()
    {
        lock (_gate) return Items.ToList();
    }

    /// <summary>"approved" (same command as approved), "changed" (approved before, but the command differs now) or "pending".</summary>
    public string Status(string widgetId, CommandSpec spec)
    {
        lock (_gate)
        {
            var a = Items.FirstOrDefault(x => x.WidgetId == widgetId && x.CommandId == spec.Id);
            return a is null ? "pending" : string.Equals(a.Hash, spec.Hash(), StringComparison.Ordinal) ? "approved" : "changed";
        }
    }

    public bool IsApproved(string widgetId, CommandSpec spec) => Status(widgetId, spec) == "approved";

    public void Approve(string widgetId, CommandSpec spec)
    {
        lock (_gate)
        {
            Items.RemoveAll(x => x.WidgetId == widgetId && x.CommandId == spec.Id);
            Items.Add(new CommandApproval(widgetId, spec.Id, spec.Hash(), DateTime.UtcNow));
            Save();
        }
        Log.Write($"[{widgetId}] command '{spec.Id}' approved");
    }

    /// <summary>Removes one approval (commandId) or all of a widget's. Returns how many were removed.</summary>
    public int Revoke(string widgetId, string? commandId = null)
    {
        lock (_gate)
        {
            var n = Items.RemoveAll(x => x.WidgetId == widgetId && (commandId is null || x.CommandId == commandId));
            if (n > 0) Save();
            if (n > 0) Log.Write($"[{widgetId}] command approval revoked ({commandId ?? "all"})");
            return n;
        }
    }

    /// <summary>For the control protocol: every declared command of the given widgets with its approval status (read-only).</summary>
    public JsonArray Describe(IEnumerable<WidgetManifest> manifests, string? onlyWidget = null)
    {
        var list = new JsonArray();
        foreach (var m in manifests.Where(m => onlyWidget is null || m.Id == onlyWidget))
            foreach (var c in m.Permissions.Commands)
            {
                var a = List().FirstOrDefault(x => x.WidgetId == m.Id && x.CommandId == c.Id);
                list.Add(new JsonObject
                {
                    ["widget"] = m.Id,
                    ["command"] = c.Id,
                    ["run"] = c.DisplayLine(),
                    ["description"] = c.Description,
                    ["status"] = Status(m.Id, c),
                    ["approvedAt"] = a?.ApprovedAt.ToString("o"),
                });
            }
        return list;
    }
}
