@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice notification gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
rem Globbed rather than listed, so a new gate file cannot be written and then never run.
rem .github/workflows/gates.yml runs exactly these two globs in CI.
node --test "notifications/*.test.js" "notifications/functions/*.test.js"
if errorlevel 1 exit /b 1
node --check notifications\functions\index.js
if errorlevel 1 exit /b 1
echo.
echo NOTE: these gates match source text and check path shapes. They cannot
echo evaluate a security rule - run RUN_RULES_GATES.cmd for that.
echo.
echo CHEFVOICE NOTIFICATION GATES PASSED.
exit /b 0
