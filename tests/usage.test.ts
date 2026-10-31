import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsage,
  clampContextBudget,
  clampHistoryLimit,
  estimateTokens,
  formatTokens,
  outputBudgetFor,
  estimateCost,
  formatCost,
} from '../src/lib/usage.ts';

test('context budget defaults and clamps to the supported range', () => {
  assert.equal(clampContextBudget(undefined), 6000);
  assert.equal(clampContextBudget(200), 1000);
  assert.equal(clampContextBudget(20000), 12000);
  assert.equal(clampContextBudget(4500), 4500);
});

test('history limit is capped at ten entries', () => {
  assert.equal(clampHistoryLimit(undefined), 3);
  assert.equal(clampHistoryLimit(-1), 0);
  assert.equal(clampHistoryLimit(99), 10);
});

test('output budget scales with word limit and stays below the old fixed cap', () => {
  assert.ok(outputBudgetFor(500) < 4096);
  assert.ok(outputBudgetFor(2000) <= 2048);
  assert.equal(outputBudgetFor(500, true), 900);
});

test('provider usage is used when available and estimated otherwise', () => {
  const exact = buildUsage({
    systemPrompt: 'system',
    prompt: 'prompt',
    answer: 'answer',
    providerInput: 1234,
    providerOutput: 56,
  });
  assert.deepEqual(exact, { inputTokens: 1234, outputTokens: 56, estimated: false, costUsd: undefined });

  const estimated = buildUsage({ systemPrompt: 'system', prompt: 'prompt', answer: 'answer' });
  assert.equal(estimated.estimated, true);
  assert.ok(estimated.inputTokens > 0);
  assert.ok(estimated.outputTokens > 0);
});

test('estimated cost uses known model pricing and stays blank for unknown models', () => {
  const sonnet = estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'anthropic/claude-3.5-sonnet');
  assert.equal(sonnet, 18);

  const mini = estimateCost({ inputTokens: 1_000_000, outputTokens: 0 }, 'openai/gpt-4o-mini');
  assert.equal(mini, 0.15);

  assert.equal(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'gpt-4.1-mini'), 2);
  assert.equal(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'grok-4-fast-reasoning'), 0.7);
  assert.equal(estimateCost({ inputTokens: 1_000_000, outputTokens: 0 }, 'llama-3.1-8b-instant'), 0.05);

  assert.equal(estimateCost({ inputTokens: 100, outputTokens: 100 }, 'unknown/model'), null);
  assert.equal(formatCost(0.00234), '$0.0023');
  assert.equal(formatCost(0.00001), '<$0.0001');
});

test('buildUsage attaches a cost estimate when the model is priced', () => {
  const usage = buildUsage({
    systemPrompt: '',
    prompt: '',
    answer: '',
    providerInput: 1_000_000,
    providerOutput: 1_000_000,
    model: 'anthropic/claude-3.5-sonnet',
  });
  assert.equal(usage.costUsd, 18);
});

test('token estimates and formatting are stable', () => {
  assert.equal(estimateTokens('abcd'), 2);
  assert.equal(formatTokens(850), '850');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(12000), '12k');
});

