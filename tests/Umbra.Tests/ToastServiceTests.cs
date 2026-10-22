namespace Umbra.Tests;

public class ToastServiceTests
{
    [Fact]
    public void Toasts_use_the_installed_aumid_or_a_per_folder_one()
    {
        Assert.Equal(("AmineChr54.Umbra", false), ToastService.ChooseAumid(true, @"C:\a"));
        var (a, reg) = ToastService.ChooseAumid(false, @"C:\a");
        Assert.True(reg);
        Assert.StartsWith("AmineChr54.Umbra.Local.", a);
        Assert.NotEqual(a, ToastService.ChooseAumid(false, @"C:\b").Aumid);
    }
}
