export type Provider = 'anthropic' | 'openrouter' | 'openai' | 'grok' | 'groq';

export interface ProviderConfig {
  label: string;
  baseUrl: string;
  modelsUrl: string;
  modelsRequireKey: boolean;
  buildHeaders(apiKey: string): Record<string, string>;
  buildModelsHeaders(apiKey: string): Record<string, string>;
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

function buildOpenAiBody(opts: {
  model: string;
  maxTokens: number;
  stream: boolean;
  system?: string;
  messages: { role: string; content: string }[];
}): unknown {
  const messages = [...opts.messages];
  if (opts.system) messages.unshift({ role: 'system', content: opts.system });
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    stream: opts.stream,
    messages,
  };
}

function buildOpenAiBodyWithReasoning(opts: {
  model: string;
  maxTokens: number;
  stream: boolean;
  system?: string;
  messages: { role: string; content: string }[];
}): unknown {
  const body = buildOpenAiBody(opts) as Record<string, unknown>;
  if (/^(o[1-9]|gpt-5)/i.test(opts.model)) {
    body.max_completion_tokens = opts.maxTokens;
    delete body.max_tokens;
  }
  return body;
}

const openAiDelta = (parsed: any): string => parsed?.choices?.[0]?.delta?.content ?? '';
const openAiError = (parsed: any): string | null => parsed?.error?.message ?? null;
const bearer = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiKey}`,
});

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    modelsUrl: 'https://api.anthropic.com/v1/models?limit=1000',
    modelsRequireKey: true,
    buildHeaders: apiKey => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    buildModelsHeaders: apiKey => ({
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
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    modelsRequireKey: false,
    buildHeaders: bearer,
    // The catalog is public; do not attach the user's key so a key for another
    // provider cannot break model discovery.
    buildModelsHeaders: () => ({}),
    buildBody: buildOpenAiBody,
    extractTextDelta: openAiDelta,
    extractError: openAiError,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
    modelsRequireKey: true,
    buildHeaders: bearer,
    buildModelsHeaders: bearer,
    buildBody: buildOpenAiBodyWithReasoning,
    extractTextDelta: openAiDelta,
    extractError: openAiError,
  },
  grok: {
    label: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    modelsUrl: 'https://api.x.ai/v1/models',
    modelsRequireKey: true,
    buildHeaders: bearer,
    buildModelsHeaders: bearer,
    buildBody: buildOpenAiBody,
    extractTextDelta: openAiDelta,
    extractError: openAiError,
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    modelsRequireKey: true,
    buildHeaders: bearer,
    buildModelsHeaders: bearer,
    buildBody: buildOpenAiBody,
    extractTextDelta: openAiDelta,
    extractError: openAiError,
  },
};

const NON_CHAT_MODEL_RE = /(embedding|embed-|whisper|tts-|dall-e|moderation|sora|stable-diffusion|image|audio|transcribe|realtime|rerank|guard|speech)/i;

export function isChatModel(provider: string, id: string): boolean {
  if (provider === 'openai' || provider === 'groq' || provider === 'grok') {
    return !NON_CHAT_MODEL_RE.test(id);
  }
  return true;
}

export function getProviderConfig(provider: string): ProviderConfig {
  return PROVIDERS[provider as Provider] ?? PROVIDERS.openrouter;
}
