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
    /// <summary>Interface fonts (plain family names, so they are safe inside the generated :root rule).</summary>
    public static readonly string[] Fonts = { "default", "Segoe UI", "Arial", "Verdana", "Tahoma", "Georgia", "Consolas" };
    public const double MinFontScale = 0.8, MaxFontScale = 1.4;

    /// <summary>Border color for widget windows as COLORREF, or DWMWA_COLOR_NONE when the border is off. Set by <see cref="Configure"/>.</summary>
    public static int BorderColorRef { get; private set; } = Native.ColorRef(38, 40, 46);

    /// <summary>Developer mode: widget windows get devtools and a context menu (reaches windows opened after the change).</summary>
    public static bool DeveloperMode { get; private set; }
    /// <summary>Normalised proxy setting: "system", "none" or an http(s) URL; used by HTTP clients created after startup.</summary>
    public static string Proxy { get; private set; } = "system";

    public static void Configure(GeneralSettings g)
    {
        Log.Level = Pick(g.LogLevel, LogLevels, "normal");
        DeveloperMode = g.DeveloperMode;
        Proxy = TryParseProxy(g.Proxy, out var p, out _) ? p : "system";
        BorderColorRef = !g.BorderEnabled ? Native.DWMWA_COLOR_NONE
            : TryColor(g.BorderColor, out var bc) && TryHex(bc, out var rgb) ? Native.ColorRef(rgb.r, rgb.g, rgb.b) : Native.ColorRef(38, 40, 46);
    }

    /// <summary>Accepts "#rrggbb" or "#rgb" (also without #); returns "#rrggbb" in lower case. "" is valid and means unset.</summary>
    public static bool TryColor(string? value, out string normalized)
    {
        normalized = "";
        var v = (value ?? "").Trim().TrimStart('#').ToLowerInvariant();
        if (v.Length == 0) return true;
        if (v.Length == 3) v = string.Concat(v.Select(c => new string(c, 2)));
        if (v.Length != 6 || !v.All(Uri.IsHexDigit)) return false;
        normalized = "#" + v;
        return true;
    }

    static bool TryHex(string c, out (byte r, byte g, byte b) rgb)
    {
        rgb = default;
        if (c.Length != 7 || c[0] != '#' || !c.Skip(1).All(Uri.IsHexDigit)) return false;
        rgb = (Convert.ToByte(c[1..3], 16), Convert.ToByte(c[3..5], 16), Convert.ToByte(c[5..7], 16));
        return true;
    }

    /// <summary>Whether a widget with these rules may be visible right now. Unparseable fields are ignored (fail open).</summary>
    public static bool RulesAllow(ShowRules? r, TimeSpan now, bool onAc, Func<string, bool> monitorPresent)
    {
        if (r is null) return true;
        if (TimeSpan.TryParseExact(r.From, "hh\\:mm", null, out var from) && TimeSpan.TryParseExact(r.To, "hh\\:mm", null, out var to) && from != to)
        {
            var inside = from < to ? now >= from && now < to : now >= from || now < to;
            if (!inside) return false;
        }
        if (r.OnAc is bool ac && ac != onAc) return false;
        if (!string.IsNullOrWhiteSpace(r.Monitor) && !monitorPresent(r.Monitor)) return false;
        return true;
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

    /// <summary>Accent value that follows the Windows accent color (stored in <see cref="GeneralSettings.Accent"/>).</summary>
    public const string WindowsAccentValue = "windows";
    /// <summary>Lowest relative luminance an accent may have on true black (about 4.5:1 contrast).</summary>
    const double MinAccentLuminance = 0.18;

    /// <summary>"#rrggbb" accent and its stronger variant.</summary>
    public readonly record struct AccentPair(string Accent, string Strong);

    /// <summary>The current Windows accent, kept up to date by <see cref="App"/>; null when unavailable.</summary>
    public static AccentPair? SystemAccent { get; set; }

    public static bool IsWindowsAccent(string? value) => string.Equals(value?.Trim(), WindowsAccentValue, StringComparison.OrdinalIgnoreCase);

    /// <summary>Lightens the Windows accent (and AccentLight2 as the strong variant) until it is readable on black.</summary>
    public static AccentPair FromWindows((byte r, byte g, byte b) accent, (byte r, byte g, byte b) light2)
    {
        var a = Readable(accent);
        var s = Readable(light2);
        if (Luminance(s) <= Luminance(a)) s = Mix(a, 0.25);
        return new AccentPair(Hex(a), Hex(s));
    }

    static (byte r, byte g, byte b) Readable((byte r, byte g, byte b) c)
    {
        for (var i = 0; i < 20 && Luminance(c) < MinAccentLuminance; i++) c = Mix(c, 0.1);
        return c;
    }

    /// <summary>Blends a color toward white by <paramref name="t"/> (0-1).</summary>
    static (byte r, byte g, byte b) Mix((byte r, byte g, byte b) c, double t) =>
        ((byte)Math.Round(c.r + (255 - c.r) * t), (byte)Math.Round(c.g + (255 - c.g) * t), (byte)Math.Round(c.b + (255 - c.b) * t));

    static string Hex((byte r, byte g, byte b) c) => $"#{c.r:x2}{c.g:x2}{c.b:x2}";

    /// <summary>WCAG relative luminance, 0 (black) to 1 (white).</summary>
    static double Luminance((byte r, byte g, byte b) c)
    {
        static double Lin(byte v) { var x = v / 255.0; return x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4); }
        return 0.2126 * Lin(c.r) + 0.7152 * Lin(c.g) + 0.0722 * Lin(c.b);
    }

    /// <summary>The accent in effect as "#rrggbb" ("" = follow the theme): the picked color, or the Windows one in that mode.</summary>
    public static string ResolveAccent(GeneralSettings g, AccentPair? system) =>
        TryResolveAccent(g, system, out var accent, out _) ? accent : "";

    static bool TryResolveAccent(GeneralSettings g, AccentPair? system, out string accent, out string strong)
    {
        accent = strong = "";
        if (IsWindowsAccent(g.Accent))
        {
            if (system is not { } s) return false;
            (accent, strong) = (s.Accent, s.Strong);
            return true;
        }
        if (!TryColor(g.Accent, out var c) || c.Length == 0 || !TryHex(c, out var rgb)) return false;
        accent = c;
        strong = Hex(Mix(rgb, 0.25));
        return true;
    }

    /// <summary>Only the accent tokens of <see cref="AppearanceCss(GeneralSettings)"/>, for the Settings window (empty = follow the theme).</summary>
    public static string AccentCss(GeneralSettings g)
    {
        if (!TryResolveAccent(g, SystemAccent, out var accent, out var strong) || !TryHex(accent, out var rgb)) return "";
        return $":root{{--accent:{accent};--accent-strong:{strong};--accent-soft:rgba({rgb.r},{rgb.g},{rgb.b},0.14);}}";
    }

    /// <summary>The :root rule for the Appearance options (empty when all are default); applied after the theme.</summary>
    public static string AppearanceCss(GeneralSettings g) => AppearanceCss(g, SystemAccent);

    public static string AppearanceCss(GeneralSettings g, AccentPair? system)
    {
        var parts = new List<string>();
        switch (Pick(g.CornerRadius, CornerRadii, "default"))
        {
            case "sharp": parts.Add("--radius-s:2px;--radius-m:3px;--radius-l:4px;"); break;
            case "round": parts.Add("--radius-s:14px;--radius-m:20px;--radius-l:28px;"); break;
        }
        if (Pick(g.AnimationSpeed, AnimationSpeeds, "normal") == "calm") parts.Add("--motion-scale:2;");
        var font = Fonts.FirstOrDefault(f => f.Equals(g.UiFont, StringComparison.OrdinalIgnoreCase));
        if (font is not null && font != "default") parts.Add($"--font:{font},system-ui,sans-serif;--font-display:{font},system-ui,sans-serif;");
        if (double.IsFinite(g.FontScale) && Math.Abs(g.FontScale - 1) > 0.001)
            parts.Add("--font-scale:" + Math.Clamp(g.FontScale, MinFontScale, MaxFontScale).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + ";");
        if (g.LightText) parts.Add("--text:#ffffff;--text-2:#d6d9e0;--text-3:#a3a8b4;");
        var rgb = (r: (byte)139, g: (byte)147, b: (byte)255);
        if (TryResolveAccent(g, system, out var accent, out var strong) && TryHex(accent, out rgb))
        {
            parts.Add($"--accent:{accent};--accent-strong:{strong};");
            if (!g.ReduceTransparency) parts.Add($"--accent-soft:rgba({rgb.r},{rgb.g},{rgb.b},0.14);");
        }
        if (g.ReduceTransparency)
        {
            var dim = "#" + string.Concat(new[] { rgb.r, rgb.g, rgb.b }.Select(c => ((int)Math.Round(c * 0.14)).ToString("x2")));
            parts.Add($"--line:#202227;--line-strong:#33363d;--accent-soft:{dim};");
        }
        return parts.Count == 0 ? "" : ":root{" + string.Concat(parts) + "}";
    }

    /// <summary>Whether widgets should animate at all (the legacy switch and the speed "off").</summary>
    public static bool MotionOn(GeneralSettings g) => g.Animations && Pick(g.AnimationSpeed, AnimationSpeeds, "normal") != "off";

    public static int StartupDelay(GeneralSettings g) => Math.Clamp(g.StartupDelaySeconds, 0, MaxStartupDelay);

    public static int EffectiveRefresh(WidgetSettings ws, GeneralSettings g) => ws.RefreshSeconds ?? g.RefreshSeconds;

    public static double ClampOpacity(double v, bool reduceTransparency = false) => reduceTransparency ? 1.0 : double.IsFinite(v) ? Math.Round(Math.Clamp(v, MinOpacity, 1.0), 2) : 1.0;

    /// <summary>Applies the appearance/advanced fields of a set-general call; throws <see cref="CommandException"/> on bad values.</summary>
    public static void ApplyGeneral(JsonObject a, GeneralSettings g)
    {
        if (a["cornerRadius"] is JsonNode cr) g.CornerRadius = OneOf(cr, "cornerRadius", CornerRadii);
        if (a["animationSpeed"] is JsonNode asp) g.AnimationSpeed = OneOf(asp, "animationSpeed", AnimationSpeeds);
        if (a["defaultScale"] is JsonNode ds) g.DefaultScale = WidgetSettings.ClampScale(Num(ds, "defaultScale"));
        if (a["logLevel"] is JsonNode ll) g.LogLevel = OneOf(ll, "logLevel", LogLevels);
        if (a["borderEnabled"] is JsonNode be) g.BorderEnabled = Flag(be, "borderEnabled");
        if (a["borderColor"] is JsonNode bc) g.BorderColor = Color(bc, "borderColor");
        if (a["accent"] is JsonNode ac) g.Accent = Accent(ac);
        if (a["lightText"] is JsonNode lt) g.LightText = Flag(lt, "lightText");
        if (a["reduceTransparency"] is JsonNode rt) g.ReduceTransparency = Flag(rt, "reduceTransparency");
        if (a["uiFont"] is JsonNode uf)
        {
            var f = uf.GetValueKind() == JsonValueKind.String ? Fonts.FirstOrDefault(x => x.Equals(uf.GetValue<string>().Trim(), StringComparison.OrdinalIgnoreCase)) : null;
            g.UiFont = f ?? throw new Control.CommandException($"uiFont must be one of: {string.Join(", ", Fonts)}");
        }
        if (a["fontScale"] is JsonNode fs)
        {
            var n = Num(fs, "fontScale");
            if (n < MinFontScale || n > MaxFontScale) throw new Control.CommandException($"fontScale must be between {MinFontScale} and {MaxFontScale}");
            g.FontScale = Math.Round(n, 2);
        }
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
        if (a["startHidden"] is JsonNode sh) ws.StartHidden = Flag(sh, "startHidden");
        if (a.ContainsKey("showWhen"))
        {
            if (a["showWhen"] is null) ws.ShowWhen = null;
            else if (a["showWhen"] is JsonObject o)
            {
                var r = new ShowRules();
                if (o["from"] is JsonNode f) r.From = Clock(f, "from");
                if (o["to"] is JsonNode t) r.To = Clock(t, "to");
                if ((r.From is null) != (r.To is null)) throw new Control.CommandException("showWhen needs both from and to (or neither)");
                if (o["onAc"] is JsonNode ac) r.OnAc = Flag(ac, "onAc");
                if (o["monitor"] is JsonNode m)
                {
                    if (m.GetValueKind() != JsonValueKind.String || m.GetValue<string>().Length > 64) throw new Control.CommandException("showWhen.monitor must be a monitor device name");
                    var mv = m.GetValue<string>().Trim();
                    r.Monitor = mv.Length == 0 ? null : mv;
                }
                ws.ShowWhen = r.From is null && r.OnAc is null && r.Monitor is null ? null : r;
            }
            else throw new Control.CommandException("\"showWhen\" must be an object {from?, to?, onAc?, monitor?} or null");
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

    static string Color(JsonNode n, string name) =>
        n.GetValueKind() == JsonValueKind.String && TryColor(n.GetValue<string>(), out var c) ? c : throw new Control.CommandException($"\"{name}\" must be a color like #8b93ff (empty = default)");

    /// <summary>A "#rrggbb" color, "" (follow the theme) or "windows" (follow the Windows accent color).</summary>
    static string Accent(JsonNode n)
    {
        if (n.GetValueKind() == JsonValueKind.String)
        {
            var s = n.GetValue<string>();
            if (IsWindowsAccent(s)) return WindowsAccentValue;
            if (TryColor(s, out var c)) return c;
        }
        throw new Control.CommandException("\"accent\" must be a color like #8b93ff, \"windows\" (follow the Windows accent) or empty (follow the theme)");
    }

    static string? Clock(JsonNode n, string name)
    {
        if (n.GetValueKind() != JsonValueKind.String) throw new Control.CommandException($"\"{name}\" must be a time like 08:30");
        var s = n.GetValue<string>().Trim();
        if (s.Length == 0) return null;
        return TimeSpan.TryParseExact(s, "hh\\:mm", null, out var t) ? t.ToString("hh\\:mm") : throw new Control.CommandException($"\"{name}\" must be a time like 08:30");
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
