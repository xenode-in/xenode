param(
  [string]$ArtifactVersion = "9.3.0.140-cryptpad.2-xenode.1"
)

# Copies the Xenode frame-host files (checked into tools/onlyoffice/host) into
# the immutable editor artifact under /xenode, and flips bridgeReady in the
# version manifest. Run after onlyoffice:build-client so the host ships beside
# api.js at the same (editor) origin.

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$hostSrc = Join-Path $projectRoot "tools\onlyoffice\host"
$artifactPath = Join-Path $projectRoot "apps/drive/public/internal-editors/onlyoffice/$ArtifactVersion"
$hostDest = Join-Path $artifactPath "xenode"

if (-not (Test-Path -LiteralPath $artifactPath)) {
  throw "Client artifact missing: $artifactPath. Run npm run onlyoffice:build-client first."
}

New-Item -ItemType Directory -Force -Path $hostDest | Out-Null
Copy-Item -LiteralPath (Join-Path $hostSrc "host.html") -Destination $hostDest -Force
Copy-Item -LiteralPath (Join-Path $hostSrc "xenode-frame.js") -Destination $hostDest -Force

$versionFile = Join-Path $artifactPath "version.json"
$manifest = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
$manifest.bridgeReady = $true
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $versionFile -Encoding utf8

Write-Host "Installed Xenode frame host into: $hostDest"
Write-Host "Marked bridgeReady = true in $versionFile"
