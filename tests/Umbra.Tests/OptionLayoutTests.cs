using System.Text.Json;
using Xunit;
using Umbra;

namespace Umbra.Tests;

/// <summary>The optional <c>group</c>/<c>advanced</c> option flags that fold options in Settings (#231).</summary>
public class OptionLayoutTests
{
    static string M(string option) =>
        $$"""{ "id": "w", "name": "W", "options": { "a": { "label": "A", "type": "text" }, "b": {{option}} } }""";

    [Theory]
    [InlineData("""{ "label": "B", "type": "number", "group": "Adjustments" }""")]
    [InlineData("""{ "label": "B", "type": "toggle", "advanced": true }""")]
    [InlineData("""{ "label": "B", "type": "toggle", "advanced": false, "group": "Quiet hours" }""")]
    public void AcceptsGroupAndAdvanced(string option)
    {
        var m = WidgetManifest.Parse(M(option));
        Assert.Equal(new[] { "a", "b" }, m.OptionOrder);
    }

    [Theory]
    [InlineData("""{ "label": "B", "type": "text", "group": "" }""")]
    [InlineData("""{ "label": "B", "type": "text", "group": "   " }""")]
    [InlineData("""{ "label": "B", "type": "text", "group": 3 }""")]
    [InlineData("""{ "label": "B", "type": "text", "group": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }""")]
    [InlineData("""{ "label": "B", "type": "text", "advanced": "yes" }""")]
    [InlineData("""{ "label": "B", "type": "text", "advanced": 1 }""")]
    [InlineData("""{ "label": "B", "type": "text", "advanced": null }""")]
    public void RejectsBadValues(string option) =>
        Assert.Throws<JsonException>(() => WidgetManifest.Parse(M(option)));
}
