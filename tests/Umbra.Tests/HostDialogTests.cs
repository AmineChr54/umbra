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

    [Fact]
    public void Second_dialog_is_refused_while_one_is_open()
    {
        Assert.True(DialogGuard.TryEnter());
        try
        {
            Assert.False(DialogGuard.TryEnter());
            Assert.False(HostDialog.Confirm(null, "second")); // refused without showing anything
        }
        finally { DialogGuard.Exit(); }
        Assert.True(DialogGuard.TryEnter());
        DialogGuard.Exit();
    }

    [Fact]
    public void Cap_removes_control_characters_and_truncates()
    {
        Assert.Equal("aaaaa...", HostDialog.Cap("a\0aaaaaa", 5));
        Assert.DoesNotContain('\0', HostDialog.Cap("x\0y", 10));
    }

    [Fact]
    public void Enter_and_Esc_both_mean_No_and_an_ownerless_box_is_topmost()
    {
        using var d = new HostDialog("Umbra", "Allow?", new[] { "a" }, null, "Yes", "No", hasOwner: false);
        Assert.Same(d.AcceptButton, d.CancelButton);
        Assert.Equal(DialogResult.No, ((Button)d.CancelButton!).DialogResult);
        Assert.True(d.TopMost);
        Assert.True(d.ShowInTaskbar);
    }
}
