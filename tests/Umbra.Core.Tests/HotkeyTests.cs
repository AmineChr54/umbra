extern alias cli;

using CommandLine = cli::Umbra.Cli.CommandLine;

namespace Umbra.Tests;

public class HotkeyTests
{
    [Theory]
    [InlineData("ctrl+alt+e", "Ctrl+Alt+E")]
    [InlineData("Shift+Control+F5", "Ctrl+Shift+F5")]
    [InlineData("win+Space", "Win+Space")]
    [InlineData("Alt+pagedown", "Alt+PageDown")]
    [InlineData("Ctrl+1", "Ctrl+1")]
    public void Valid_combinations_are_normalized(string input, string expected) =>
        Assert.Equal(expected, Hotkey.Normalize(input));

    [Theory]
    [InlineData("")]
    [InlineData("E")]
    [InlineData("Shift+E")]
    [InlineData("Ctrl+Alt")]
    [InlineData("Ctrl+A+B")]
    [InlineData("Ctrl+F25")]
    [InlineData("Ctrl+Nope")]
    public void Invalid_combinations_are_rejected(string input) =>
        Assert.Null(Hotkey.Normalize(input));

    [Fact]
    public void Parse_gives_modifiers_and_virtual_key()
    {
        Assert.True(Hotkey.TryParse("Ctrl+Alt+E", out var m, out var vk, out _));
        Assert.Equal(Hotkey.Ctrl | Hotkey.Alt, m);
        Assert.Equal((uint)'E', vk);
        Assert.True(Hotkey.TryParse("Ctrl+F1", out _, out vk, out _));
        Assert.Equal(0x70u, vk);
    }

    [Fact]
    public void Duplicates_unknown_actions_and_bad_keys_are_reported()
    {
        var p = Hotkey.Validate(new Dictionary<string, string>
        {
            ["edit-mode"] = "Ctrl+Alt+E", ["refresh-all"] = "ctrl+alt+e", ["open-settings"] = "E", ["nope"] = "Ctrl+Alt+X", ["toggle-widgets"] = "",
        });
        Assert.DoesNotContain("edit-mode", p.Keys);
        Assert.Contains("refresh-all", p.Keys);
        Assert.Contains("open-settings", p.Keys);
        Assert.Contains("nope", p.Keys);
        Assert.DoesNotContain("toggle-widgets", p.Keys);
    }

    [Fact]
    public async Task Cli_maps_hotkeys_commands()
    {
        var (cmd, a) = await CommandLine.TranslateAsync(new[] { "hotkeys" }, (_, _) => Task.FromResult(new System.Text.Json.Nodes.JsonObject()));
        Assert.Equal("hotkeys", cmd);
        Assert.Empty(a);
        (_, a) = await CommandLine.TranslateAsync(new[] { "hotkeys", "edit-mode", "Ctrl+Alt+E" }, (_, _) => Task.FromResult(new System.Text.Json.Nodes.JsonObject()));
        Assert.Equal("edit-mode", (string?)a["action"]);
        Assert.Equal("Ctrl+Alt+E", (string?)a["keys"]);
        (_, a) = await CommandLine.TranslateAsync(new[] { "hotkeys", "edit-mode", "off" }, (_, _) => Task.FromResult(new System.Text.Json.Nodes.JsonObject()));
        Assert.Equal("", (string?)a["keys"]);
    }
}
