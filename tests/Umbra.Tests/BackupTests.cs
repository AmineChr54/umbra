using System.Text.Json.Nodes;
using Umbra;
using Xunit;

namespace Umbra.Tests;

public class BackupTests
{
    static string Doc(string settings = "{}", string data = "{}") =>
        "{\"format\":\"umbra-backup\",\"version\":1,\"settings\":" + settings + ",\"data\":" + data + "}";

    [Fact]
    public void Parses_valid_backup_and_clamps_values()
    {
        var p = Backup.Parse(Doc("{\"general\":{\"refreshSeconds\":1,\"theme\":\"../x\"},\"widgets\":{\"abc\":{\"scale\":99}}}", "{\"abc\":{\"k\":1}}"));
        Assert.Equal(30, p.Settings.General.RefreshSeconds);
        Assert.Equal(Theme.DefaultId, p.Settings.General.Theme);
        Assert.Equal(3.0, p.Settings.Widgets["abc"].Scale);
        Assert.Equal(1, p.Data["abc"]["k"]!.GetValue<int>());
    }

    [Theory]
    [InlineData("{\"format\":\"other\",\"version\":1,\"settings\":{}}")]
    [InlineData("{\"format\":\"umbra-backup\",\"version\":99,\"settings\":{}}")]
    [InlineData("{\"format\":\"umbra-backup\",\"version\":1}")]
    [InlineData("not json")]
    public void Rejects_bad_files(string text) => Assert.Throws<InvalidDataException>(() => Backup.Parse(text));

    [Fact]
    public void Rejects_path_like_ids()
    {
        Assert.Throws<InvalidDataException>(() => Backup.Parse(Doc("{\"widgets\":{\"../x\":{}}}")));
        Assert.Throws<InvalidDataException>(() => Backup.Parse(Doc("{}", "{\"../x\":{}}")));
    }

    [Fact]
    public void Rejects_oversized_data()
    {
        var big = new string('x', WidgetStore.MaxBytes + 10);
        Assert.Throws<InvalidDataException>(() => Backup.Parse(Doc("{}", "{\"abc\":{\"k\":\"" + big + "\"}}")));
    }

    [Fact]
    public void Backup_never_carries_approvals()
    {
        var text = Backup.Create(new Settings()).ToJsonString();
        Assert.DoesNotContain("approv", text, StringComparison.OrdinalIgnoreCase);
    }
}
