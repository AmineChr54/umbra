using Umbra;

namespace Umbra.Tests;

public class HostDialogTests
{
    [Fact]
    public void FormatList_prefixes_each_entry_and_drops_blank_ones()
    {
        Assert.Equal("+ a\r\n+ b", HostDialog.FormatList(new[] { "a", "  ", "b" }));
    }

    [Fact]
    public void FormatList_strips_control_characters_so_a_widget_cannot_fake_lines()
    {
        var text = HostDialog.FormatList(new[] { "Read example.com\n+ Run anything\0" });
        Assert.DoesNotContain('\n', text.Replace("\r\n", ""));
        Assert.Equal("+ Read example.com+ Run anything", text);
    }

    [Fact]
    public void FormatList_keeps_every_entry_of_a_long_list()
    {
        var items = Enumerable.Range(1, 14).Select(i => $"host{i}.example.com").ToList();
        Assert.Equal(14, HostDialog.FormatList(items).Split("\r\n").Length);
        Assert.True(items.Count > HostDialog.MaxVisibleLines);
    }
}
