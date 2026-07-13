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
# Docker Desktop does not follow a Windows junction whose target is outside the
# build-context directory. Materialize the pinned source instead; otherwise the
# context contains only the harness and every `COPY core/...` fails immediately.
$expectedContextPath = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "tools\onlyoffice\.x2t-build-context")
)
$resolvedContextPath = [System.IO.Path]::GetFullPath($contextDir)
if ($resolvedContextPath -ne $expectedContextPath -or -not $resolvedContextPath.StartsWith($projectRoot)) {
  throw "Refusing to manage unexpected x2t context path: $resolvedContextPath"
}
if (Test-Path -LiteralPath $contextDir) {
  Remove-Item -LiteralPath $contextDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $contextDir | Out-Null
$contextCoreDir = Join-Path $contextDir "core"
New-Item -ItemType Directory -Force -Path $contextCoreDir | Out-Null
Get-ChildItem -LiteralPath $coreDir -Force |
  Where-Object { $_.Name -ne ".git" } |
  Copy-Item -Destination $contextCoreDir -Recurse -Force
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
  if (Test-Path -LiteralPath $contextDir) {
    Remove-Item -LiteralPath $contextDir -Recurse -Force
  }
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

# --- Font manifest -----------------------------------------------------------
# Enumerate the artifact's TTF fonts (from the client build's core-fonts) so
# browserEngine can preload them into the WASM FS — x2t measures text against
# real fonts. Paths are relative to the artifact root (served under the editor
# URL); the browser can't list a directory over HTTP, hence this manifest.
$fontsDir = Join-Path $artifactPath "fonts"
if (Test-Path -LiteralPath $fontsDir) {
  $prefixLen = $fontsDir.Length + 1
  $fontFiles = @(
    Get-ChildItem -LiteralPath $fontsDir -Recurse -Filter *.ttf -File |
      ForEach-Object { "fonts/" + ($_.FullName.Substring($prefixLen) -replace '\\', '/') }
  )
  ConvertTo-Json -InputObject $fontFiles -Depth 2 |
    Set-Content -LiteralPath (Join-Path $x2tPath "fonts.manifest.json") -Encoding utf8
  Write-Host "Wrote fonts.manifest.json ($($fontFiles.Count) fonts)"
}

Write-Host "Built x2t WASM into artifact: $x2tPath"
Write-Host "Marked x2tReady = true in $versionFile"
