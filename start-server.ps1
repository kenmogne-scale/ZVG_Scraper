param(
  [int]$Port = 3011
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root "logs"
$stdoutLog = Join-Path $logDir "viewer.out.log"
$stderrLog = Join-Path $logDir "viewer.err.log"
$infoPath = Join-Path $root ".server-info.json"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  try {
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  } catch {
  }
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$command = "Set PORT=$Port&& Set HOST=0.0.0.0&& `"$nodePath`" .\server.js"
$proc = Start-Process -FilePath "cmd.exe" `
  -WorkingDirectory $root `
  -ArgumentList "/c", $command `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 3

$check = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port" -TimeoutSec 10

[pscustomobject]@{
  pid = $proc.Id
  port = $Port
  url = "http://localhost:$Port"
  startedAt = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content -Encoding UTF8 $infoPath

Write-Output "PID=$($proc.Id)"
Write-Output "URL=http://localhost:$Port"
Write-Output "STATUS=$($check.StatusCode)"
