namespace Umbra.Tests;

public class LogTests
{
    [Fact]
    public void Trim_keeps_newest_lines_instead_of_deleting_the_log()
    {
        var path = Path.Combine(Path.GetTempPath(), $"umbra-log-{Guid.NewGuid():N}.log");
        try
        {
            File.WriteAllLines(path, Enumerable.Range(0, 2000).Select(i => $"line {i:D5} " + new string('x', 40)));
            Log.TrimIfLarge(path, 20_000);

            var lines = File.ReadAllLines(path);
            Assert.NotEmpty(lines);
            Assert.True(new FileInfo(path).Length <= 10_000);
            Assert.Equal("line 01999 " + new string('x', 40), lines[^1]);
            Assert.All(lines, l => Assert.StartsWith("line ", l)); // no partial first line
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Trim_leaves_small_logs_alone()
    {
        var path = Path.Combine(Path.GetTempPath(), $"umbra-log-{Guid.NewGuid():N}.log");
        try
        {
            File.WriteAllText(path, "a\nb\n");
            Log.TrimIfLarge(path, 20_000);
            Assert.Equal("a\nb\n", File.ReadAllText(path));
        }
        finally { File.Delete(path); }
    }
}
