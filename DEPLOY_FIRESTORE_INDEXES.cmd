@echo off
setlocal
cd /d "%~dp0"
echo.
echo ChefVoice - Deploy Firestore Indexes and Field Overrides
echo Project: chefvoice-d7fec
echo.
echo This deploys ONLY firestore.indexes.json (composite indexes plus the
echo single-field COLLECTION_GROUP overrides). It does NOT deploy Firestore
echo rules, Storage rules, Functions, Hosting, or App Check.
echo.
echo These overrides are required by deleteChefVoiceAccount: its sweep runs
echo collection-group queries over comments.authorId, comments.replyToUid,
echo notifications.actorUid and bookmarks.recipeId. Without them the callable
echo throws FAILED_PRECONDITION mid-sweep and account deletion cannot complete.
echo.
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found on PATH.
  echo Install/login to Firebase CLI, then rerun this file.
  echo.
  pause
  exit /b 1
)
firebase deploy --only firestore:indexes --project chefvoice-d7fec
if errorlevel 1 (
  echo.
  echo FIRESTORE INDEX DEPLOY FAILED
  echo If Firebase authentication expired, run: firebase login --reauth
  echo Then rerun this file.
  echo.
  pause
  exit /b 1
)
echo.
echo FIRESTORE INDEXES DEPLOYED SUCCESSFULLY
echo Verify with: firebase firestore:indexes --project chefvoice-d7fec
pause
