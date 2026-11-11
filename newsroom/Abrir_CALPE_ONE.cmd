@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo CALPE ONE necesita Node.js 20 o posterior para abrir la mesa editorial.
  echo La vista previa HTML se puede abrir sin instalar nada.
  pause
  exit /b 1
)
echo Abriendo CALPE ONE en este equipo. La publicacion permanece retenida.
start "CALPE ONE - Mesa editorial" cmd /k "node newsroom\server.mjs"
powershell -NoProfile -Command "Start-Sleep -Seconds 1"
start "" "http://127.0.0.1:4317"
