@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice v0.10.6 - Deploy Web Account Deletion Page
echo Project: chefvoice-d7fec   Hosting site: chefvoice-delete-account
echo.
echo This deploys ONLY the dedicated chefvoice-delete-account Hosting site.
echo It does NOT redeploy Functions, Firestore/Storage rules, or App Check,
echo and it does NOT touch the PWA living on the default chefvoice-d7fec site.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)

rem Tripwire. Hosting is a multi-site config: without a target the CLI deploys
rem every site at once. This deploy must stay pinned to the delete-account target
rem so the single deletion page can never replace the default site, which serves
rem the PWA. Refuse rather than publish.
findstr /c:"\"target\": \"delete-account\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "delete-account" Hosting target.
  echo Deploying it as-is could wipe the default site. Restore the targets first.
  echo.
  pause
  exit /b 1
)

firebase deploy --only hosting:delete-account --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo HOSTING DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo If the site does not exist yet, run:
  echo   firebase hosting:sites:create chefvoice-delete-account --project chefvoice-d7fec
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE ACCOUNT DELETION PAGE DEPLOYED SUCCESSFULLY
echo Live at: https://chefvoice-delete-account.web.app/
pause
