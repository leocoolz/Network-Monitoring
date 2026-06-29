param(
  [ValidatePattern('^[A-Za-z0-9!@%_+=.-]{14,128}$')]
  [string]$AdminPassword,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.standalone'

function New-HexSecret([int]$bytes) {
  $buffer = [byte[]]::new($bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function New-Base64Key {
  $buffer = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop belum terpasang. Instal Docker Desktop lalu jalankan script ini kembali.'
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine belum berjalan.' }

$firstInstall = -not (Test-Path -LiteralPath $environmentFile)
if ($firstInstall) {
  if (-not $AdminPassword) { $AdminPassword = "N!$(New-HexSecret 12)" }
  $postgresPassword = New-HexSecret 24
  $collectorKey = New-HexSecret 32
  $credentialKey = New-Base64Key
  $content = @(
    "APP_ORIGIN=http://127.0.0.1:$Port",
    "APP_PORT=$Port",
    "POSTGRES_PASSWORD=$postgresPassword",
    'COOKIE_SECURE=false',
    "COLLECTOR_API_KEY=$collectorKey",
    "CREDENTIAL_ENCRYPTION_KEY=$credentialKey",
    'ADMIN_USERNAME=admin',
    "ADMIN_PASSWORD=$AdminPassword",
    'ADMIN_DISPLAY_NAME=Network Administrator',
    'ADMIN_EMAIL=admin@example.internal',
    'SEED_SAMPLE_DATA=false',
    'ALLOWED_DEVICE_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
  )
  [System.IO.File]::WriteAllLines($environmentFile, $content, [System.Text.UTF8Encoding]::new($false))
  $identity = whoami
  icacls $environmentFile /inheritance:r /grant:r "${identity}:(R,W)" *> $null
}

Push-Location $projectRoot
try {
  docker compose --env-file $environmentFile up -d --build
  docker compose --env-file $environmentFile ps
} finally {
  Pop-Location
}

Write-Host "`nNetra NOC tersedia di http://127.0.0.1:$Port" -ForegroundColor Green
if ($firstInstall) {
  Write-Host 'Username: admin'
  Write-Host "Password awal: $AdminPassword"
  Write-Host 'Simpan password tersebut dan ubah setelah login pertama.' -ForegroundColor Yellow
}
