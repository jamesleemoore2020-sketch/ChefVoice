@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy the PWA (iPhone / browser client)
echo Project: chefvoice-d7fec   Hosting target: pwa   Site: chefvoice-d7fec
echo.
echo This deploys ONLY the "pwa" Hosting target from web\.
echo It does NOT redeploy Functions, Firestore rules, Storage rules, App Check,
echo or the dedicated chefvoice-delete-account site.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js, then rerun this file.
  pause
  exit /b 1
)

rem Tripwire. Hosting is a multi-site config: without a target the CLI deploys
rem every site at once. Refuse unless both targets are still declared, so a
rem half-edited config can never publish the PWA over the deletion page.
findstr /c:"\"target\": \"pwa\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "pwa" Hosting target.
  echo Restore the hosting targets before deploying.
  echo.
  pause
  exit /b 1
)
findstr /c:"\"target\": \"delete-account\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "delete-account" Hosting target.
  echo Restore the hosting targets before deploying.
  echo.
  pause
  exit /b 1
)

rem Shared recipe links (/r/**) are rewritten to the recipeSharePage function, which is
rem deployed on its own by DEPLOY_SHARE.cmd. A rewrite to a function that was never deployed
rem breaks every shared link, so the function goes first.
findstr /c:"recipeSharePage" firebase.json >nul
if not errorlevel 1 (
  firebase functions:list --project chefvoice-d7fec 2>nul | findstr /c:"recipeSharePage" >nul
  if errorlevel 1 (
    echo REFUSING TO DEPLOY
    echo firebase.json sends shared recipe links to recipeSharePage, which is not deployed.
    echo Run DEPLOY_SHARE.cmd first, then rerun this file.
    echo If it is deployed, the Firebase CLI login may have expired: firebase login --reauth
    echo.
    pause
    exit /b 1
  )
)

rem The deterministic parser is the protected core and the PWA half of the shared
rem golden corpus contract. Never publish a client that fails it.
echo Running PWA parser/feature gates before deploying...
call npm --prefix web test
if errorlevel 1 (
  echo.
  echo REFUSING TO DEPLOY - PWA tests failed.
  echo The published PWA must pass the shared golden cooking corpus.
  echo.
  pause
  exit /b 1
)

echo.
call firebase deploy --only hosting:pwa --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo PWA HOSTING DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo If the hosting target is not applied yet, run:
  echo   firebase target:apply hosting pwa chefvoice-d7fec --project chefvoice-d7fec
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE PWA DEPLOYED SUCCESSFULLY
echo Live at: https://chefvoice-d7fec.web.app/
echo.
echo iPhone: open that URL in Safari, then Share - Add to Home Screen.
pause
