import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationUnread, otherParticipant, otherParticipantName, threadComments,
  unreadCounts, withoutBlocked
} from '../js/inbox.js';

const ME = 'uid-me';
const THEM = 'uid-them';
const conversation = (over = {}) => ({
  id: [ME, THEM].sort().join('--'),
  participantIds: [ME, THEM].sort(),
  participantNames: { [ME]: 'Chef Me', [THEM]: 'Chef Them' },
  lastMessage: 'hi',
  lastSenderId: THEM,
  createdAt: 1000,
  updatedAt: 2000,
  ...over
});

test('the other participant is whoever is not you', () => {
  assert.equal(otherParticipant(conversation(), ME), THEM);
  assert.equal(otherParticipant(conversation(), THEM), ME);
  assert.equal(otherParticipantName(conversation(), ME), 'Chef Them');
  assert.equal(otherParticipantName(conversation(), THEM), 'Chef Me');
  // A malformed conversation must not throw in a render path.
  assert.equal(otherParticipant(null, ME), '');
  assert.equal(otherParticipantName({}, ME), 'Chef');
});

test('a conversation is unread only when the other chef spoke last', () => {
  assert.equal(conversationUnread(conversation(), ME, {}), true);
  assert.equal(conversationUnread(conversation(), ME, { [conversation().id]: 2000 }), false);
  assert.equal(conversationUnread(conversation(), ME, { [conversation().id]: 3000 }), false);
  // Your own message bumps updatedAt too. Without the sender check this would
  // badge every message you sent as unread against yourself.
  assert.equal(conversationUnread(conversation({ lastSenderId: ME }), ME, {}), false);
});

test('unread counts cover both halves of the inbox', () => {
  const conversations = [
    conversation({ id: 'a--b', updatedAt: 500 }),
    conversation({ id: 'c--d', updatedAt: 900, lastSenderId: ME }),
    conversation({ id: 'e--f', updatedAt: 100 })
  ];
  const notifications = [{ readAt: 0 }, { readAt: 123 }, { readAt: 0 }];
  const reads = { 'e--f': 100 };
  assert.deepEqual(unreadCounts(conversations, notifications, ME, reads), { messages: 1, activity: 2 });
  assert.deepEqual(unreadCounts([], [], ME, {}), { messages: 0, activity: 0 });
});

test('comments thread one level deep', () => {
  const comments = [
    { id: 'c1', authorId: 'a', parentCommentId: '' },
    { id: 'c2', authorId: 'b', parentCommentId: 'c1' },
    { id: 'c3', authorId: 'c', parentCommentId: 'c1' },
    { id: 'c4', authorId: 'd', parentCommentId: '' }
  ];
  const { roots, repliesFor } = threadComments(comments);
  assert.deepEqual(roots.map((c) => c.id), ['c1', 'c4']);
  assert.deepEqual(repliesFor('c1').map((c) => c.id), ['c2', 'c3']);
  assert.deepEqual(repliesFor('c4'), []);
});

test('a reply whose parent is gone is promoted, not dropped', () => {
  // The parent was deleted, or its author is blocked and it was filtered out
  // before threading. Dropping the reply would silently hide a conversation the
  // chef is part of.
  const { roots, repliesFor } = threadComments([
    { id: 'orphan', authorId: 'a', parentCommentId: 'deleted-parent' },
    { id: 'top', authorId: 'b', parentCommentId: '' }
  ]);
  assert.deepEqual(roots.map((c) => c.id), ['orphan', 'top']);
  assert.deepEqual(repliesFor('deleted-parent'), []);
});

test('blocked authors are filtered out of any list', () => {
  const items = [{ authorId: 'a' }, { authorId: 'blocked' }, { authorId: 'c' }];
  assert.deepEqual(withoutBlocked(items, new Set(['blocked'])).map((i) => i.authorId), ['a', 'c']);
  assert.deepEqual(withoutBlocked(items, new Set()).length, 3);
  // Conversations key their counterpart differently from recipes/comments.
  const conversations = [{ other: 'blocked' }, { other: 'ok' }];
  assert.deepEqual(withoutBlocked(conversations, new Set(['blocked']), 'other').map((c) => c.other), ['ok']);
});
