namespace Umbra;

/// <summary>
/// The host-drawn review for installs that come from a file the user opened (double-click on a .umbrawidget) or a URL they typed:
/// the same checks as every other install (<see cref="Community.PrepareLocal"/>), then a native Yes/No box that always
/// shows what the widget is and what access it asks for. Nothing is written until the user says yes, and no remote
/// process can answer the box: it is a MessageBox on the UI thread.
/// </summary>
static class PackageInstall
{
    static int _open;

    /// <summary>"Todo 1.3 wants new access: ..." with the changelog, as a native Yes/No box. No is the default button.</summary>
    public static bool ConfirmNewAccess(IWin32Window? owner, Community.PendingInstall p, string? source = null)
    {
        var text = $"{p.Manifest.Name} {p.Manifest.Version} wants {(p.IsUpdate ? "new " : "")}access:\n\n"
            + string.Join("\n", p.Added.Describe().Select(l => "+ " + l))
            + (source is null ? "" : $"\n\nFrom: {source}")
            + (WidgetManifest.SanitizeChangelog(p.Manifest.Changelog) is { } cl ? "\n\nWhat's new: " + cl : "")
            + (p.IsUpdate ? "\n\nUpdate and allow this?" : "\n\nInstall and allow this?");
        return MessageBox.Show(owner, text, "Umbra", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    /// <summary>A small host-drawn box asking for an https:// address. Returns the checked address, or null on cancel (a bad address is explained and cancels).</summary>
    public static string? AskUrl(IWin32Window? owner)
    {
        using var form = new Form
        {
            Text = "Install a widget from a web address", FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent,
            MaximizeBox = false, MinimizeBox = false, ClientSize = new Size(520, 110), ShowInTaskbar = false,
            BackColor = Color.FromArgb(24, 24, 24), ForeColor = Color.White,
        };
        var label = new Label { Text = "Address of a .umbrawidget (or .zip) file, https:// only:", Left = 12, Top = 12, Width = 496, AutoSize = false, Height = 20 };
        var box = new TextBox { Left = 12, Top = 36, Width = 496 };
        var ok = new Button { Text = "Download and review", Left = 292, Top = 72, Width = 150, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Left = 448, Top = 72, Width = 60, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange(new System.Windows.Forms.Control[] { label, box, ok, cancel });
        form.AcceptButton = ok; form.CancelButton = cancel;
        if (form.ShowDialog(owner) != DialogResult.OK) return null;
        var url = box.Text.Trim();
        if (Community.CheckDownloadUrl(url) is { } bad) { MessageBox.Show(owner, bad, "Umbra", MessageBoxButtons.OK, MessageBoxIcon.Warning); return null; }
        return url;
    }

    /// <summary>The review text for a widget that asks for no access: who made it, where it came from, and that it replaces an installed copy.</summary>
    internal static string PlainReview(Community.PendingInstall p, string source) =>
        $"{(p.IsUpdate ? "Replace the installed" : "Install")} {p.Manifest.Name} {p.Manifest.Version}"
        + (p.Manifest.Author.Length > 0 ? $" by {p.Manifest.Author}" : "")
        + $"?\n\nFrom {source}. It asks for no access to websites, system info, media, notifications or commands.";

    /// <summary>
    /// Prepares a widget with <paramref name="prepare"/> (off the UI thread), shows the review, installs it when accepted.
    /// Returns a one-line result for a notification, or null when the user declined. Only one review is open at a time:
    /// a second request while a box is showing is ignored, so nothing can stack prompts on the user.
    /// </summary>
    public static async Task<string?> RunAsync(App app, Func<Task<Community.PendingInstall>> prepare, string source, IWin32Window? owner = null)
    {
        if (Interlocked.Exchange(ref _open, 1) == 1) { Log.Write("Install review already open; request ignored"); return null; }
        try
        {
            using var pending = await prepare();
            var id = pending.Manifest.Id;
            if (app.Manifests.Any(m => m.Id == id && m.Source == WidgetSource.BuiltIn))
                throw new InvalidOperationException($"'{id}' is the id of a built-in widget");
            var accepted = pending.NeedsApproval
                ? ConfirmNewAccess(owner, pending, source)
                : MessageBox.Show(owner, PlainReview(pending, source), "Umbra", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
            if (!accepted) return null;
            app.CloseWidget(id);
            pending.Commit();
            app.ReloadWidgets();
            app.SettingsChangedElsewhere();
            return $"Installed {pending.Manifest.Name}";
        }
        finally { Interlocked.Exchange(ref _open, 0); }
    }
}
