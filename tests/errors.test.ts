import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFieldError, fieldErrorFromStream } from '../src/lib/errors.ts';

test('bad key errors are not retryable and link to settings', () => {
  const error = makeFieldError('bad_key', 'rejected');
  assert.equal(error.retryable, false);
  assert.equal(error.action?.optionsTab, 'settings');
});

test('missing vault errors link to the vault tab', () => {
  const error = makeFieldError('no_vault', 'empty');
  assert.equal(error.retryable, false);
  assert.equal(error.action?.optionsTab, 'vault');
});

test('timeouts and network failures are retryable', () => {
  assert.equal(makeFieldError('timeout', 'slow').retryable, true);
  assert.equal(makeFieldError('network', 'offline').retryable, true);
  assert.equal(fieldErrorFromStream('network', 'offline').retryable, true);
});

test('stream rate limits keep their recovery action', () => {
  const error = fieldErrorFromStream('rate_limit', '429');
  assert.equal(error.code, 'rate_limit');
  assert.equal(error.retryable, true);
  assert.equal(error.action?.optionsTab, 'settings');
});

test('stream API errors preserve the provider message', () => {
  const error = fieldErrorFromStream('api_error', 'API error (500): boom');
  assert.equal(error.code, 'api_error');
  assert.equal(error.message, 'API error (500): boom');
});
