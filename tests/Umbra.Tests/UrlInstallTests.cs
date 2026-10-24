using System.IO.Compression;
using System.Net;
using System.Text;

namespace Umbra.Tests;

/// <summary>Install from URL (Community.CheckDownloadUrl / DownloadPackageAsync / PrepareUrlAsync): HTTPS only, redirect and size limits, then the file-install checks.</summary>
public class UrlInstallTests
{
    public UrlInstallTests() => TestEnv.Init();

    sealed class Fake(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.RequestUri!);
            Assert.Null(request.Headers.Authorization);
            return Task.FromResult(respond(request));
        }
    }

    static HttpResponseMessage Ok(byte[] body) => new(HttpStatusCode.OK) { Content = new ByteArrayContent(body) };

    static HttpResponseMessage Redirect(string to) => new(HttpStatusCode.Found) { Headers = { Location = new Uri(to, UriKind.RelativeOrAbsolute) } };

    static byte[] Package(string id, string permissions = "{}", params (string Name, byte[] Data)[] extra)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (n, d) in new[] { ("widget.json", Encoding.UTF8.GetBytes($$"""{ "id": "{{id}}", "name": "U {{id}}", "version": "1.0.0", "permissions": {{permissions}} }""")), ("index.html", Encoding.UTF8.GetBytes("<p/>")) }.Concat(extra))
            {
                using var s = zip.CreateEntry(n).Open();
                s.Write(d);
            }
        }
        return ms.ToArray();
    }

    [Theory]
    [InlineData("http://github.com/a/b.umbrawidget")]
    [InlineData("ftp://github.com/a/b.umbrawidget")]
    [InlineData("file:///C:/x.umbrawidget")]
    [InlineData("https://user:pw@github.com/a/b.umbrawidget")]
    [InlineData("https://127.0.0.1/a.umbrawidget")]
    [InlineData("https://[::1]/a.umbrawidget")]
    [InlineData("https://192.168.0.5/a.umbrawidget")]
    [InlineData("https://localhost/a.umbrawidget")]
    [InlineData("https://printer.local/a.umbrawidget")]
    [InlineData("https://intranet/a.umbrawidget")]
    [InlineData("https://github.com:8443/a.umbrawidget")]
    [InlineData("not a url")]
    [InlineData("")]
    public void Malicious_or_unsafe_addresses_are_refused(string url) => Assert.NotNull(Community.CheckDownloadUrl(url));

    [Fact]
    public void A_github_release_link_is_accepted() =>
        Assert.Null(Community.CheckDownloadUrl("https://github.com/AmineChr54/umbra/releases/download/v1/clock.umbrawidget"));

    [Fact]
    public async Task A_download_installs_through_the_file_checks_and_asks_for_access()
    {
        var bytes = Package("url-ok", """{ "hosts": ["api.example.com"] }""");
        var handler = new Fake(_ => Ok(bytes));
        using var p = await Community.PrepareUrlAsync("https://github.com/x/url-ok.umbrawidget", handler);
        Assert.Equal("url-ok", p.Manifest.Id);
        Assert.True(p.IsLocal);
        Assert.True(p.NeedsApproval); // never silent: declared access needs an accept
        Assert.Throws<PermissionsChangedException>(() => p.Require(false));
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, "url-ok")));
        Assert.Empty(Directory.GetFiles(Path.GetTempPath(), "umbra-dl-*"));
    }

    [Fact]
    public async Task Redirects_are_followed_a_few_times_and_each_hop_is_checked()
    {
        var bytes = Package("url-redir");
        var handler = new Fake(r => r.RequestUri!.AbsolutePath switch
        {
            "/a" => Redirect("https://objects.example.com/b"),
            "/b" => Redirect("/c"),
            _ => Ok(bytes),
        });
        using var p = await Community.PrepareUrlAsync("https://github.com/a", handler);
        Assert.Equal("url-redir", p.Manifest.Id);
        Assert.Equal(3, handler.Requests.Count);

        var toHttp = new Fake(_ => Redirect("http://evil.example.com/x.umbrawidget"));
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/a", toHttp));
        Assert.Contains("redirect", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Single(toHttp.Requests);

        var toLan = new Fake(_ => Redirect("https://10.0.0.1/x"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/a", toLan));

        var loop = new Fake(_ => Redirect("https://github.com/a"));
        var tooMany = await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/a", loop));
        Assert.Contains("redirects", tooMany.Message);
        Assert.Equal(6, loop.Requests.Count);
    }

    [Fact]
    public async Task An_oversize_download_is_refused_by_header_and_by_actual_bytes()
    {
        var big = new byte[5 * 1024 * 1024 + 10];
        var byHeader = new Fake(_ => Ok(big));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/big", byHeader));

        // No Content-Length: the stream itself is cut off at the cap.
        var chunked = new Fake(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new MemoryStream(big)) });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/big", chunked));
        Assert.Contains("5 MB", ex.Message);
        Assert.Empty(Directory.GetFiles(Path.GetTempPath(), "umbra-dl-*"));
    }

    [Fact]
    public async Task Hostile_or_broken_downloads_are_refused_and_leave_nothing()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/x", new Fake(_ => Ok(Encoding.UTF8.GetBytes("<html>not a zip</html>")))));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/x", new Fake(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));
        var slip = Package("url-slip", "{}", ("../evil.html", Encoding.UTF8.GetBytes("x")));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Community.PrepareUrlAsync("https://github.com/x.umbrawidget", new Fake(_ => Ok(slip))));
        Assert.False(Directory.Exists(Path.Combine(AppPaths.CommunityDir, "url-slip")));
        Assert.Empty(Directory.GetFiles(Path.GetTempPath(), "umbra-dl-*"));
    }

    [Fact]
    public void Confirmation_text_names_the_widget_author_and_source()
    {
        // PlainReview is what the host-drawn box shows for a widget that asks for no access.
        var id = "url-review";
        var zip = Path.Combine(Path.GetTempPath(), $"umbra-review-{Guid.NewGuid():N}.umbrawidget");
        File.WriteAllBytes(zip, Package(id));
        try
        {
            using var p = Community.PrepareLocal(zip);
            var text = PackageInstall.PlainReview(p, "https://github.com/x");
            Assert.Contains("U url-review", text);
            Assert.Contains("https://github.com/x", text);
            Assert.Contains("no access", text);
        }
        finally { File.Delete(zip); }
    }
}
