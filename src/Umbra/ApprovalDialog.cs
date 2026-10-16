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
        ClientSize = new Size(560, 330);

        var heading = new Label
        {
            Text = $"The widget \"{r.WidgetName}\" wants to run this on your PC:",
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

        _allow.Left = 544 - 110 - 10 - 110; _allow.Top = 284;
        _deny.Left = 544 - 110; _deny.Top = 284;
        Controls.AddRange(new System.Windows.Forms.Control[] { heading, line, where, note, said, _allow, _deny });
        AcceptButton = _deny;
        CancelButton = _deny;
        ActiveControl = _deny;

        var enableAllow = new System.Windows.Forms.Timer { Interval = 900 };
        enableAllow.Tick += (_, _) => { _allow.Enabled = true; enableAllow.Stop(); };
        Shown += (_, _) => enableAllow.Start();
        FormClosed += (_, _) => enableAllow.Dispose();
    }

    /// <summary>Shows the prompt and returns true only when the user clicked Allow.</summary>
    public static bool Ask(ApprovalRequest request)
    {
        using var dlg = new ApprovalDialog(request);
        return dlg.ShowDialog() == DialogResult.Yes;
    }
}
