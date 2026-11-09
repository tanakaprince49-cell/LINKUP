import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the thumbs-down stays, but no startup ever has to read its dislike count', () => {
  const feed = read('mobile/src/screens/FeedScreen.tsx');
  // The button is still there, still toggles, still fills when you tap it.
  assert.match(feed, /onPress=\{handleDislike\}/);
  assert.match(feed, /name="ThumbsDown"/);
  assert.match(feed, /disliked \? '#EF4444'/);
  // The number beside it is gone — the count is recorded, never displayed.
  assert.doesNotMatch(feed, /\{dislikesCount\}/, 'the dislike count must not render next to the button');
  // Likes keep their count: encouragement stays public, discouragement does not.
  assert.match(feed, /\{likesCount\}/);
});
