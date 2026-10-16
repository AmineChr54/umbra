# Builds the Umbra installer: dist\UmbraSetup-<version>.exe
#   powershell -ExecutionPolicy Bypass -File build.ps1
# Needs the .NET 10 SDK and Inno Setup 6 (winget install JRSoftware.InnoSetup).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$proj = Join-Path $root 'src\Umbra\Umbra.csproj'
$version = ([xml](Get-Content $proj)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
$publish = Join-Path $root 'dist\publish'

Write-Host "Umbra $version" -ForegroundColor Cyan

if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
dotnet publish $proj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:DebugType=none -o $publish
if ($LASTEXITCODE) { throw "dotnet publish failed" }

# Make sure the community catalog is valid before shipping
node (Join-Path $root 'scripts\catalog.mjs') --check
if ($LASTEXITCODE) { throw "widget catalog is invalid or out of date (run: node scripts/catalog.mjs)" }

$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup" }

& $iscc "/DAppVersion=$version" "/DPublishDir=$publish" (Join-Path $root 'installer\Umbra.iss')
if ($LASTEXITCODE) { throw "Inno Setup failed" }

$setup = Join-Path $root "dist\UmbraSetup-$version.exe"
Write-Host "Built $setup ($([math]::Round((Get-Item $setup).Length / 1MB, 1)) MB)" -ForegroundColor Green
