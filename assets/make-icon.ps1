# Renders the Umbra icon (an eclipse: a black disc in front of a bright crescent rim)
# at every Windows icon size and packs the PNGs into assets/umbra.ico.
# Usage: powershell -File assets/make-icon.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'umbra.ico'
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256

function Render([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [Math]::Max(1, $s * 0.06)
    $d = $s - 2 * $pad

    # soft corona glow
    for ($i = 6; $i -ge 1; $i--) {
        $grow = $s * 0.012 * $i
        $a = [int](10 + 4 * (6 - $i))
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb([int]($a * 0.6), 170, 190, 255))
        $g.FillEllipse($b, $pad - $grow / 2, $pad - $grow / 2, $d + $grow, $d + $grow)
        $b.Dispose()
    }

    # bright rim: white (top-right) fading to indigo (bottom-left)
    $rect = New-Object System.Drawing.RectangleF $pad, $pad, $d, $d
    $lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 255, 255, 255)), ([System.Drawing.Color]::FromArgb(255, 70, 80, 240)), 135.0
    $g.FillEllipse($lg, $rect)
    $lg.Dispose()

    # the umbra: black disc shifted toward bottom-left, leaving a crescent of light
    $shift = $d * 0.055
    $k = $d * 0.93
    $black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 4, 4, 6))
    $g.FillEllipse($black, $pad + ($d - $k) / 2 - $shift, $pad + ($d - $k) / 2 + $shift, $k, $k)
    $black.Dispose()

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$images = foreach ($s in $sizes) { , (Render $s) }

# ICO container: header, directory entries, then PNG payloads.
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $images[$i].Length
    $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
}
foreach ($img in $images) { $w.Write($img) }
$w.Close()

# Large PNG for README / installer art
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'umbra-256.png'), $images[-1])
"wrote $out"
