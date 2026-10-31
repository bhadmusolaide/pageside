import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnswerStyle, stripNeedsInputMarkers } from '../src/lib/answerText.ts';

test('stripNeedsInputMarkers preserves paragraph line breaks', () => {
  const input = 'Dear Hiring Manager,\n\nI am excited to apply.\n\nSincerely,\nJane';
  assert.equal(stripNeedsInputMarkers(input), input);
});

test('stripNeedsInputMarkers removes markers without flattening paragraphs', () => {
  const input = 'First paragraph.\n\nSecond paragraph NEEDS INPUT: team size.\n\nThird paragraph.';
  const output = stripNeedsInputMarkers(input);
  assert.ok(!/NEEDS\s+INPUT/i.test(output));
  assert.equal(output, 'First paragraph.\n\nSecond paragraph\n\nThird paragraph.');
});

test('sanitizeAnswerStyle keeps paragraph breaks after cleanup', () => {
  const input = 'Here is a draft:\n\n**First** paragraph.\n\nSecond paragraph.';
  const output = sanitizeAnswerStyle(input);
  assert.equal(output, 'First paragraph.\n\nSecond paragraph.');
});
