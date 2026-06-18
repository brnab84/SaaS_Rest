# Empaqueta la extensión de Chrome (extension/wa-catalog) en un .zip versionado
# y lo deja descargable desde la app en public/downloads, junto a ext-version.json.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/build-ext.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension/wa-catalog'
$out = Join-Path $root 'public/downloads'

$ver = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Filter '*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force

$zipName = "restaurapp-wa-catalog-v$ver.zip"
$zipPath = Join-Path $out $zipName
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zipPath -Force

$meta = [ordered]@{ version = $ver; file = "/downloads/$zipName" } | ConvertTo-Json
Set-Content -Path (Join-Path $out 'ext-version.json') -Value $meta -Encoding utf8

Write-Output "Extensión empaquetada: $zipName (v$ver)"
