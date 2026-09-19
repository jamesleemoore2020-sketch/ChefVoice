@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy the recipe-import Cloud Functions codebase
echo Project: chefvoice-d7fec   Codebase: chefvoice-import
echo.
echo This deploys ONLY the "chefvoice-import" functions codebase from import\functions.
echo It does NOT redeploy chefvoice-notifications, chefvoice-billing, transcribeChefVoice,
echo Hosting, Firestore rules, Storage rules or App Check.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)

rem Tripwire: deploying with the codebase missing from firebase.json would fall back to
rem deploying every function in the project, which is exactly what the split prevents.
findstr /c:"\"codebase\": \"chefvoice-import\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "chefvoice-import" functions codebase.
  echo Restore it before deploying.
  echo.
  pause
  exit /b 1
)

echo Running import gates before deploying...
call RUN_IMPORT_GATES.cmd
if errorlevel 1 (
  echo.
  echo REFUSING TO DEPLOY - import gates failed.
  echo This function fetches web pages on a chef's behalf from inside Google's network,
  echo so its URL and redirect rules must pass before it ships.
  echo.
  pause
  exit /b 1
)

echo.
firebase deploy --only functions:chefvoice-import --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo CHEFVOICE IMPORT DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE IMPORT DEPLOYED SUCCESSFULLY
pause
