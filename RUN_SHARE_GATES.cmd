@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice share-link gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
rem The page behind a shared recipe link is built by pure functions, so these run every rule
rem for real: only a public recipe is described, everything a chef wrote is escaped, and only a
rem photo from this project's bucket is handed to a crawler.
node --test "share/functions/*.test.js"
if errorlevel 1 exit /b 1
node --check share\functions\index.js
if errorlevel 1 exit /b 1
echo.
echo CHEFVOICE SHARE GATES PASSED.
exit /b 0
