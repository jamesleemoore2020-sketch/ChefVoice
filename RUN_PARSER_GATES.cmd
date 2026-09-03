@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice shared parser gates ===
echo.

echo [1/2] PWA tests...
pushd web
call npm test
if errorlevel 1 (
  popd
  echo PWA tests FAILED.
  exit /b 1
)
popd

echo.
echo [2/2] Android JVM tests...
call gradlew.bat :app:testDebugUnitTest
if errorlevel 1 (
  echo Android tests FAILED.
  exit /b 1
)

echo.
echo ALL CHEFVOICE PARSER GATES PASSED.
exit /b 0
