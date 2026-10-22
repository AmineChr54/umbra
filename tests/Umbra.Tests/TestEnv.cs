namespace Umbra.Tests;

/// <summary>Points AppPaths at a throwaway folder so tests never touch the real %APPDATA%\Umbra.</summary>
static class TestEnv
{
    public static readonly string DataDir = Path.Combine(Path.GetTempPath(), $"umbra-tests-{Guid.NewGuid():N}");
    static TestEnv() => Environment.SetEnvironmentVariable("UMBRA_DATA_DIR", DataDir);
    public static void Init() { _ = DataDir; }
}
