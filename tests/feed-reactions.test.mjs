import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('there is no thumbs-down on startups — the button does not exist', () => {
  const feed = read('mobile/src/screens/FeedScreen.tsx');
  assert.doesNotMatch(feed, /ThumbsDown/, 'the thumbs-down icon must not exist on startups');
  assert.doesNotMatch(feed, /handleDislike/, 'the dislike action must not exist');
  assert.doesNotMatch(feed, /disliked your startup/, 'nobody gets told their startup was disliked');
  // Likes, comments and shares keep their place — encouragement stays public.
  assert.match(feed, /onPress={handleLike}/);
  assert.match(feed, /\{likesCount\}/);
});
