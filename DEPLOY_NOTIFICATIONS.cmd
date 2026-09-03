@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice v0.9.12 - Deploy Social Notification Functions
echo Project: chefvoice-d7fec
echo.
echo This deploys ONLY the isolated chefvoice-notifications Functions codebase.
echo It does NOT redeploy transcribeChefVoice, Hosting, Storage, or enable App Check enforcement.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH. Install Node.js, then rerun this file.
  pause
  exit /b 1
)
if not exist "notifications\functions\node_modules\firebase-functions\package.json" (
  echo Installing isolated notification Function dependencies...
  call npm --prefix notifications\functions install
  if errorlevel 1 (
    echo Notification Function dependency install failed.
    pause
    exit /b 1
  )
)
set FUNCTIONS_DISCOVERY_TIMEOUT=30
firebase deploy --only functions:chefvoice-notifications --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo NOTIFICATION FUNCTION DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE SOCIAL NOTIFICATION FUNCTIONS DEPLOYED SUCCESSFULLY
pause
