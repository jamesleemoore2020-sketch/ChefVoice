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
echo A rules deploy replaces the ENTIRE live ruleset. rules-tests (the Firestore
echo emulator suite) is the only gate that actually evaluates a rule instead of
echo just checking source text, so this refuses to deploy unless it passes.
echo.
pushd "%~dp0"
call "%~dp0RUN_RULES_GATES.cmd"
set RULES_GATES_EXIT=%errorlevel%
popd
if not "%RULES_GATES_EXIT%"=="0" (
  echo.
  echo REFUSING TO DEPLOY - Firestore rules gates failed or could not run.
  echo Fix the failure above ^(or the emulator/CLI problem it printed^), then
  echo rerun this file.
  echo.
  pause
  exit /b 1
)

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
