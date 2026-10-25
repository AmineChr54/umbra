namespace Umbra.Tests;

/// <summary>Needs shared/tabicons next to the binary, which only the host test output has (Core.Tests runs without it).</summary>
public class TabIconDiskTests
{
    [Fact]
    public void Real_bundled_icons_resolve_on_disk()
    {
        Assert.NotNull(Groups.CleanSuggestion("rocket"));
        Assert.Null(Groups.CleanSuggestion("definitely-not-an-icon"));
    }
}
