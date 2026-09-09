@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy Launch Access / Billing Functions
echo Project: chefvoice-d7fec
echo.
echo This deploys ONLY the isolated chefvoice-billing Functions codebase.
echo It does NOT redeploy chefvoice-notifications, transcribeChefVoice, Hosting,
echo Firestore rules, Storage rules, or enable App Check enforcement.
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
if not exist "billing\functions\node_modules\firebase-functions\package.json" (
  echo Installing isolated billing Function dependencies...
  call npm --prefix billing\functions install
  if errorlevel 1 (
    echo Billing Function dependency install failed.
    pause
    exit /b 1
  )
)
set FUNCTIONS_DISCOVERY_TIMEOUT=30
firebase deploy --only functions:chefvoice-billing --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo BILLING FUNCTION DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE LAUNCH ACCESS FUNCTIONS DEPLOYED SUCCESSFULLY
echo.
echo First 10 signups get Pro for life. Everyone after gets 90 days free.
echo Kill switch: call endChefVoiceLaunchPromo as an admin.
pause
