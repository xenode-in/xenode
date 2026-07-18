param(
  [string]$ArtifactVersion = "9.4.0.131-xenode.1"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$outputRoot = Join-Path $projectRoot "apps/drive/public/internal-editors/onlyoffice"
$outputPath = Join-Path $outputRoot $ArtifactVersion
$dockerfile = Join-Path $projectRoot "tools\onlyoffice\Dockerfile.client"

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "vendor\onlyoffice\core-fonts"))) {
  throw "Missing vendor/onlyoffice/core-fonts. Run npm run onlyoffice:verify-sources first."
}

if (Test-Path -LiteralPath $outputPath) {
  throw "Immutable editor artifact already exists: $outputPath"
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

& docker build `
  --file $dockerfile `
  --target output `
  --build-arg "PRODUCT_VERSION=9.4.0" `
  --build-arg "BUILD_NUMBER=131" `
  --build-arg "XENODE_ARTIFACT_VERSION=$ArtifactVersion" `
  --output "type=local,dest=$outputPath" `
  $projectRoot

if ($LASTEXITCODE -ne 0) {
  throw "ONLYOFFICE client build failed with exit code $LASTEXITCODE"
}

& node (Join-Path $projectRoot "scripts\onlyoffice\sanitize-client.mjs") $outputPath
if ($LASTEXITCODE -ne 0) {
  throw "ONLYOFFICE client sanitization failed with exit code $LASTEXITCODE"
}

& node (Join-Path $projectRoot "scripts\onlyoffice\verify-client.mjs") $outputPath
if ($LASTEXITCODE -ne 0) {
  throw "ONLYOFFICE client verification failed with exit code $LASTEXITCODE"
}

Write-Host "Built immutable ONLYOFFICE client artifact: $outputPath"
