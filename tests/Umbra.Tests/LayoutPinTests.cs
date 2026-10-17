using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>Layout rename, delete with undo, and pinning to a monitor setup (#122).</summary>
public class LayoutPinTests
{
    public LayoutPinTests() => TestEnv.Init();

    static readonly MonitorInfo Laptop = new(@"\\.\DISPLAY1", new Rectangle(0, 0, 1920, 1080), new Rectangle(0, 0, 1920, 1040), true);
    static readonly MonitorInfo Left = new(@"\\.\DISPLAY2", new Rectangle(-2560, 0, 2560, 1440), new Rectangle(-2560, 0, 2560, 1400), false);
    static readonly MonitorInfo Right = new(@"\\.\DISPLAY3", new Rectangle(1920, 0, 1920, 1080), new Rectangle(1920, 0, 1920, 1040), false);

    static Settings OneWidget()
    {
        var s = new Settings();
        s.Widgets["clock"] = new WidgetSettings { X = 10, Y = 20 };
        return s;
    }

    // ---- fingerprint ----

    [Fact]
    public void Fingerprint_ignores_the_order_monitors_are_listed_in() =>
        Assert.Equal(Placement.Fingerprint(new[] { Laptop, Left, Right }), Placement.Fingerprint(new[] { Right, Laptop, Left }));

    [Fact]
    public void Fingerprint_differs_for_docked_and_undocked()
    {
        var docked = Placement.Fingerprint(new[] { Laptop, Left, Right });
        var undocked = Placement.Fingerprint(new[] { Laptop });
        Assert.NotEqual(docked, undocked);
        Assert.Equal(3, Placement.FingerprintMonitors(docked));
        Assert.Equal(1, Placement.FingerprintMonitors(undocked));
    }

    [Fact]
    public void Fingerprint_changes_with_resolution_and_arrangement()
    {
        var baseline = Placement.Fingerprint(new[] { Laptop, Right });
        Assert.NotEqual(baseline, Placement.Fingerprint(new[] { Laptop, Right with { Bounds = new Rectangle(1920, 0, 1280, 720) } }));
        Assert.NotEqual(baseline, Placement.Fingerprint(new[] { Laptop, Right with { Bounds = new Rectangle(0, -1080, 1920, 1080) } }));
        Assert.NotEqual(baseline, Placement.Fingerprint(new[] { Laptop with { Primary = false }, Right with { Primary = true } }));
    }

    [Fact]
    public void Fingerprint_ignores_the_work_area_and_name_case()
    {
        var a = Placement.Fingerprint(new[] { Laptop });
        Assert.Equal(a, Placement.Fingerprint(new[] { Laptop with { WorkArea = new Rectangle(0, 40, 1920, 1000) } }));
        Assert.Equal(a, Placement.Fingerprint(new[] { Laptop with { Name = @"\\.\display1" } }));
    }

    [Fact]
    public void Fingerprint_of_no_monitors_is_empty()
    {
        Assert.Equal("", Placement.Fingerprint(Array.Empty<MonitorInfo>()));
        Assert.Equal(0, Placement.FingerprintMonitors(""));
    }

    // ---- pins ----

    [Fact]
    public void A_layout_is_found_by_the_setup_it_is_pinned_to()
    {
        var docked = Placement.Fingerprint(new[] { Laptop, Left, Right });
        var undocked = Placement.Fingerprint(new[] { Laptop });
        var l = new Layouts();
        l.Set("Docked", OneWidget(), docked);
        l.Set("Mobile", OneWidget(), undocked);
        l.Set("Loose", OneWidget());
        Assert.Equal("Docked", l.FindPinned(docked));
        Assert.Equal("Mobile", l.FindPinned(undocked));
        Assert.Null(l.FindPinned(Placement.Fingerprint(new[] { Laptop, Right })));
        Assert.Null(l.FindPinned(""));
    }

    [Fact]
    public void When_two_layouts_share_a_setup_the_first_by_name_wins()
    {
        var l = new Layouts();
        l.Set("b", OneWidget(), "X");
        l.Set("A", OneWidget(), "X");
        Assert.Equal("A", l.FindPinned("X"));
    }

    [Fact]
    public void Saving_without_a_fingerprint_keeps_an_existing_pin()
    {
        var l = new Layouts();
        l.Set("Work", OneWidget(), "X");
        l.Set("Work", OneWidget());
        Assert.Equal("Work", l.FindPinned("X"));
    }

    [Fact]
    public void SetPin_pins_and_unpins_and_rejects_unknown_layouts()
    {
        var l = new Layouts();
        l.Set("Work", OneWidget());
        l.SetPin("work", "X");
        Assert.Equal("Work", l.FindPinned("X"));
        l.SetPin("Work", null);
        Assert.Null(l.FindPinned("X"));
        Assert.Throws<KeyNotFoundException>(() => l.SetPin("nope", "X"));
    }

    [Fact]
    public void ToJson_reports_the_pin_and_whether_it_matches_the_current_setup()
    {
        var l = new Layouts();
        l.Set("Docked", OneWidget(), Placement.Fingerprint(new[] { Laptop, Right }));
        l.Set("Loose", OneWidget());
        var now = Placement.Fingerprint(new[] { Laptop, Right });
        var rows = l.ToJson(now).Select(n => n!.AsObject()).ToDictionary(o => o["name"]!.GetValue<string>());
        Assert.True(rows["Docked"]["pinned"]!.GetValue<bool>());
        Assert.True(rows["Docked"]["matchesNow"]!.GetValue<bool>());
        Assert.Equal(2, rows["Docked"]["pinnedMonitors"]!.GetValue<int>());
        Assert.False(rows["Loose"]["pinned"]!.GetValue<bool>());
        Assert.False(rows["Loose"]["matchesNow"]!.GetValue<bool>());
        Assert.False(l.ToJson(Placement.Fingerprint(new[] { Laptop }))[0]!["matchesNow"]!.GetValue<bool>());
    }

    // ---- rename ----

    [Fact]
    public void Rename_moves_the_layout_and_keeps_its_pin()
    {
        var l = new Layouts();
        l.Set("Layout 1", OneWidget(), "X");
        l.Rename("layout 1", " Docked ");
        Assert.False(l.Items.ContainsKey("Layout 1"));
        Assert.True(l.Items.ContainsKey("Docked"));
        Assert.Equal("Docked", l.FindPinned("X"));
        Assert.Equal(1, l.Apply("Docked", OneWidget()));
    }

    [Fact]
    public void Rename_may_only_change_the_case_of_the_same_layout()
    {
        var l = new Layouts();
        l.Set("work", OneWidget());
        l.Rename("work", "Work");
        Assert.Equal("Work", Assert.Single(l.Items.Keys));
    }

    [Fact]
    public void Rename_rejects_unknown_taken_and_invalid_names()
    {
        var l = new Layouts();
        l.Set("A", OneWidget());
        l.Set("B", OneWidget());
        Assert.Throws<KeyNotFoundException>(() => l.Rename("nope", "C"));
        Assert.Throws<InvalidOperationException>(() => l.Rename("A", "b"));
        Assert.Throws<ArgumentException>(() => l.Rename("A", "../x"));
        Assert.Throws<ArgumentException>(() => l.Rename("A", "  "));
        Assert.Equal(new[] { "A", "B" }, l.Items.Keys.OrderBy(k => k));
    }

    // ---- delete and undo ----

    [Fact]
    public void Undo_brings_back_the_deleted_layout_with_its_pin()
    {
        var l = new Layouts();
        l.Set("Docked", OneWidget(), "X");
        Assert.True(l.Delete("docked"));
        Assert.Empty(l.Items);
        Assert.Null(l.FindPinned("X"));
        Assert.Equal("Docked", l.UndoDelete());
        Assert.Equal("Docked", l.FindPinned("X"));
        Assert.Null(l.UndoDelete()); // only once
    }

    [Fact]
    public void Undo_does_nothing_when_nothing_was_deleted_or_the_name_is_taken_again()
    {
        var l = new Layouts();
        Assert.Null(l.UndoDelete());
        Assert.False(l.Delete("nope"));
        l.Set("A", OneWidget());
        l.Delete("A");
        l.Set("A", OneWidget());
        Assert.Null(l.UndoDelete());
        Assert.Single(l.Items);
    }

    // ---- file ----

    [Fact]
    public void Pins_survive_a_save_and_load_and_old_files_still_load()
    {
        var l = new Layouts();
        l.Capture("Docked", OneWidget(), "X");
        l.Capture("Loose", OneWidget());
        var loaded = Layouts.Load();
        Assert.Equal("Docked", loaded.FindPinned("X"));
        Assert.Equal(2, loaded.Items.Count);

        // A layouts.json written before pins existed has no "pins" property.
        File.WriteAllText(Path.Combine(AppPaths.DataDir, "layouts.json"), """{ "items": { "Old": { "clock": { "enabled": true, "scale": 1 } } } }""");
        var old = Layouts.Load();
        Assert.Equal("Old", Assert.Single(old.Items.Keys));
        Assert.Empty(old.Pins);
        File.Delete(Path.Combine(AppPaths.DataDir, "layouts.json"));
    }
}
