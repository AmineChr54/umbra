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

    static string Read(string name) => File.ReadAllText(Path.Combine(Repo(), "settings", name));

    /// <summary>#281: a widget card has exactly one notifications control (the Default/On/Off select), no extra checkbox.</summary>
    [Fact]
    public void Widget_card_has_one_notifications_control()
    {
        var card = Regex.Match(Read("index.html"), "<template id=\"tpl-installed\">.*?</template>", RegexOptions.Singleline).Value;
        Assert.Single(Regex.Matches(card, "pw-notif\"")); // the select; its wrapper is pw-notif-l
        Assert.DoesNotContain("Allow notifications", card);
        Assert.DoesNotContain("class=\"notif\"", card);
        Assert.DoesNotContain("<input type=\"checkbox\" class=\"notif\"", card);
    }

    /// <summary>#282: host options share the .field row pattern, booleans are switches, Advanced folds the rest.</summary>
    [Fact]
    public void Card_host_options_use_one_row_pattern_and_switches()
    {
        var card = Regex.Match(Read("index.html"), "<template id=\"tpl-installed\">.*?</template>", RegexOptions.Singleline).Value;
        var host = Regex.Match(card, "<div class=\"hostopts\">.*?<div class=\"wcard-actions\">", RegexOptions.Singleline).Value;
        Assert.DoesNotContain("class=\"check", host);
        Assert.Contains("class=\"switch\"><input type=\"checkbox\" class=\"pw-hidden\"", host);
        var visible = host[..host.IndexOf("hostadv-src", StringComparison.Ordinal)];
        foreach (var keep in new[] { "Size", "Monitor", "Start hidden" }) Assert.Contains(keep, visible);
        var advanced = host[host.IndexOf("hostadv-src", StringComparison.Ordinal)..];
        foreach (var fold in new[] { "Refresh", "Opacity", "Notifications", "Show only between", "Power" }) Assert.Contains(fold, advanced);
        Assert.Contains("\"Advanced\"", Read("prefs.js"));
    }

    /// <summary>#283: the two size settings have distinct names that say what they do to existing widgets.</summary>
    [Fact]
    public void General_size_controls_have_distinct_names()
    {
        var prefs = Read("prefs.js");
        Assert.Contains("row(\"Scale all widgets\"", prefs);
        Assert.Contains("row(\"Size of new widgets\"", prefs);
        Assert.Contains("keep their size", prefs);
        Assert.DoesNotContain("row(\"Default size\"", prefs);
    }

    /// <summary>#284 and #285: one Install from menu, a quiet Refresh icon, Update all hidden (also against .btn's display) at zero.</summary>
    [Fact]
    public void Browse_groups_install_entry_points_and_hides_empty_update_all()
    {
        var html = Read("index.html");
        var hero = Regex.Match(html, "<div class=\"hero-actions\">.*?</div>", RegexOptions.Singleline).Value;
        Assert.Equal(3, Regex.Matches(hero, "<button").Count); // Submit, Install from, Refresh
        Assert.Contains("id=\"installMenu\"", hero);
        Assert.Contains("aria-label=\"Refresh the catalog\"", hero);
        Assert.DoesNotContain("id=\"installFile\"", html);
        var js = Read("settings.js");
        foreach (var kind in new[] { "kind: \"file\"", "kind: \"folder\"", "type: \"installUrl\"" }) Assert.Contains(kind, js);
        Assert.Contains("all.hidden = !n && !updatingAll;", js);
        Assert.Contains(".btn[hidden]", Read("settings.css"));
    }

    /// <summary>#286: Data and privacy shows display names (the host sends one) and disables Delete data at 0 B.</summary>
    [Fact]
    public void Privacy_rows_use_display_names_and_disable_empty_delete()
    {
        var js = Read("settings.js");
        Assert.Contains("w.name || w.widget", js);
        Assert.Contains("del.disabled = !w.data.bytes;", js);
        Assert.Contains("[\"name\"]", File.ReadAllText(Path.Combine(Repo(), "src", "Umbra.Core", "Backup.cs")));
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
