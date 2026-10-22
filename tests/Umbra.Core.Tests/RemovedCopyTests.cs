using System.Text.Json.Nodes;

namespace Umbra.Tests;

public class RemovedCopyTests
{
    public RemovedCopyTests() => TestEnv.Init();

    static WidgetManifest Manifest() => WidgetManifest.Parse("""{ "id": "demo", "name": "Demo" }""");

    [Fact]
    public void Restore_puts_the_settings_object_back_with_its_position_and_options()
    {
        var m = Manifest();
        var s = new Settings();
        s.For(m);
        var two = s.AddInstance(m)!;
        s.For(m, two).X = 40;
        s.For(m, two).Locked = true;
        var removed = new RemovedCopy(two, "Demo (2)", s.Widgets[two], new JsonObject { ["k"] = 1 });
        s.Widgets.Remove(two);

        Assert.True(removed.CanRestore(s));
        removed.Restore(s);

        Assert.Equal(new[] { "demo", "demo#2" }, s.Instances("demo"));
        Assert.Equal(40, s.For(m, two).X);
        Assert.True(s.For(m, two).Locked);
    }

    [Fact]
    public void Cannot_restore_once_the_number_was_reused()
    {
        var m = Manifest();
        var s = new Settings();
        s.For(m);
        var two = s.AddInstance(m)!;
        var removed = new RemovedCopy(two, "Demo (2)", s.Widgets[two], new JsonObject());
        s.Widgets.Remove(two);
        Assert.Equal(two, s.AddInstance(m)); // a new copy took "demo#2"

        Assert.False(removed.CanRestore(s));
        Assert.Throws<InvalidOperationException>(() => removed.Restore(s));
    }

    [Fact]
    public void Cannot_restore_past_the_copy_limit_or_a_first_copy()
    {
        var m = Manifest();
        var s = new Settings();
        s.For(m);
        var two = s.AddInstance(m)!;
        var removed = new RemovedCopy(two, "Demo (2)", s.Widgets[two], new JsonObject());
        s.Widgets.Remove(two);
        Assert.True(removed.CanRestore(s));
        for (var n = 3; s.Instances("demo").Count < InstanceId.MaxInstances; n++) s.Widgets[InstanceId.Make("demo", n)] = new WidgetSettings();
        Assert.False(removed.CanRestore(s)); // demo#2 would be one copy too many

        var first = new RemovedCopy("demo", "Demo", new WidgetSettings(), new JsonObject());
        Assert.False(first.CanRestore(new Settings()));
    }

    [Fact]
    public void Stored_data_survives_remove_and_replace()
    {
        WidgetStore.Set("demo#2", "note", "hello");
        var data = WidgetStore.All("demo#2");
        WidgetStore.Delete("demo#2");
        Assert.Empty(WidgetStore.Keys("demo#2"));

        WidgetStore.Replace("demo#2", data);
        Assert.Equal("hello", WidgetStore.Get("demo#2", "note").Value!.GetValue<string>());
        WidgetStore.Delete("demo#2");
    }
}
