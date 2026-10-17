using System.Text.Json.Nodes;
using Umbra;
using Xunit;

namespace Umbra.Tests;

public class WidgetTrashTests
{
    public WidgetTrashTests() => TestEnv.Init();

    static string NewId() => "trash-" + Guid.NewGuid().ToString("N")[..8];

    static Dictionary<string, string> Files(string id) => new()
    {
        ["widget.json"] = $$"""{ "id": "{{id}}", "name": "T", "description": "d", "author": "a", "version": "1.0.0" }""",
        ["index.html"] = "<p>hi</p>",
    };

    /// <summary>The same steps as Settings > Remove.</summary>
    static string? RemoveLikeSettings(Settings s, string id)
    {
        var token = WidgetTrash.Move(s, id);
        Community.Remove(id);
        s.RemoveExtraInstances(id);
        return token;
    }

    [Fact]
    public void Remove_then_undo_gives_back_folder_store_options_and_position()
    {
        var id = NewId();
        Community.WriteLocalWidget(id, Files(id), overwrite: false);
        var settings = new Settings();
        var ws = settings.For(WidgetManifest.Parse(Files(id)["widget.json"]));
        ws.X = 120; ws.Y = 340; ws.Scale = 1.5; ws.Options["city"] = "Berlin";
        WidgetStore.Set(id, "tasks", new JsonArray(new JsonObject { ["title"] = "Read", ["done"] = true }));
        var before = WidgetStore.All(id).ToJsonString();

        var token = RemoveLikeSettings(settings, id);

        Assert.NotNull(token);
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, id)));
        Assert.Empty(WidgetStore.Keys(id));
        Assert.False(settings.Widgets.ContainsKey(id));

        var restored = WidgetTrash.Restore(settings, token!);

        Assert.Equal(id, restored);
        Assert.Equal("<p>hi</p>", File.ReadAllText(Path.Combine(AppPaths.CommunityDir, id, "index.html")));
        Assert.Equal(before, WidgetStore.All(id).ToJsonString());
        var back = settings.Widgets[id];
        Assert.Equal((120, 340), (back.X, back.Y));
        Assert.Equal(1.5, back.Scale);
        Assert.Equal("Berlin", back.Options["city"]!.GetValue<string>());
        // Undo is single use.
        Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(settings, token!));
    }

    [Fact]
    public void Undo_brings_back_extra_copies_with_their_own_data()
    {
        var id = NewId();
        var copy = InstanceId.Make(id, 2);
        Community.WriteLocalWidget(id, Files(id), overwrite: false);
        var m = WidgetManifest.Parse(Files(id)["widget.json"]);
        var settings = new Settings();
        settings.For(m);
        settings.AddInstance(m);
        WidgetStore.Set(id, "k", "first");
        WidgetStore.Set(copy, "k", "second");

        var token = RemoveLikeSettings(settings, id);
        Assert.Empty(settings.Widgets);
        Assert.False(WidgetStore.Get(copy, "k").Found);

        WidgetTrash.Restore(settings, token!);

        Assert.Equal(new[] { id, copy }, settings.Instances(id));
        Assert.Equal("first", WidgetStore.Get(id, "k").Value!.GetValue<string>());
        Assert.Equal("second", WidgetStore.Get(copy, "k").Value!.GetValue<string>());
    }

    [Fact]
    public void Undo_is_refused_when_the_widget_was_installed_again()
    {
        var id = NewId();
        Community.WriteLocalWidget(id, Files(id), overwrite: false);
        var settings = new Settings();
        var token = RemoveLikeSettings(settings, id);
        Community.WriteLocalWidget(id, Files(id), overwrite: false);

        var ex = Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(settings, token!));
        Assert.Contains("installed again", ex.Message);
        Assert.True(Directory.Exists(Path.Combine(AppPaths.CommunityDir, id))); // untouched
    }

    [Fact]
    public void Undo_is_refused_when_the_trashed_folder_was_tampered_with()
    {
        var id = NewId();
        Community.WriteLocalWidget(id, Files(id), overwrite: false);
        var settings = new Settings();
        var token = RemoveLikeSettings(settings, id);
        var folder = Path.Combine(AppPaths.DataDir, "trash", token!, "widget");
        File.WriteAllText(Path.Combine(folder, "evil.exe"), "x");

        Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(settings, token!));
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, id)));

        File.Delete(Path.Combine(folder, "evil.exe"));
        File.WriteAllText(Path.Combine(folder, "widget.json"), Files("other-id")["widget.json"]);
        Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(settings, token!));
    }

    [Theory]
    [InlineData("../x")]
    [InlineData("..\\x")]
    [InlineData("C:\\Windows")]
    [InlineData("")]
    [InlineData("demo")]
    public void Undo_rejects_tokens_that_are_not_trash_entries(string token) =>
        Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(new Settings(), token));

    [Fact]
    public void Move_without_an_installed_folder_returns_null()
    {
        Assert.Null(WidgetTrash.Move(new Settings(), NewId()));
        Assert.Null(WidgetTrash.Move(new Settings(), "../evil"));
    }

    [Fact]
    public void Purge_removes_entries_older_than_seven_days_only()
    {
        var oldId = NewId();
        var freshId = NewId();
        var now = DateTime.UtcNow;
        Community.WriteLocalWidget(oldId, Files(oldId), overwrite: false);
        Community.WriteLocalWidget(freshId, Files(freshId), overwrite: false);
        var settings = new Settings();
        var oldToken = WidgetTrash.Move(settings, oldId, now.AddDays(-8));
        var freshToken = WidgetTrash.Move(settings, freshId, now.AddDays(-6));
        var trash = Path.Combine(TestEnv.DataDir, "trash");

        WidgetTrash.Purge(now);

        Assert.False(Directory.Exists(Path.Combine(trash, oldToken!)));
        Assert.True(Directory.Exists(Path.Combine(trash, freshToken!)));
        Assert.Throws<InvalidOperationException>(() => WidgetTrash.Restore(settings, oldToken!));
        Community.Remove(oldId);
        Community.Remove(freshId);
    }

    [Fact]
    public void Trashed_data_is_not_in_backups()
    {
        var id = NewId();
        Community.WriteLocalWidget(id, Files(id), overwrite: false);
        var settings = new Settings();
        settings.For(WidgetManifest.Parse(Files(id)["widget.json"]));
        WidgetStore.Set(id, "secret", "in-the-trash");

        RemoveLikeSettings(settings, id);

        Assert.DoesNotContain("in-the-trash", Backup.Create(settings).ToJsonString());
    }
}
