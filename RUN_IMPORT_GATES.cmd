@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice recipe-import gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
rem The whole importer is pure functions with injectable fetch and DNS, so these are real
rem behaviour tests rather than source-text checks: every URL rule, every redirect rule and
rem every parsed ingredient line is actually executed here.
node --test "import/functions/*.test.js"
if errorlevel 1 exit /b 1
node --check import\functions\index.js
if errorlevel 1 exit /b 1
echo.
echo NOTE: these gates cannot evaluate a Firestore security rule. The daily import
echo counter lives at importUsage/{uid}, a path firestore.rules never matches and
echo therefore denies to every client - run RUN_RULES_GATES.cmd if that ever changes.
echo.
echo CHEFVOICE IMPORT GATES PASSED.
exit /b 0
