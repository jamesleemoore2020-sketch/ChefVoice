import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeFeedPages } from '../js/community-feed.js';

const client = readFileSync(new URL('../js/firebase-client.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

const recipe = (id, updatedAt, extra = {}) => ({ id, updatedAt, title: id, ...extra });

test('the feed is newest first across the live page, older pages and linked recipes', () => {
  const head = [recipe('c', 300), recipe('b', 200)];
  const older = [recipe('a', 100)];
  const linked = [recipe('z', 50)];
  assert.deepEqual(mergeFeedPages(head, older, linked).map((r) => r.id), ['c', 'b', 'a', 'z']);
});

test('a recipe edited after its page loaded appears once, as its live copy', () => {
  // Editing a recipe bumps updatedAt, which moves it out of an older page into the head.
  const head = [recipe('a', 400, { title: 'Edited' }), recipe('c', 300)];
  const older = [recipe('a', 100, { title: 'Stale' }), recipe('d', 90)];
  const merged = mergeFeedPages(head, older, []);
  assert.deepEqual(merged.map((r) => r.id), ['a', 'c', 'd']);
  assert.equal(merged[0].title, 'Edited');
});

test('empty and missing pages are harmless', () => {
  assert.deepEqual(mergeFeedPages(), []);
  assert.deepEqual(mergeFeedPages([], undefined, null), []);
  assert.deepEqual(mergeFeedPages([{ title: 'no id' }]), []);
});

test('the feed query asks for the newest public recipes, as Android does', () => {
  // Without an orderBy Firestore returned the first 100 public recipes by document id --
  // random UUIDs -- so past 100 recipes a newly published dish appeared only by luck.
  const feed = client.slice(client.indexOf('export function observePublicRecipes'), client.indexOf('export async function loadMorePublicRecipes'));
  assert.match(feed, /where\('isPublic','==',true\),orderBy\('updatedAt','desc'\),limit\(COMMUNITY_PAGE_SIZE\)/);
  const more = client.slice(client.indexOf('export async function loadMorePublicRecipes'));
  assert.match(more, /orderBy\('updatedAt','desc'\),startAfter\(cursor\),limit\(COMMUNITY_PAGE_SIZE\)/);
  // The composite index this needs is the one Android's feed already uses.
  const indexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
  assert.ok(indexes.indexes.some((i) => i.collectionGroup === 'recipes'
    && JSON.stringify(i.fields) === JSON.stringify([
      { fieldPath: 'isPublic', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' }
    ])), 'firestore.indexes.json must keep the isPublic ASC, updatedAt DESC index');
});

test('Discover offers older recipes, and a shared link reaches past the first page', () => {
  assert.match(app, /id="communityLoadMore"/);
  assert.match(app, /async function openSharedRecipe\(id\)/);
  assert.match(app, /cloud\.api\.getPublicRecipe\(id\)/);
});
