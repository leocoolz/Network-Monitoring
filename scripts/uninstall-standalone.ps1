param([switch]$DeleteData)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.standalone'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw '.env.standalone tidak ditemukan.' }

Push-Location $projectRoot
try {
  if ($DeleteData) {
    docker compose --env-file $environmentFile down --volumes
  } else {
    docker compose --env-file $environmentFile down
  }
} finally {
  Pop-Location
}
