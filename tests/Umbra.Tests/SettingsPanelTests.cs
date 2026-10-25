using System.Text.RegularExpressions;
using Xunit;

namespace Umbra.Tests;

public class SettingsPanelTests
{
    static string Repo()
    {
        var root = AppContext.BaseDirectory;
        while (root is not null && !File.Exists(Path.Combine(root, "Umbra.slnx"))) root = Path.GetDirectoryName(root);
        Assert.NotNull(root);
        return root!;
    }

    /// <summary>Ctrl+1..7 in settings.js picks the Nth sidebar button, so the sidebar must list the pages in the host's order.</summary>
    [Fact]
    public void Sidebar_order_matches_pages_so_ctrl_number_shortcuts_line_up()
    {
        var html = File.ReadAllText(Path.Combine(Repo(), "settings", "index.html"));
        var nav = Regex.Match(html, "<nav class=\"nav\".*?</nav>", RegexOptions.Singleline).Value;
        var pages = Regex.Matches(nav, "data-page=\"(\\w+)\"").Select(m => m.Groups[1].Value).ToArray();
        Assert.Equal(SettingsWindow.Pages, pages);
        Assert.True(pages.Length <= 9, "Ctrl+1..9 is all the shortcut covers");
    }

    /// <summary>The first-run welcome dialog is an accessible modal with 3 slides.</summary>
    [Fact]
    public void Welcome_dialog_is_a_modal_with_three_slides()
    {
        var html = File.ReadAllText(Path.Combine(Repo(), "settings", "index.html"));
        Assert.Contains("id=\"welcome\"", html);
        Assert.Contains("role=\"dialog\" aria-modal=\"true\"", html);
        var js = File.ReadAllText(Path.Combine(Repo(), "settings", "settings.js"));
        var slides = Regex.Match(js, @"const WELCOME = \[.*?\n\];", RegexOptions.Singleline).Value;
        Assert.Equal(3, Regex.Matches(slides, @"\btitle:").Count);
    }

    /// <summary>The Esc shortcut in the page asks the host to close the window.</summary>
    [Fact]
    public void Page_posts_close_and_host_handles_it()
    {
        var root = Repo();
        Assert.Contains("type: \"close\"", File.ReadAllText(Path.Combine(root, "settings", "settings.js")));
        Assert.Contains("case \"close\":", File.ReadAllText(Path.Combine(root, "src", "Umbra", "SettingsWindow.cs")));
    }
}
