@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice v0.9.12 - Deploy Community + Social Notification Rules
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

echo This deploys the current Firestore security rules only.
echo It does NOT redeploy Functions, Hosting, Speech, or enable App Check enforcement.
echo.
firebase deploy --only firestore:rules --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo COMMUNITY / NOTIFICATIONS RULE DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)

echo.
echo CURRENT SOCIAL + NOTIFICATION FIRESTORE RULES DEPLOYED SUCCESSFULLY
pause
