@echo off
title BiblioVault - File Server + Tunnel
color 0A
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   BiblioVault AI — File Server + Tunnel      ║
echo  ║   Sirve libros desde tu PC a la nube         ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: Config
set CLOUDFLARED="%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
set SERVER_DIR=%~dp0server
set LOG_DIR=%~dp0server\logs
set TUNNEL_LOG=%LOG_DIR%\tunnel.log

:: Create logs dir
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Step 1: Start file server in background
echo [1/2] Starting file server on port 3002...
start /B "FileServer" cmd /c "cd /d %SERVER_DIR% && npx tsx file-server.ts > %LOG_DIR%\file-server.log 2>&1"
timeout /t 3 /nobreak > nul

:: Step 2: Start Cloudflare Tunnel
echo [2/2] Starting Cloudflare Tunnel...
echo.
echo ═══════════════════════════════════════════════
echo  Tunnel starting... Watch for the URL below.
echo  Copy the https://xxxxx.trycloudflare.com URL
echo  and update TUNNEL_URL in Render if it changed.
echo ═══════════════════════════════════════════════
echo.

:tunnel_loop
echo [%date% %time%] Starting tunnel...
%CLOUDFLARED% tunnel --url http://localhost:3002 2>&1 | findstr /C:"trycloudflare.com" /C:"INF" /C:"ERR"
echo.
echo [!] Tunnel disconnected. Restarting in 5 seconds...
timeout /t 5 /nobreak > nul
goto tunnel_loop
