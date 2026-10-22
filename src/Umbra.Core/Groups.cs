namespace Umbra;

/// <summary>
/// Widgets that share one screen slot: only <see cref="Active"/> is shown, the others wait as tabs.
/// Members are instance ids (<see cref="InstanceId"/>). The slot is the active member's own position and size;
/// <see cref="Groups.CopySlot"/> carries it to whichever member becomes active.
/// </summary>
public sealed class WidgetGroup
{
    public string Name { get; set; } = "Group";
    public List<string> Members { get; set; } = new();
    /// <summary>The visible member; falls back to the first one when missing or stale.</summary>
    public string? Active { get; set; }
    /// <summary>Switch to the next tab every this many seconds; 0 = off.</summary>
    public int CycleSeconds { get; set; }
}

/// <summary>Pure rules for <see cref="WidgetGroup"/>s, kept apart from the windows so they can be tested.</summary>
public static class Groups
{
    public const int MaxGroups = 20, MaxMembers = 12, MinCycle = 5, MaxCycle = 3600;

    /// <summary>Whether <paramref name="name"/> is a well-formed tab icon name (the file must still exist in shared/tabicons).</summary>
    public static bool IsIconName(string? name) =>
        !string.IsNullOrEmpty(name) && name.Length <= 40 && System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9]+(-[a-z0-9]+)*$");

    /// <summary>The icon file for a chosen name, or null if it is malformed or not in the set.</summary>
    public static string? IconPath(string? name)
    {
        if (!IsIconName(name)) return null;
        var path = Path.Combine(AppPaths.AppDir, "shared", "tabicons", name + ".png");
        return File.Exists(path) ? path : null;
    }

    public static string? GroupOf(Settings s, string instance) =>
        s.Groups.FirstOrDefault(g => g.Value.Members.Contains(instance)).Key;

    /// <summary>The member that is shown, or null for an empty group.</summary>
    public static string? ActiveOf(WidgetGroup g) =>
        g.Active is not null && g.Members.Contains(g.Active) ? g.Active : g.Members.FirstOrDefault();

    /// <summary>False only for a grouped instance that is not its group's active tab.</summary>
    public static bool IsShownTab(Settings s, string instance)
    {
        var id = GroupOf(s, instance);
        return id is null || ActiveOf(s.Groups[id]) == instance;
    }

    /// <summary>Removes members that no longer exist and repairs Active. Empty groups stay (the user made them, #235). Returns true if anything changed.</summary>
    public static bool Prune(Settings s)
    {
        var changed = false;
        var seen = new HashSet<string>();
        foreach (var (id, g) in s.Groups.ToList())
        {
            var kept = g.Members.Where(m => s.Widgets.ContainsKey(m) && seen.Add(m)).Take(MaxMembers).ToList();
            if (kept.Count != g.Members.Count) { g.Members = kept; changed = true; }
            var active = ActiveOf(g);
            if (g.Active != active) { g.Active = active; changed = true; }
            var cycle = g.CycleSeconds == 0 ? 0 : Math.Clamp(g.CycleSeconds, MinCycle, MaxCycle);
            if (cycle != g.CycleSeconds) { g.CycleSeconds = cycle; changed = true; }
        }
        return changed;
    }

    /// <summary>Creates a group holding <paramref name="instance"/> (empty when null) and returns its id.</summary>
    public static string Create(Settings s, string name, string? instance = null)
    {
        if (s.Groups.Count >= MaxGroups) throw new InvalidOperationException($"At most {MaxGroups} groups");
        if (instance is not null) Leave(s, instance);
        var n = 1;
        while (s.Groups.ContainsKey("g" + n)) n++;
        var id = "g" + n;
        s.Groups[id] = instance is null
            ? new WidgetGroup { Name = CleanName(name) }
            : new WidgetGroup { Name = CleanName(name), Members = { instance }, Active = instance };
        return id;
    }

    /// <summary>Adds an instance as the last tab (leaving any other group); the slot is taken from the visible member.</summary>
    public static void Join(Settings s, string groupId, string instance)
    {
        if (!s.Groups.TryGetValue(groupId, out var g)) throw new KeyNotFoundException($"No group '{groupId}'");
        if (!s.Widgets.ContainsKey(instance)) throw new KeyNotFoundException($"No widget '{instance}'");
        if (g.Members.Contains(instance)) return;
        if (g.Members.Count >= MaxMembers) throw new InvalidOperationException($"At most {MaxMembers} widgets per group");
        Leave(s, instance);
        var slot = ActiveOf(g);
        g.Members.Add(instance);
        if (slot is not null) CopySlot(s.Widgets[slot], s.Widgets[instance]);
    }

    /// <summary>Takes an instance out of its group (it keeps the slot's position). The group stays, even when empty.</summary>
    public static void Leave(Settings s, string instance)
    {
        var id = GroupOf(s, instance);
        if (id is null) return;
        var g = s.Groups[id];
        g.Members.Remove(instance);
        g.Active = ActiveOf(g);
    }

    /// <summary>Makes a member the visible tab; the outgoing tab's position and size move to it.</summary>
    public static void Activate(Settings s, string groupId, string instance)
    {
        if (!s.Groups.TryGetValue(groupId, out var g)) throw new KeyNotFoundException($"No group '{groupId}'");
        if (!g.Members.Contains(instance)) throw new KeyNotFoundException($"'{instance}' is not in group '{g.Name}'");
        var from = ActiveOf(g);
        if (from is not null && from != instance && s.Widgets.TryGetValue(from, out var a) && s.Widgets.TryGetValue(instance, out var b))
            CopySlot(a, b);
        g.Active = instance;
    }

    /// <summary>Next (+1) or previous (-1) tab, wrapping around; returns the new active instance.</summary>
    public static string? Step(Settings s, string groupId, int direction)
    {
        if (!s.Groups.TryGetValue(groupId, out var g) || g.Members.Count == 0) return null;
        var i = Math.Max(0, g.Members.IndexOf(ActiveOf(g)!));
        var next = g.Members[((i + direction) % g.Members.Count + g.Members.Count) % g.Members.Count];
        Activate(s, groupId, next);
        return next;
    }

    /// <summary>Moves a member to a new position in the tab order.</summary>
    public static void Reorder(Settings s, string groupId, string instance, int index)
    {
        if (!s.Groups.TryGetValue(groupId, out var g) || !g.Members.Remove(instance)) throw new KeyNotFoundException("Not a member");
        g.Members.Insert(Math.Clamp(index, 0, g.Members.Count), instance);
    }

    public static string CleanName(string? name)
    {
        name = (name ?? "").Trim();
        return name.Length == 0 ? "Group" : name[..Math.Min(name.Length, 40)];
    }

    /// <summary>Copies where and how big a widget is (not its options or rules).</summary>
    public static void CopySlot(WidgetSettings from, WidgetSettings to)
    {
        to.X = from.X; to.Y = from.Y;
        to.Monitor = from.Monitor; to.RelX = from.RelX; to.RelY = from.RelY;
        to.Scale = from.Scale; to.Width = from.Width; to.Height = from.Height; to.UseDefaultScale = from.UseDefaultScale;
    }
}
