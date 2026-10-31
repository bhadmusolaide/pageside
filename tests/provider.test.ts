import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderConfig, isChatModel } from '../src/lib/provider.ts';

test('new providers use their OpenAI-compatible endpoints', () => {
  assert.equal(getProviderConfig('openai').baseUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(getProviderConfig('grok').baseUrl, 'https://api.x.ai/v1/chat/completions');
  assert.equal(getProviderConfig('groq').baseUrl, 'https://api.groq.com/openai/v1/chat/completions');

  for (const provider of ['openai', 'grok', 'groq']) {
    const config = getProviderConfig(provider);
    assert.equal(config.buildHeaders('test-key').Authorization, 'Bearer test-key');
    assert.equal(config.modelsRequireKey, true);
  }
});

test('Anthropic keeps its own auth and model headers', () => {
  const config = getProviderConfig('anthropic');
  assert.equal(config.buildHeaders('test-key')['x-api-key'], 'test-key');
  assert.equal(config.buildModelsHeaders('test-key')['anthropic-version'], '2023-06-01');
});

test('OpenAI-compatible bodies prepend the system message', () => {
  const config = getProviderConfig('groq');
  const body = config.buildBody({
    model: 'llama-3.3-70b-versatile',
    maxTokens: 100,
    stream: true,
    system: 'Be concise.',
    messages: [{ role: 'user', content: 'Hello' }],
  }) as any;
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Hello' },
  ]);
  assert.equal(body.max_tokens, 100);
});

test('OpenAI reasoning models use max_completion_tokens', () => {
  const config = getProviderConfig('openai');
  const reasoning = config.buildBody({
    model: 'o3-mini',
    maxTokens: 100,
    stream: true,
    messages: [{ role: 'user', content: 'Hello' }],
  }) as any;
  assert.equal(reasoning.max_completion_tokens, 100);
  assert.equal(reasoning.max_tokens, undefined);

  const standard = config.buildBody({
    model: 'gpt-4o-mini',
    maxTokens: 100,
    stream: true,
    messages: [{ role: 'user', content: 'Hello' }],
  }) as any;
  assert.equal(standard.max_tokens, 100);
});

test('non-chat models are filtered from provider catalogs', () => {
  assert.equal(isChatModel('openai', 'gpt-4o-mini'), true);
  assert.equal(isChatModel('openai', 'text-embedding-3-small'), false);
  assert.equal(isChatModel('openai', 'whisper-1'), false);
  assert.equal(isChatModel('groq', 'whisper-large-v3'), false);
  assert.equal(isChatModel('groq', 'llama-3.3-70b-versatile'), true);
  assert.equal(isChatModel('grok', 'grok-2-image'), false);
  assert.equal(isChatModel('grok', 'grok-4'), true);
});
