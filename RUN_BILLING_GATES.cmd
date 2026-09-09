@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice launch access / billing gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
node --test billing\launch-access.test.js
if errorlevel 1 exit /b 1
node --check billing\functions\index.js
if errorlevel 1 exit /b 1
echo.
echo NOTE: these gates match source text and check the deploy scoping. They cannot
echo evaluate a security rule - run RUN_RULES_GATES.cmd for that, which covers the
echo config/monetization and entitlement rules this codebase depends on.
echo.
echo CHEFVOICE BILLING GATES PASSED.
exit /b 0
