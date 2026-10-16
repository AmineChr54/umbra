using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Network access for widgets. Pages can't call third-party APIs directly (CORS), so they ask the
/// host, which only fetches HTTPS URLs whose host is listed in the widget's manifest.
/// </summary>
static class Fetcher
{
    static readonly HttpClient Http = CreateClient();

    static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Umbra/1.0");
        c.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return c;
    }

    public static async Task<JsonNode?> GetJsonAsync(string url)
    {
        // Debug hook to test the widget's offline state: UMBRA_SIMULATE_OFFLINE=1
        if (Environment.GetEnvironmentVariable("UMBRA_SIMULATE_OFFLINE") == "1")
            throw new HttpRequestException("Simulated offline");

        using var resp = await Http.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        var text = await resp.Content.ReadAsStringAsync();
        return JsonNode.Parse(text);
    }
}
