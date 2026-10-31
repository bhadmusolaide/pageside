export type Provider = 'anthropic' | 'openrouter';

export interface ProviderConfig {
  baseUrl: string;
  buildHeaders(apiKey: string): Record<string, string>;
  buildBody(opts: {
    model: string;
    maxTokens: number;
    stream: boolean;
    system?: string;
    messages: { role: string; content: string }[];
  }): unknown;
  extractTextDelta(parsed: unknown): string;
  extractError(parsed: unknown): string | null;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    buildHeaders: apiKey => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: ({ model, maxTokens, stream, system, messages }) => ({
      model,
      max_tokens: maxTokens,
      stream,
      system,
      messages,
    }),
    extractTextDelta: (parsed: any) =>
      parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta'
        ? parsed.delta.text ?? ''
        : '',
    extractError: (parsed: any) =>
      parsed?.type === 'error' ? (parsed?.error?.message ?? 'API error') : null,
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    buildHeaders: apiKey => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }),
    buildBody: ({ model, maxTokens, stream, system, messages }) => {
      const body: {
        model: string;
        max_tokens: number;
        stream: boolean;
        messages: { role: string; content: string }[];
        system?: string;
      } = {
        model,
        max_tokens: maxTokens,
        stream,
        messages,
      };
      if (system) {
        body.messages = [{ role: 'system', content: system }, ...messages];
      }
      return body;
    },
    extractTextDelta: (parsed: any) => parsed?.choices?.[0]?.delta?.content ?? '',
    extractError: (parsed: any) => parsed?.error?.message ?? null,
  },
};

export function getProviderConfig(provider: string): ProviderConfig {
  return PROVIDERS[provider as Provider] ?? PROVIDERS.openrouter;
}