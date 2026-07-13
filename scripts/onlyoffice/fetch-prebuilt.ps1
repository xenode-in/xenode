param(
  [string]$ArtifactVersion = "9.3.0.140-cryptpad.2-xenode.1"
)

# Fetches CryptPad's PREBUILT, server-less ONLYOFFICE editor + x2t WASM (9.3.0
# stack) and assembles the Xenode editor artifact. This is the "use prebuilt"
# path chosen over building from source (see docs/ONLYOFFICE_EDITOR_V2_PLAN.md).
#
# PROVENANCE (pinned; SHA-512 verified below):
#   onlyoffice-editor v9.3.0.140+2  (patched sdkjs + web-apps + wrapper api.js)
#   onlyoffice-x2t-wasm v9.3.0+0     (x2t.js + x2t.wasm)
# Both are CryptPad's official GitHub release assets. A provenance/license
# review of these prebuilt binaries is required before production (plan Phase 0).

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dest = Join-Path $projectRoot "public\internal-editors\onlyoffice\$ArtifactVersion"

$editorUrl = "https://github.com/cryptpad/onlyoffice-editor/releases/download/v9.3.0.140%2B2/onlyoffice-editor.zip"
$editorSha = "fedf1af4c3b061f6afadbc231cee7f06d15dd1a5e82db3c5f1e9739b7ddf5b5b38825f3ec3da5e92d7ed6ad1d944c11b9f83875cc5fb67bde4f9c9b1434579d8"
$x2tUrl = "https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v9.3.0%2B0/x2t.zip"
$x2tSha = "e82fbf21fcdcff2cbaca5b9a49c3a3d6bc5f5f02ba9b704a7384ceb91e17e979bf7659aaf59f677edf319fde91dd847b419e018f58f38eb1df6ab433a6cd207c"

if (Test-Path -LiteralPath $dest) {
  throw "Artifact already exists (immutable): $dest"
}

$tmp = Join-Path $env:TEMP "xenode-ooe-$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Get-Verified($url, $expectedSha, $out) {
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $out
  $actual = (Get-FileHash -LiteralPath $out -Algorithm SHA512).Hash.ToLower()
  if ($actual -ne $expectedSha.ToLower()) {
    throw "SHA-512 mismatch for $url`n expected $expectedSha`n actual   $actual"
  }
  Write-Host "  SHA-512 OK"
}

try {
  Get-Verified $editorUrl $editorSha "$tmp\editor.zip"
  Get-Verified $x2tUrl $x2tSha "$tmp\x2t.zip"

  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Expand-Archive -LiteralPath "$tmp\editor.zip" -DestinationPath $dest
  Expand-Archive -LiteralPath "$tmp\x2t.zip" -DestinationPath "$dest\x2t"

  # version.json — our loaders read x2tReady / bridgeReady.
  @{ onlyoffice = "9.3.0"; build = 140; xenode = $ArtifactVersion;
     cryptpad = "9.3.0.140+2"; x2tCryptpad = "9.3.0+0";
     editors = @("spreadsheet", "document", "presentation");
     bridgeReady = $true; x2tReady = $true } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$dest\version.json" -Encoding utf8

  # fonts manifest — browserEngine preloads these into the WASM FS.
  $fontsDir = Join-Path $dest "fonts"
  if (Test-Path -LiteralPath $fontsDir) {
    $prefixLen = $fontsDir.Length + 1
    $fontFiles = @(
      Get-ChildItem -LiteralPath $fontsDir -Recurse -Filter *.ttf -File |
        ForEach-Object { "fonts/" + ($_.FullName.Substring($prefixLen) -replace '\\', '/') }
    )
    ConvertTo-Json -InputObject $fontFiles -Depth 2 |
      Set-Content -LiteralPath (Join-Path $dest "x2t\fonts.manifest.json") -Encoding utf8
  }

  # Xenode frame host, served beside the editor at the same origin.
  New-Item -ItemType Directory -Force -Path "$dest\xenode" | Out-Null
  Copy-Item (Join-Path $projectRoot "tools\onlyoffice\host\host.html") "$dest\xenode\host.html" -Force
  Copy-Item (Join-Path $projectRoot "tools\onlyoffice\host\xenode-frame.js") "$dest\xenode\xenode-frame.js" -Force
  # Dev-only empirical harness for the editor protocol (see host/lab.html).
  Copy-Item (Join-Path $projectRoot "tools\onlyoffice\host\lab.html") "$dest\xenode\lab.html" -Force

  Write-Host "Assembled CryptPad editor artifact: $dest"
}
finally {
  if (Test-Path -LiteralPath $tmp) { Remove-Item -Recurse -Force $tmp }
}
