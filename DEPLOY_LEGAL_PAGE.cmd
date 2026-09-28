@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy Legal / Privacy Policy Page
echo Project: chefvoice-d7fec   Hosting site: chefvoice-d7fec-legal
echo.
echo This deploys ONLY the dedicated chefvoice-d7fec-legal Hosting site.
echo It does NOT redeploy Functions, Firestore/Storage rules, App Check,
echo the PWA on the default chefvoice-d7fec site, or the delete-account page.
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
rem every site at once. This deploy must stay pinned to the legal target so
rem the privacy policy page can never replace the default site (the PWA) or
rem the delete-account site. Refuse rather than publish.
findstr /c:"\"target\": \"legal\"" firebase.json >nul
if errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo firebase.json no longer declares the "legal" Hosting target.
  echo Deploying it as-is could wipe another site. Restore the targets first.
  echo.
  pause
  exit /b 1
)

findstr /c:"REPLACE_WITH_PRIVACY_CONTACT_EMAIL" legal\privacy.html >nul
if not errorlevel 1 (
  echo REFUSING TO DEPLOY
  echo legal\privacy.html still contains the REPLACE_WITH_PRIVACY_CONTACT_EMAIL
  echo placeholder. Replace both occurrences with your real, monitored privacy
  echo contact email before publishing this page.
  echo.
  pause
  exit /b 1
)

rem This site's Content-Security-Policy in firebase.json lets the page load nothing
rem but itself. Refuse to publish a page that has started loading a script, an image
rem or anything else the policy would refuse.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js, then rerun this file.
  pause
  exit /b 1
)
node --test web\tests\security-headers.test.mjs
if errorlevel 1 (
  echo.
  echo REFUSING TO DEPLOY - the security header gates failed. See above.
  echo.
  pause
  exit /b 1
)

firebase deploy --only hosting:legal --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo HOSTING DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo If the target isn't linked yet on this machine, run:
  echo   firebase target:apply hosting legal chefvoice-d7fec-legal --project chefvoice-d7fec
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo CHEFVOICE PRIVACY POLICY PAGE DEPLOYED SUCCESSFULLY
echo Live at: https://chefvoice-d7fec-legal.web.app/privacy.html
pause
