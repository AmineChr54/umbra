using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;

namespace Umbra;

/// <summary>A button on a toast; clicking it calls the widget's <c>umbra.onNotificationAction</c> with <see cref="Id"/>.</summary>
public sealed record NotifyAction(string Id, string Label);

/// <summary>
/// Rules for <c>umbra.notify</c>: a widget needs <c>permissions.notifications</c> and the user's per-widget switch, is
/// limited to <see cref="MaxPerWindow"/> notifications per <see cref="Window"/>, and the text is length-capped.
/// </summary>
public sealed class Notifier
{
    public const int MaxPerWindow = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);
    public const int MaxTitle = 80, MaxBody = 200, MaxActions = 2, MaxActionId = 40, MaxActionLabel = 30, MaxTag = 64;

    readonly Dictionary<string, Queue<DateTime>> _sent = new();

    /// <summary>True (and the attempt is recorded) when <paramref name="instance"/> may notify at <paramref name="now"/>.</summary>
    public bool TryAcquire(string instance, DateTime now)
    {
        if (!_sent.TryGetValue(instance, out var q)) _sent[instance] = q = new Queue<DateTime>();
        while (q.Count > 0 && now - q.Peek() >= Window) q.Dequeue();
        if (q.Count >= MaxPerWindow) return false;
        q.Enqueue(now);
        return true;
    }

    /// <summary>Single-line, trimmed, capped text; control characters become spaces.</summary>
    public static string Clean(string? s, int max)
    {
        s = new string((s ?? "").Select(c => char.IsControl(c) ? ' ' : c).ToArray()).Trim();
        return s.Length <= max ? s : s[..(max - 1)] + "…";
    }

    /// <summary>
    /// Reads the optional <c>actions</c> array of <c>umbra.notify</c>: up to <see cref="MaxActions"/> <c>{ id, label }</c> objects.
    /// Returns null and sets <paramref name="error"/> when it is malformed.
    /// </summary>
    public static IReadOnlyList<NotifyAction>? ParseActions(JsonNode? node, out string? error)
    {
        error = null;
        if (node is null) return [];
        if (node is not JsonArray arr) { error = "actions must be an array"; return null; }
        if (arr.Count > MaxActions) { error = $"At most {MaxActions} actions"; return null; }
        var list = new List<NotifyAction>();
        foreach (var item in arr)
        {
            var id = Clean(Str(item?["id"]), MaxActionId);
            var label = Clean(Str(item?["label"]), MaxActionLabel);
            if (id.Length == 0 || label.Length == 0) { error = "Each action needs an id and a label"; return null; }
            if (list.Any(a => a.Id == id)) { error = "Action ids must be unique"; return null; }
            list.Add(new NotifyAction(id, label));
        }
        return list;
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    /// <summary>Short stable hex name for a toast tag or group (Windows caps both at 64 characters and the widget text is free-form).</summary>
    public static string ToastKey(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)), 0, 8).ToLowerInvariant();

    /// <summary>The toast payload: title, optional body, the widget's name as attribution, up to two buttons. Text is XML-escaped by <see cref="XElement"/>.</summary>
    public static string ToastXml(string widgetName, string title, string body, IReadOnlyList<NotifyAction> actions)
    {
        var binding = new XElement("binding", new XAttribute("template", "ToastGeneric"), new XElement("text", title));
        if (body.Length > 0) binding.Add(new XElement("text", body));
        binding.Add(new XElement("text", new XAttribute("placement", "attribution"), widgetName));
        var toast = new XElement("toast", new XAttribute("launch", "open"), new XElement("visual", binding));
        if (actions.Count > 0)
            toast.Add(new XElement("actions", actions.Select(a => new XElement("action",
                new XAttribute("content", a.Label), new XAttribute("arguments", ActionPrefix + a.Id), new XAttribute("activationType", "foreground")))));
        return toast.ToString(SaveOptions.DisableFormatting);
    }

    /// <summary>Prefix of a button's <c>arguments</c>; a click on the toast body carries the toast's <c>launch</c> value instead.</summary>
    public const string ActionPrefix = "action:";
}
