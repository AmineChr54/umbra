using System.Text.Json;
using System.Text.Json.Nodes;

namespace Umbra;

/// <summary>
/// Validation and effects of the Appearance, Advanced and per-widget settings (issues #61, #65, #66).
/// Pure helpers plus <see cref="Configure"/>, which pushes the general settings into the static pieces
/// (log level, developer mode, proxy) that are read outside <see cref="App"/>.
/// </summary>
static class Prefs
{
    public static readonly string[] CornerRadii = { "default", "sharp", "round" };
    public static readonly string[] AnimationSpeeds = { "normal", "calm", "off" };
    public static readonly string[] LogLevels = { "errors", "normal", "verbose" };
    public const int MaxStartupDelay = 300;
    public const double MinOpacity = 0.2;

    /// <summary>Developer mode: widget windows get devtools and a context menu (reaches windows opened after the change).</summary>
    public static bool DeveloperMode { get; private set; }
    /// <summary>Normalised proxy setting: "system", "none" or an http(s) URL; used by HTTP clients created after startup.</summary>
    public static string Proxy { get; private set; } = "system";

    public static void Configure(GeneralSettings g)
    {
        Log.Level = Pick(g.LogLevel, LogLevels, "normal");
        DeveloperMode = g.DeveloperMode;
        Proxy = TryParseProxy(g.Proxy, out var p, out _) ? p : "system";
    }

    static string Pick(string? v, string[] allowed, string fallback)
    {
        v = v?.Trim().ToLowerInvariant();
        return v is not null && allowed.Contains(v) ? v : fallback;
    }

