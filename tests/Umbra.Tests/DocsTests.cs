using System.Text.RegularExpressions;

namespace Umbra.Tests;

/// <summary>The developer docs (docs/widgets) must not rot: every relative link and every widget they point at must exist.</summary>
public class DocsTests
{
    static string Root()
    {
        var root = AppContext.BaseDirectory;
        while (root is not null && !File.Exists(Path.Combine(root, "Umbra.slnx"))) root = Path.GetDirectoryName(root);
        return root ?? throw new InvalidOperationException("repo root not found");
    }

    [Fact]
    public void Relative_links_in_the_developer_docs_resolve()
    {
        var root = Root();
        var files = Directory.GetFiles(Path.Combine(root, "docs", "widgets"), "*.md").Append(Path.Combine(root, "docs", "widget-sdk.md")).ToList();
        Assert.True(files.Count >= 4);
        var broken = new List<string>();
        foreach (var file in files)
            foreach (Match m in Regex.Matches(File.ReadAllText(file), @"\]\((?!https?:|#|mailto:)([^)\s#]+)(#[^)]*)?\)"))
            {
                var target = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, m.Groups[1].Value));
                if (!File.Exists(target) && !Directory.Exists(target)) broken.Add($"{Path.GetFileName(file)} -> {m.Groups[1].Value}");
            }
        Assert.True(broken.Count == 0, "Broken links: " + string.Join(", ", broken));
    }

    [Fact]
    public void The_cookbook_names_only_widgets_that_exist_and_covers_the_planned_recipes()
    {
        var root = Root();
        var text = File.ReadAllText(Path.Combine(root, "docs", "widgets", "cookbook.md"));
        var ids = Regex.Matches(text, @"widgets/([a-z0-9-]+)\)").Select(m => m.Groups[1].Value).Distinct().ToList();
        foreach (var id in new[] { "weather", "fx-rates", "crypto", "prayer-times", "internships", "pomodoro", "script-runner", "now-playing", "sp500", "minesweeper", "solitaire" })
            Assert.Contains(id, ids);
        foreach (var id in ids) Assert.True(File.Exists(Path.Combine(root, "widgets", id, "widget.json")), $"widgets/{id} does not exist");
    }
}
