@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy Storage Rules
echo Project: chefvoice-d7fec
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)

echo This deploys the current storage.rules only.
echo It does NOT redeploy Firestore rules, Functions, Hosting, Speech, or App Check.
echo.
firebase deploy --only storage --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo STORAGE RULES DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)

echo.
echo CHEFVOICE STORAGE RULES DEPLOYED SUCCESSFULLY
pause
