param(
  [string]$ArtifactVersion = "9.4.0.131-xenode.1"
)

# Builds x2t -> WebAssembly (x2t.js + x2t.wasm) via the CryptPad-derived
# multi-stage Emscripten build (tools/onlyoffice/Dockerfile.x2t), assembling a
# clean build context so the Dockerfile's `COPY core/...` lines stay faithful to
# CryptPad's recipe. NOTE: this is a long (multi-hour, from-source) build and is
# NOT yet verified at 9.4.0.131 — see tools/onlyoffice/x2t-wasm/README.md for the
# expected first-run fixups.

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactPath = Join-Path $projectRoot "public\internal-editors\onlyoffice\$ArtifactVersion"
$x2tPath = Join-Path $artifactPath "x2t"
$dockerfile = Join-Path $projectRoot "tools\onlyoffice\Dockerfile.x2t"
$coreDir = Join-Path $projectRoot "vendor\onlyoffice\core"
$harnessDir = Join-Path $projectRoot "tools\onlyoffice\x2t-wasm"
$contextDir = Join-Path $projectRoot "tools\onlyoffice\.x2t-build-context"

# --- Preconditions (fail fast, before Docker) ---------------------------------
if (-not (Test-Path -LiteralPath $coreDir)) {
  throw "Missing vendor/onlyoffice/core (9.4.0.131). Run npm run onlyoffice:verify-sources first."
}
foreach ($f in @("embuild.sh", "pre-js.js", "wrap-main.cpp", "patches\harfbuzz.patch")) {
  if (-not (Test-Path -LiteralPath (Join-Path $harnessDir $f))) {
    throw "x2t harness incomplete: missing tools/onlyoffice/x2t-wasm/$f. See its README.md."
  }
}
if (-not (Test-Path -LiteralPath $artifactPath)) {
  throw "Client artifact missing: $artifactPath. Run npm run onlyoffice:build-client first."
}
if (Test-Path -LiteralPath $x2tPath) {
  throw "x2t artifact already exists (immutable): $x2tPath"
}

# --- Assemble build context ---------------------------------------------------
# The context contains only `core/` and `x2t-wasm/` at its root, so nothing else
# in the repo (node_modules, .next, the 1.5GB client artifact) is transferred.
if (Test-Path -LiteralPath $contextDir) {
  # Remove a stale junction/dir without following it into vendor/core.
  cmd /c "rmdir /S /Q `"$contextDir`"" | Out-Null
}
New-Item -ItemType Directory -Force -Path $contextDir | Out-Null
# Junction core in (no 800MB copy); BuildKit tars it as a normal directory.
cmd /c "mklink /J `"$(Join-Path $contextDir 'core')`" `"$coreDir`"" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to junction core into the build context." }
Copy-Item -Recurse -Force -LiteralPath $harnessDir -Destination (Join-Path $contextDir "x2t-wasm")

try {
  & docker build `
    --file $dockerfile `
    --target output `
    --output "type=local,dest=$artifactPath" `
    $contextDir

  if ($LASTEXITCODE -ne 0) {
    throw "ONLYOFFICE x2t WASM build failed with exit code $LASTEXITCODE"
  }
}
finally {
  # Always drop the junction so the context dir never risks a recursive delete
  # into vendor/core.
  if (Test-Path -LiteralPath (Join-Path $contextDir "core")) {
    cmd /c "rmdir `"$(Join-Path $contextDir 'core')`"" | Out-Null
  }
  cmd /c "rmdir /S /Q `"$contextDir`"" | Out-Null
}

if (-not (Test-Path -LiteralPath (Join-Path $x2tPath "x2t.wasm"))) {
  throw "x2t build produced no x2t.wasm at $x2tPath"
}

# --- Stamp manifest + flip x2tReady ------------------------------------------
$manifestPath = Join-Path $x2tPath "x2t.manifest.json"
$files = @("x2t.js", "x2t.wasm") | ForEach-Object {
  @{ file = $_; bytes = (Get-Item (Join-Path $x2tPath $_)).Length }
}
@{ onlyoffice = "9.4.0.131"; cryptpadPatchBase = "9.3.0.140"; files = $files } |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$versionFile = Join-Path $artifactPath "version.json"
$manifest = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
$manifest.x2tReady = $true
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $versionFile -Encoding utf8

Write-Host "Built x2t WASM into artifact: $x2tPath"
Write-Host "Marked x2tReady = true in $versionFile"
