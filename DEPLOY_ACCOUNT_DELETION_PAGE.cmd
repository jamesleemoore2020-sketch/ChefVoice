@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice v0.10.6 - Deploy Web Account Deletion Page
echo Project: chefvoice-d7fec
echo.
echo This deploys ONLY Firebase Hosting (the /delete-account/ page).
echo It does NOT redeploy Functions, Firestore/Storage rules, or App Check.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)
firebase deploy --only hosting --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo HOSTING DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE ACCOUNT DELETION PAGE DEPLOYED SUCCESSFULLY
echo Live at: https://chefvoice-d7fec.web.app/delete-account/
pause
