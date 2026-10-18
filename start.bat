@echo off
chcp 65001 >nul
docker info >/dev/null 2>&1
if errorlevel 1 (
  echo Docker Desktop is not running. Open Docker Desktop, wait until it says "Engine running", then try again.
  pause
  exit /b 1
)
echo Starting the platform. The first time takes 5-15 minutes...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Something did not start. These are the last lines from the API:
  docker compose logs --tail 40 api
  pause
  exit /b 1
)
echo.
echo Ready:
echo   Dashboard: http://localhost:3001
echo   Sign in:   0500000000   code 123456
timeout /t 5 >nul
start http://localhost:3001
pause
