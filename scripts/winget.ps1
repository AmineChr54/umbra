# Fills the winget manifest templates in winget/ for one release.
#   powershell -File scripts/winget.ps1 -Installer dist/UmbraSetup-1.3.0.exe [-Version 1.3.0] [-Out dist/winget]
# The version defaults to Directory.Build.props; the SHA256 is computed from the installer.
# Result: <Out>/<version>/AmineChr54.Umbra*.yaml, ready for `wingetcreate submit` or a manual PR to microsoft/winget-pkgs
# (manifests/a/AmineChr54/Umbra/<version>/).
param(
  [Parameter(Mandatory)][string]$Installer,
  [string]$Version,
  [string]$Out
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Out) { $Out = Join-Path $root 'dist\winget' }
if (-not $Version) {
  $Version = ([xml](Get-Content (Join-Path $root 'Directory.Build.props'))).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Bad version '$Version'" }
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
$sha = (Get-FileHash -Algorithm SHA256 -Path $Installer).Hash.ToUpperInvariant()
$date = (Get-Date).ToString('yyyy-MM-dd')

$dest = Join-Path $Out $Version
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($t in Get-ChildItem (Join-Path $root 'winget') -Filter 'AmineChr54.Umbra*.yaml') {
  $text = (Get-Content $t.FullName -Raw).Replace('{{VERSION}}', $Version).Replace('{{SHA256}}', $sha).Replace('{{RELEASE_DATE}}', $date)
  if ($text -match '\{\{') { throw "Unfilled placeholder in $($t.Name)" }
  Set-Content -Path (Join-Path $dest $t.Name) -Value $text -Encoding utf8
}
Write-Host "winget manifests for $Version written to $dest (SHA256 $sha)"
