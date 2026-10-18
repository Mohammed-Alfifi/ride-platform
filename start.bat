@echo off
chcp 65001 >nul
echo Starting the platform. The first time takes 5-10 minutes...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Docker Desktop is not running. Open Docker Desktop, wait until it says "Engine running", then try again.
  pause
  exit /b 1
)
echo.
echo Ready in about a minute:
echo   Dashboard: http://localhost:3001
echo   Sign in:   0500000000   code 123456
timeout /t 25 >nul
start http://localhost:3001
pause
