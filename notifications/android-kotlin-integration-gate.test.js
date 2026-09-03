const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt'), 'utf8');
const models = fs.readFileSync(path.join(root, 'app/src/main/java/com/chefvoice/app/model/Models.kt'), 'utf8');
const repo = fs.readFileSync(path.join(root, 'app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt'), 'utf8');

test('RecipeComment model carries reply fields used by FirebaseSocialRepository', () => {
  for (const field of ['parentCommentId', 'replyToUid', 'replyToName']) {
    assert.match(models, new RegExp(`val\\s+${field}:\\s*String`));
  }
});

test('RecipeDetailScreen signature accepts signedInUserId used by reply/report UI', () => {
  const start = app.indexOf('private fun RecipeDetailScreen(');
  assert.notEqual(start, -1);
  const end = app.indexOf(') {', start);
  const signature = app.slice(start, end);
  assert.match(signature, /signedInUserId:\s*String/);
  assert.match(app, /signedInUserId\s*=\s*appState\.signedInUserId/);
});


test('reply-only fields are mapped only onto RecipeComment, not DirectMessage or LiveComment', () => {
  const constructorBlock = (name) => {
    const marker = `${name}(`;
    const start = repo.indexOf(marker);
    assert.notEqual(start, -1, `${name} constructor not found`);
    const end = repo.indexOf('\n                    )', start);
    assert.notEqual(end, -1, `${name} constructor end not found`);
    return repo.slice(start, end);
  };
  const direct = constructorBlock('DirectMessage');
  const live = constructorBlock('LiveComment');
  for (const field of ['parentCommentId', 'replyToUid', 'replyToName']) {
    assert.doesNotMatch(direct, new RegExp(`${field}\\s*=`));
    assert.doesNotMatch(live, new RegExp(`${field}\\s*=`));
  }
  const recipeStart = repo.indexOf('RecipeComment(');
  assert.notEqual(recipeStart, -1);
  const recipeEnd = repo.indexOf('\n                    )', recipeStart);
  const recipe = repo.slice(recipeStart, recipeEnd);
  for (const field of ['parentCommentId', 'replyToUid', 'replyToName']) {
    assert.match(recipe, new RegExp(`${field}\\s*=`));
  }
});

test('NotificationsScreen clear-read parameter is wired consistently across call, signature, state, and repository', () => {
  const state = fs.readFileSync(path.join(root, 'app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt'), 'utf8');
  const start = app.indexOf('private fun NotificationsScreen(');
  assert.notEqual(start, -1);
  const end = app.indexOf(') {', start);
  const signature = app.slice(start, end);
  assert.match(signature, /onClearRead:\s*\(\) -> Unit/);
  assert.match(app, /onClearRead\s*=\s*appState::clearReadNotifications/);
  assert.match(state, /fun clearReadNotifications\(\)/);
  assert.match(repo, /fun deleteNotifications\(notificationIds:\s*Collection<String>/);
});
