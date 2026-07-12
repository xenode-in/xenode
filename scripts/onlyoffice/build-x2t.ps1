param(
  [string]$ArtifactVersion = "9.4.0.131-xenode.1",
  [string]$CoreCommit = "55e5f973b036661ec8cae377f0744772cb64232a"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactPath = Join-Path $projectRoot "public\internal-editors\onlyoffice\$ArtifactVersion"
$x2tPath = Join-Path $artifactPath "x2t"
$dockerfile = Join-Path $projectRoot "tools\onlyoffice\Dockerfile.x2t"

# x2t cannot be built to WASM from stock ONLYOFFICE core: core ships only Qt
# (native) and Android x2t targets. The Emscripten build requires CryptPad's
# patch set (onlyoffice-x2t-wasm), which Xenode forward-ports to 9.4.0.131 in an
# in-repo harness. Fail fast with guidance rather than launching a long Docker
# build against an incomplete port.
$harness = Join-Path $projectRoot "tools\onlyoffice\x2t-wasm"
$patchesDir = Join-Path $harness "patches"
$embuild = Join-Path $harness "embuild.sh"
$patchCount = 0
if (Test-Path -LiteralPath $patchesDir) {
  $patchCount = @(Get-ChildItem -LiteralPath $patchesDir -Filter *.patch -ErrorAction SilentlyContinue).Count
}
if (-not (Test-Path -LiteralPath $embuild) -or $patchCount -eq 0) {
  throw @"
x2t WASM harness incomplete: tools/onlyoffice/x2t-wasm.

x2t has no WASM target in stock ONLYOFFICE core. Building it requires forward-
porting CryptPad's onlyoffice-x2t-wasm Emscripten patches (they target
9.3.0.140) onto the vendored 9.4.0.131 core. Provide:

  tools/onlyoffice/x2t-wasm/embuild.sh        (ported build wrapper)
  tools/onlyoffice/x2t-wasm/pre-js.js         (ported browser wrapper)
  tools/onlyoffice/x2t-wasm/patches/*.patch   (Emscripten-compat core patches)

See tools/onlyoffice/x2t-wasm/README.md for the port checklist.
"@
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "vendor\onlyoffice\core"))) {
  throw "Missing vendor/onlyoffice/core. Run npm run onlyoffice:verify-sources first."
}

if (-not (Test-Path -LiteralPath $artifactPath)) {
  throw "Client artifact missing: $artifactPath. Run npm run onlyoffice:build-client first."
}

if (Test-Path -LiteralPath $x2tPath) {
  throw "x2t artifact already exists (immutable): $x2tPath"
}

# The x2t output layers into the existing immutable client artifact under /x2t.
& docker build `
  --file $dockerfile `
  --target output `
  --build-arg "PRODUCT_VERSION=9.4.0" `
  --build-arg "BUILD_NUMBER=131" `
  --build-arg "XENODE_ARTIFACT_VERSION=$ArtifactVersion" `
  --build-arg "CORE_COMMIT=$CoreCommit" `
  --output "type=local,dest=$artifactPath" `
  $projectRoot

if ($LASTEXITCODE -ne 0) {
  throw "ONLYOFFICE x2t WASM build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath (Join-Path $x2tPath "x2t.wasm"))) {
  throw "x2t build produced no x2t.wasm at $x2tPath"
}

# Flip x2tReady in the version manifest so the runtime loader will attempt the
# WASM engine instead of falling back to v1.
$versionFile = Join-Path $artifactPath "version.json"
$manifest = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
$manifest.x2tReady = $true
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $versionFile -Encoding utf8

Write-Host "Built x2t WASM into artifact: $x2tPath"
Write-Host "Marked x2tReady = true in $versionFile"
