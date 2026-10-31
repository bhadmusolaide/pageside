import test from 'node:test';
import assert from 'node:assert/strict';
import { similarityScore } from '../src/lib/history.ts';

test('similarityScore rewards shared significant words', () => {
  const high = similarityScore('Why do you want to work at Stripe?', 'Why do you want to work at Stripe');
  const low = similarityScore('Why do you want to work at Stripe?', 'Describe a technical challenge you solved');
  assert.ok(high > low);
  assert.ok(high >= 4);
});

test('similarityScore ignores short filler words', () => {
  assert.equal(similarityScore('to be or no to be', 'to be or no to be'), 0);
});

test('similarityScore is symmetric', () => {
  const a = 'Tell us about your leadership experience';
  const b = 'Describe your leadership experience';
  assert.equal(similarityScore(a, b), similarityScore(b, a));
});
