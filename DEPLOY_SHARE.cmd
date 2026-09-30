@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy the shared-recipe-link Cloud Functions codebase
echo Project: chefvoice-d7fec   Codebase: chefvoice-share
echo.
echo This deploys ONLY the "chefvoice-share" functions codebase from share\functions: the
echo recipeSharePage function that answers /r/{recipeId} links for link previews.
echo It does NOT redeploy chefvoice-notifications, chefvoice-billing, chefvoice-import,
echo transcribeChefVoice, Hosting, Firestore rules, Storage rules or App Check.
echo Deploy this BEFORE DEPLOY_PWA.cmd: the PWA's Hosting rewrite points at this function.
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
findstr /c:"\"codebase\": \"chefvoice-share\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "chefvoice-share" functions codebase.
  echo Restore it before deploying.
  echo.
  pause
  exit /b 1
)

echo Running share-link gates before deploying...
call "%~dp0RUN_SHARE_GATES.cmd"
if errorlevel 1 (
  echo.
  echo REFUSING TO DEPLOY - share-link gates failed.
  echo This page is public and describes recipes to anyone who asks, so its rules must pass
  echo before it ships.
  echo.
  pause
  exit /b 1
)

rem The CLI loads index.js locally to find the function, so its dependencies must be installed.
if not exist share\functions\node_modules\firebase-functions\package.json (
  echo Installing the share function's dependencies...
  call npm ci --prefix share\functions
  if errorlevel 1 exit /b 1
)

echo.
call firebase deploy --only functions:chefvoice-share --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo CHEFVOICE SHARE DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE SHARE DEPLOYED SUCCESSFULLY
pause
