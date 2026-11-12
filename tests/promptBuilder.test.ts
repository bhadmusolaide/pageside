import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnswerStyle, stripNeedsInputMarkers } from '../src/lib/answerText.ts';
import { buildChatSystemPrompt, buildChatUserPrompt } from '../src/lib/chatPrompt.ts';

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

test('chat prompts include page context, vault, conversation, and language', () => {
  const user = buildChatUserPrompt({
    question: 'What should I emphasize?',
    pageContext: {
      title: 'Engineer at Acme',
      url: 'https://jobs.example/acme',
      visibleText: '',
      companyName: 'Acme',
      jobTitle: 'Engineer',
      jobDescription: 'Build reliable systems. '.repeat(10),
    },
    vaultContext: '--- RESUME: Jane ---\nEngineer with 5 years of experience.',
    conversationContext: 'User: Hi\nAssistant: Hello',
    maxLength: 300,
  });

  assert.match(user, /Company: Acme/);
  assert.match(user, /Role: Engineer/);
  assert.match(user, /Relevant background information/);
  assert.match(user, /Recent conversation/);
  assert.match(user, /under 300 words/);
  assert.match(buildChatSystemPrompt('es'), /language with code: es/);
});
