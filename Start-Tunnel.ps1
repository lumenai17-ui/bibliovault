# BiblioVault AI - Auto Tunnel Manager
# Starts file server + tunnel, auto-detects URL, copies to clipboard
#
# Usage: Right-click > "Run with PowerShell"

$ErrorActionPreference = "Continue"

$CLOUDFLARED = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
$SERVER_DIR = Join-Path $PSScriptRoot "server"
$FILE_SERVER_PORT = 3002
$RENDER_SERVICE_ID = "srv-d824cnv7f7vs73dplug0"

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "  |  BiblioVault AI - Tunnel Manager              |" -ForegroundColor Cyan
Write-Host "  |  Press Ctrl+C to stop                         |" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host ""

# Create logs dir
$logsDir = Join-Path $SERVER_DIR "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

# Step 1: Start File Server
Write-Host "[1/2] Starting file server on port $FILE_SERVER_PORT..." -ForegroundColor Yellow

$fileServerJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    & npx tsx file-server.ts 2>&1
} -ArgumentList $SERVER_DIR

Start-Sleep -Seconds 4

$serverCheck = try { (Invoke-WebRequest -Uri "http://localhost:$FILE_SERVER_PORT/health" -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }
if ($serverCheck -eq 200) {
    Write-Host "  [OK] File server running on port $FILE_SERVER_PORT" -ForegroundColor Green
} else {
    Write-Host "  [..] File server starting (may take a moment)..." -ForegroundColor Yellow
}

# Step 2: Start Tunnel with Auto-Restart
Write-Host "[2/2] Starting Cloudflare Tunnel..." -ForegroundColor Yellow
Write-Host ""

$stderrLog = Join-Path $logsDir "tunnel-stderr.log"

while ($true) {
    # Clear old log
    if (Test-Path $stderrLog) { Remove-Item $stderrLog -Force }

    $tunnelProcess = Start-Process -FilePath $CLOUDFLARED `
        -ArgumentList "tunnel", "--url", "http://localhost:$FILE_SERVER_PORT" `
        -PassThru -NoNewWindow -RedirectStandardError $stderrLog

    # Wait for tunnel URL to appear in log
    $tunnelUrl = $null
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Path $stderrLog) {
            $logContent = Get-Content $stderrLog -Raw -ErrorAction SilentlyContinue
            if ($logContent -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
                $tunnelUrl = $Matches[1]
                break
            }
        }
    }

    if ($tunnelUrl) {
        Write-Host ""
        Write-Host "  ================================================" -ForegroundColor Green
        Write-Host "  [OK] TUNNEL ACTIVE" -ForegroundColor Green
        Write-Host "  URL: $tunnelUrl" -ForegroundColor Cyan
        Write-Host "  ================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  If this URL changed, update TUNNEL_URL in Render:" -ForegroundColor Yellow
        Write-Host "  https://dashboard.render.com/web/$RENDER_SERVICE_ID/env" -ForegroundColor Gray
        Write-Host ""

        # Copy to clipboard
        try {
            $tunnelUrl | Set-Clipboard
            Write-Host "  URL copied to clipboard!" -ForegroundColor Magenta
        } catch {}
    } else {
        Write-Host "  [!] Could not detect tunnel URL from logs" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "  Tunnel is running. Waiting for it to finish..." -ForegroundColor DarkGray

    # Wait for tunnel process to exit
    $tunnelProcess.WaitForExit()

    Write-Host ""
    Write-Host "  [!] Tunnel disconnected. Restarting in 5s..." -ForegroundColor Red
    Start-Sleep -Seconds 5
}
