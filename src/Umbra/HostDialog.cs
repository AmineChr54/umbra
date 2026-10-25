namespace Umbra;

/// <summary>
/// The one dark, host-drawn Yes/No box for anything that asks the user to approve access or a destructive change
/// (install review, new permissions, delete/restore/reset). It is a native modal on the UI thread (<c>ShowDialog</c>):
/// no widget, control command, umbractl or MCP tool can answer it. No is the default button and Esc is No; a long list
/// of permissions scrolls instead of growing the box.
/// </summary>
sealed class HostDialog : Form
{
    static readonly Color Black = Color.Black, Surface = Color.FromArgb(24, 24, 24), Edge = Color.FromArgb(58, 58, 58);
    static readonly Color Muted = Color.FromArgb(170, 170, 170);

    /// <summary>Entries shown before the list scrolls, so 10+ items stay readable.</summary>
    internal const int MaxVisibleLines = 8;

    readonly Button _yes, _no;

    HostDialog(string title, string heading, IReadOnlyList<string> items, string? footer, string yesText, string noText)
    {
        Text = title;
        Icon = App.AppIcon;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Black;
        ForeColor = Color.White;
        Font = new Font(FontFamily.Families.Any(f => f.Name == "Segoe UI Variable Text") ? "Segoe UI Variable Text" : "Segoe UI", 9.5f);
        const int width = 520;
        var lines = items.Select(Clean).Where(i => i.Length > 0).ToList();
        var listHeight = lines.Count == 0 ? 0 : Math.Min(lines.Count, MaxVisibleLines) * 22 + 14;

        var y = 16;
        var head = new Label { Text = heading, Left = 16, Top = y, Width = width - 32, UseMnemonic = false, AutoSize = false, Font = new Font(Font, FontStyle.Bold) };
        head.Height = MeasureHeight(head, width - 32);
        Controls.Add(head);
        y += head.Height + 10;

        if (lines.Count > 0)
        {
            var list = new TextBox
            {
                Text = FormatList(lines), ReadOnly = true, Multiline = true, WordWrap = true, BorderStyle = BorderStyle.FixedSingle,
                ScrollBars = lines.Count > MaxVisibleLines ? ScrollBars.Vertical : ScrollBars.None,
                Left = 16, Top = y, Width = width - 32, Height = listHeight, BackColor = Surface, ForeColor = Color.White,
            };
            list.HandleCreated += (_, _) => Native.SetWindowTheme(list.Handle, "DarkMode_Explorer", null);
            Controls.Add(list);
            y += listHeight + 10;
        }
        if (!string.IsNullOrWhiteSpace(footer))
        {
            var note = new Label { Text = footer, Left = 16, Top = y, Width = width - 32, AutoSize = false, UseMnemonic = false, ForeColor = Muted };
            note.Height = MeasureHeight(note, width - 32);
            Controls.Add(note);
            y += note.Height + 10;
        }
        y += 6;
        _yes = MakeButton(yesText, DialogResult.Yes);
        _no = MakeButton(noText, DialogResult.No);
        _no.Left = width - 16 - 110; _yes.Left = _no.Left - 10 - 110;
        _yes.Top = _no.Top = y;
        Controls.Add(_yes); Controls.Add(_no);
        ClientSize = new Size(width, y + 32 + 16);
        // Tab order: list (scroll), Yes, No. Enter and Esc both mean No.
        AcceptButton = _no; CancelButton = _no; ActiveControl = _no;
        HandleCreated += (_, _) => Native.SetDwm(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    }

    static int MeasureHeightOf(string text, Font font, int w) =>
        Math.Max(20, TextRenderer.MeasureText(text, font, new Size(w, 0), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix).Height + 4);

    static int MeasureHeight(Label l, int w) => MeasureHeightOf(l.Text, l.Font, w);

    static Button MakeButton(string text, DialogResult result)
    {
        var b = new Button
        {
            Text = text, DialogResult = result, Width = 110, Height = 32, FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false,
            BackColor = Surface, ForeColor = Color.White, UseMnemonic = false,
        };
        b.FlatAppearance.BorderColor = Edge;
        b.FlatAppearance.MouseOverBackColor = Color.FromArgb(40, 40, 40);
        b.FlatAppearance.MouseDownBackColor = Color.FromArgb(56, 56, 56);
        // Accent focus ring: the default flat focus rectangle is nearly invisible on black.
        b.Paint += (_, e) =>
        {
            if (!b.Focused) return;
            using var pen = new Pen(Color.FromArgb(96, 165, 250), 2);
            e.Graphics.DrawRectangle(pen, 1, 1, b.Width - 3, b.Height - 3);
        };
        b.GotFocus += (_, _) => b.Invalidate();
        b.LostFocus += (_, _) => b.Invalidate();
        return b;
    }

    /// <summary>One entry with control characters removed and trimmed (entries can contain widget-supplied text).</summary>
    internal static string Clean(string s) => new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();

    /// <summary>One "+ line" per non-empty entry, as the scrollable list shows it.</summary>
    internal static string FormatList(IEnumerable<string> items) =>
        string.Join("\r\n", items.Select(Clean).Where(i => i.Length > 0).Select(i => "+ " + i));

    /// <summary>Shows the box and returns true only when the user pressed Yes. Must be called on the UI thread.</summary>
    public static bool Confirm(IWin32Window? owner, string heading, IReadOnlyList<string>? items = null, string? footer = null,
        string yesText = "Yes", string noText = "No", string title = "Umbra")
    {
        using var dlg = new HostDialog(title, heading, items ?? Array.Empty<string>(), footer, yesText, noText);
        return dlg.ShowDialog(owner) == DialogResult.Yes;
    }
}
