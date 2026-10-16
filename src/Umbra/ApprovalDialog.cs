namespace Umbra;

/// <summary>
/// The host-drawn prompt for a widget command. It is a normal top-level window that no widget can draw into or move;
/// the widget's own text (its description) is shown in a separate, labelled box. Allow stays disabled for a moment so
/// a keystroke meant for another window can't approve it, and Deny is the default.
/// </summary>
sealed class ApprovalDialog : Form
{
    readonly Button _allow = new() { Text = "Allow", Enabled = false, DialogResult = DialogResult.Yes, Width = 110, Height = 32 };
    readonly Button _deny = new() { Text = "Deny", DialogResult = DialogResult.No, Width = 110, Height = 32 };

    ApprovalDialog(ApprovalRequest r)
    {
        Text = "Umbra: allow this widget to run a program?";
        Icon = App.AppIcon;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(560, 345);

        var heading = new Label
        {
            Text = $"The widget \"{Clean(r.WidgetName, 40)}\" wants to run this on your PC:",
            Left = 16, Top = 14, Width = 528, Height = 22, UseMnemonic = false, Font = new Font(Font, FontStyle.Bold),
        };
        var line = new TextBox
        {
            Text = r.CommandLine, ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical,
            Left = 16, Top = 42, Width = 528, Height = 70, Font = new Font(FontFamily.GenericMonospace, 9.5f),
        };
        var where = new Label { Text = $"Program: {r.ExePath}", Left = 16, Top = 120, Width = 528, Height = 34, AutoEllipsis = true, UseMnemonic = false };
        var note = new Label
        {
            Text = (r.HasParams ? "Parts written ${like this} are filled in by the widget each time (as single arguments). " : "")
                   + "It runs as you, with no window, and is stopped after a time limit. You can revoke this any time in Settings > My widgets.",
            Left = 16, Top = 156, Width = 528, Height = 50,
        };
        var said = new GroupBox { Text = "What the widget says it is for (not verified)", Left = 16, Top = 210, Width = 528, Height = 60 };
        said.Controls.Add(new Label { Text = string.IsNullOrWhiteSpace(r.Description) ? "(no description)" : r.Description, Left = 10, Top = 20, Width = 508, Height = 34, AutoEllipsis = true, UseMnemonic = false });

        var warn = new Label
        {
            Text = "This program can run anything: whoever controls this widget controls what it does.",
            Left = 16, Top = 272, Width = 528, Height = 20, ForeColor = Color.Firebrick, Font = new Font(Font, FontStyle.Bold),
            Visible = r.IsInterpreter, UseMnemonic = false,
        };
        _allow.Left = 544 - 110 - 10 - 110; _allow.Top = 296;
        _deny.Left = 544 - 110; _deny.Top = 296;
        Controls.AddRange(new System.Windows.Forms.Control[] { heading, line, where, note, said, warn, _allow, _deny });
        AcceptButton = _deny;
        CancelButton = _deny;
        ActiveControl = _deny;

        // Allow works only when 900 ms have passed since the dialog appeared AND the cursor, having been outside the
        // button at some point after that, is on it now. A click already in flight (or a click-jack aimed at where the
        // button will appear) therefore can't approve.
        var poll = new System.Windows.Forms.Timer { Interval = 40 };
        var shownAt = 0L;
        var sawOutside = false;
        poll.Tick += (_, _) =>
        {
            var inside = _allow.RectangleToScreen(_allow.ClientRectangle).Contains(Cursor.Position);
            if (!inside) sawOutside = true;
            _allow.Enabled = sawOutside && inside && System.Environment.TickCount64 - shownAt >= 900;
            if (System.Environment.TickCount64 - shownAt >= TimeoutMs) DialogResult = DialogResult.No; // a late click can't approve
        };
        Shown += (_, _) => { shownAt = System.Environment.TickCount64; poll.Start(); };
        FormClosed += (_, _) => poll.Dispose();
    }

    /// <summary>How long the prompt waits for an answer before it counts as a refusal and closes.</summary>
    public const int TimeoutMs = 120_000;

    /// <summary>Widget-controlled text for the heading: control characters removed, at most <paramref name="max"/> characters.</summary>
    internal static string Clean(string s, int max)
    {
        var t = new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return t.Length > max ? t[..max] + "..." : t;
    }

    /// <summary>Shows the prompt and returns true only when the user clicked Allow.</summary>
    public static bool Ask(ApprovalRequest request)
    {
        using var dlg = new ApprovalDialog(request);
        return dlg.ShowDialog() == DialogResult.Yes;
    }
}
