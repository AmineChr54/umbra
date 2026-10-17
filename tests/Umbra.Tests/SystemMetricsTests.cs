namespace Umbra.Tests;

public class SystemMetricsTests
{
    [Fact]
    public void Manifest_accepts_known_kinds_and_rejects_others()
    {
        var ok = WidgetManifest.Parse("""{ "id": "mon", "name": "M", "permissions": { "system": ["cpu", "memory", "network"] } }""");
        Assert.Equal(3, ok.Permissions.System.Count);
        Assert.Throws<InvalidOperationException>(() =>
            WidgetManifest.Parse("""{ "id": "mon", "name": "M", "permissions": { "system": ["processes"] } }"""));
    }

    [Fact]
    public void Read_returns_only_declared_kinds_as_numbers()
    {
        var o = SystemMetrics.Read(["cpu", "memory"]);
        Assert.Null(o["network"]);
        Assert.InRange(o["cpu"]!["percent"]!.GetValue<double>(), 0, 100);
        var mem = o["memory"]!;
        Assert.True(mem["totalBytes"]!.GetValue<long>() >= mem["usedBytes"]!.GetValue<long>());
        Assert.Empty(SystemMetrics.Read([]));
    }
}