    /// <summary>"system", "none", or a manual proxy "http(s)://host[:port]" (no credentials, path or query). Returns the normalised value.</summary>
    public static bool TryParseProxy(string? value, out string normalized, out string error)
    {
        normalized = "system"; error = "";
        var v = value?.Trim() ?? "";
        if (v.Length == 0 || v.Equals("system", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("none", StringComparison.OrdinalIgnoreCase)) { normalized = "none"; return true; }
        if (!v.Contains("://")) v = "https://" + v;
        if (!Uri.TryCreate(v, UriKind.Absolute, out var u) || u.Scheme is not ("https" or "http")
            || u.Host.Length == 0 || u.UserInfo.Length > 0 || u.AbsolutePath != "/" || u.Query.Length > 0 || u.Fragment.Length > 0)
        {
            error = "proxy must be \"system\", \"none\" or a host like https://proxy.example:8080 (no credentials or path)";
            return false;
        }
        normalized = u.GetLeftPart(UriPartial.Authority);
        return true;
    }

    /// <summary>Handler for the host's own HTTP clients (fetchJson, catalog, update check) honouring the proxy setting.</summary>
    public static HttpMessageHandler CreateHandler() => Proxy switch
    {
        "system" => new SocketsHttpHandler { Proxy = System.Net.WebRequest.GetSystemWebProxy(), UseProxy = true },
        "none" => new SocketsHttpHandler { UseProxy = false },
        _ => new SocketsHttpHandler { Proxy = new System.Net.WebProxy(Proxy), UseProxy = true },
    };

    /// <summary>Extra Chromium switches for the WebView2 environment, or null for none.</summary>
    public static string? WebViewArguments(GeneralSettings g)
    {
        var args = new List<string>();
        if (!g.HardwareAcceleration) args.Add("--disable-gpu");
        if (TryParseProxy(g.Proxy, out var p, out _))
        {
            if (p == "none") args.Add("--no-proxy-server");
            else if (p != "system") args.Add($"--proxy-server={p}");
        }
        return args.Count == 0 ? null : string.Join(' ', args);
    }

    /// <summary>The :root rule for the Appearance options (empty when all are default); applied after the theme.</summary>
    public static string AppearanceCss(GeneralSettings g)
    {
        var parts = new List<string>();
        switch (Pick(g.CornerRadius, CornerRadii, "default"))
        {
            case "sharp": parts.Add("--radius-s:2px;--radius-m:3px;--radius-l:4px;"); break;
            case "round": parts.Add("--radius-s:14px;--radius-m:20px;--radius-l:28px;"); break;
        }
        if (Pick(g.AnimationSpeed, AnimationSpeeds, "normal") == "calm") parts.Add("--motion-scale:2;");
        return parts.Count == 0 ? "" : ":root{" + string.Concat(parts) + "}";
    }

    /// <summary>Whether widgets should animate at all (the legacy switch and the speed "off").</summary>
    public static bool MotionOn(GeneralSettings g) => g.Animations && Pick(g.AnimationSpeed, AnimationSpeeds, "normal") != "off";

    public static int StartupDelay(GeneralSettings g) => Math.Clamp(g.StartupDelaySeconds, 0, MaxStartupDelay);

    public static int EffectiveRefresh(WidgetSettings ws, GeneralSettings g) => ws.RefreshSeconds ?? g.RefreshSeconds;

    public static double ClampOpacity(double v) => double.IsFinite(v) ? Math.Round(Math.Clamp(v, MinOpacity, 1.0), 2) : 1.0;

    /// <summary>Applies the appearance/advanced fields of a set-general call; throws <see cref="CommandException"/> on bad values.</summary>
    public static void ApplyGeneral(JsonObject a, GeneralSettings g)
    {
        if (a["cornerRadius"] is JsonNode cr) g.CornerRadius = OneOf(cr, "cornerRadius", CornerRadii);
        if (a["animationSpeed"] is JsonNode asp) g.AnimationSpeed = OneOf(asp, "animationSpeed", AnimationSpeeds);
        if (a["defaultScale"] is JsonNode ds) g.DefaultScale = WidgetSettings.ClampScale(Num(ds, "defaultScale"));
        if (a["logLevel"] is JsonNode ll) g.LogLevel = OneOf(ll, "logLevel", LogLevels);
        if (a["developerMode"] is JsonNode dm) g.DeveloperMode = Flag(dm, "developerMode");
        if (a["hardwareAcceleration"] is JsonNode ha) g.HardwareAcceleration = Flag(ha, "hardwareAcceleration");
        if (a["startupDelaySeconds"] is JsonNode sd)
        {
            var n = Num(sd, "startupDelaySeconds");
            if (n < 0 || n > MaxStartupDelay || n != Math.Floor(n)) throw new Control.CommandException($"startupDelaySeconds must be a whole number from 0 to {MaxStartupDelay}");
            g.StartupDelaySeconds = (int)n;
        }
        if (a["proxy"] is JsonNode px)
        {
            if (px.GetValueKind() != JsonValueKind.String) throw new Control.CommandException("\"proxy\" must be a string");
            if (!TryParseProxy(px.GetValue<string>(), out var norm, out var err)) throw new Control.CommandException(err);
            g.Proxy = norm;
        }
    }

    /// <summary>Applies per-widget refreshSeconds (null clears the override) and opacity (null or 1 = opaque).</summary>
    public static void ApplyWidget(JsonObject a, WidgetSettings ws)
    {
        if (a.ContainsKey("refreshSeconds"))
        {
            if (a["refreshSeconds"] is null) ws.RefreshSeconds = null;
            else
            {
                var n = Num(a["refreshSeconds"]!, "refreshSeconds");
                if (n < 30 || n > 600 || n != Math.Floor(n)) throw new Control.CommandException("refreshSeconds must be between 30 and 600 (null = use the global interval)");
                ws.RefreshSeconds = (int)n;
            }
        }
        if (a.ContainsKey("opacity"))
        {
            if (a["opacity"] is null) ws.Opacity = null;
            else
            {
                var n = Num(a["opacity"]!, "opacity");
                if (n < MinOpacity || n > 1) throw new Control.CommandException($"opacity must be between {MinOpacity} and 1");
                ws.Opacity = n >= 1 ? null : Math.Round(n, 2);
            }
        }
    }

    static string OneOf(JsonNode n, string name, string[] allowed)
    {
        var s = n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>().Trim().ToLowerInvariant() : "";
        return allowed.Contains(s) ? s : throw new Control.CommandException($"{name} must be one of: {string.Join(", ", allowed)}");
    }

    static bool Flag(JsonNode n, string name) =>
        n.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? n.GetValue<bool>() : throw new Control.CommandException($"\"{name}\" must be true or false");

    static double Num(JsonNode n, string name) =>
        n.GetValueKind() == JsonValueKind.Number ? n.GetValue<double>() : throw new Control.CommandException($"\"{name}\" must be a number");
}
