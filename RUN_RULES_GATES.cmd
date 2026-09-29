@echo off
setlocal
cd /d "%~dp0rules-tests"
echo.
echo === ChefVoice Firestore rules gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
if not exist node_modules (
  echo Installing rules-test dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 exit /b 1
)
rem deletion-backfill.test.js runs a notifications callable against the emulator, so that
rem codebase's dependencies must be installed too.
if not exist ..\notifications\functions\node_modules\firebase-functions\package.json (
  echo Installing the notification functions' dependencies ^(first run only^)...
  call npm ci --prefix ..\notifications\functions
  if errorlevel 1 exit /b 1
)
call npm test
if errorlevel 1 (
  echo.
  echo CHEFVOICE RULES GATES FAILED.
  exit /b 1
)
echo.
echo CHEFVOICE RULES GATES PASSED.
exit /b 0
