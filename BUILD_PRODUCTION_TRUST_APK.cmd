@echo off
setlocal
title ChefVoice v0.10.1 - Build Signed Production APK
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found.
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\BuildProductionTrust.ps1"
exit /b %ERRORLEVEL%
