@echo off
setlocal
title ChefVoice - Build and Install
cd /d "%~dp0"

cls
echo ========================================================================
echo                 CHEFVOICE - BUILD AND INSTALL
echo ========================================================================
echo.
echo This window will stay open so you can see any build/install error.
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found.
  echo Install/enable Windows PowerShell and try again.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\BuildAndInstall.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo ========================================================================
  echo Build/install did not complete. The window is staying open.
  echo Read the error above or send me build_install.log.
  echo ========================================================================
) else (
  echo ========================================================================
  echo Finished.
  echo ========================================================================
)
echo.
pause
exit /b %EXITCODE%
