@echo off
setlocal
cd /d "%~dp0"
echo.
echo === ChefVoice v0.10.1 notification gates ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
node --test notifications\firestore-path-shape.test.js notifications\android-kotlin-integration-gate.test.js notifications\functions\followed-live-alerts.test.js notifications\android-live-routing.test.js notifications\android-notification-event-routing.test.js notifications\notification-preferences.test.js notifications\notification-page-cleanup.test.js notifications\new-follower-notifications.test.js notifications\threaded-comment-replies.test.js notifications\safety-block-report.test.js notifications\chef-discovery-following-feed.test.js notifications\navigation-live-recipe-safety.test.js notifications\live-lease-safety.test.js notifications\cloud-stability-cleanup.test.js notifications\cloud-lifecycle-scale-hardening.test.js notifications\production-trust.test.js notifications\recipe-time-metadata.test.js notifications\saved-recipe-media.test.js notifications\security-boundary-hardening.test.js notifications\social-integrity-hardening.test.js
if errorlevel 1 exit /b 1
node --check notifications\functions\index.js
if errorlevel 1 exit /b 1
echo.
echo NOTE: these gates match source text and check path shapes. They cannot
echo evaluate a security rule - run RUN_RULES_GATES.cmd for that.
echo.
echo CHEFVOICE NOTIFICATION GATES PASSED.
exit /b 0
