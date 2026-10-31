import type { FieldError, FieldErrorCode } from './messaging';

const DEFAULTS: Record<FieldErrorCode, Omit<FieldError, 'message' | 'code'>> = {
  bad_key: {
    retryable: false,
    action: { label: 'Open Settings', optionsTab: 'settings' },
  },
  rate_limit: {
    retryable: true,
    action: { label: 'Open Settings', optionsTab: 'settings' },
  },
  no_vault: {
    retryable: false,
    action: { label: 'Open Vault', optionsTab: 'vault' },
  },
  vault_load_failed: {
    retryable: true,
  },
  permission_denied: {
    retryable: true,
    action: { label: 'Open Settings', optionsTab: 'settings' },
  },
  timeout: {
    retryable: true,
  },
  network: {
    retryable: true,
  },
  no_connection: {
    retryable: true,
  },
  api_error: {
    retryable: true,
    action: { label: 'Open Settings', optionsTab: 'settings' },
  },
  empty_response: {
    retryable: true,
    action: { label: 'Open Settings', optionsTab: 'settings' },
  },
  unknown: {
    retryable: true,
  },
};

export function makeFieldError(
  code: FieldErrorCode,
  message: string,
  overrides: Partial<Pick<FieldError, 'retryable' | 'action'>> = {}
): FieldError {
  return {
    code,
    message,
    ...DEFAULTS[code],
    ...overrides,
  };
}

export function fieldErrorFromStream(code: string, message: string): FieldError {
  switch (code) {
    case 'bad_key':
      return makeFieldError(
        'bad_key',
        'Your API key was rejected. Add or replace it in Settings, then retry.'
      );
    case 'rate_limit':
      return makeFieldError(
        'rate_limit',
        'The model is rate limited. Wait a minute or switch models in Settings.'
      );
    case 'network':
      return makeFieldError(
        'network',
        `Network error. Check your connection and try again. ${message}`.trim()
      );
    case 'api_error':
      return makeFieldError('api_error', message || 'The model API returned an error.');
    case 'empty_response':
      return makeFieldError(
        'empty_response',
        'The model returned no text. Reasoning models can use the whole output budget on reasoning; try again, increase Max Length, or switch models.'
      );
    default:
      return makeFieldError('unknown', message || 'Something went wrong. Try again.');
  }
}
