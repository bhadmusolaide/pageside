export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  costUsd?: number;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// Approximate public list prices, USD per million tokens. Used only for a
// display estimate; provider-reported usage stays authoritative for tokens.
const MODEL_PRICING: Array<{ match: RegExp; pricing: ModelPricing }> = [
  { match: /claude.*(opus|5-5-opus)|opus-4/i, pricing: { inputPerMillion: 15, outputPerMillion: 75 } },
  { match: /claude.*haiku|haiku/i, pricing: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  { match: /claude|sonnet/i, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
  { match: /gpt-4o-mini/i, pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
  { match: /gpt-4\.1-mini/i, pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 } },
  { match: /gpt-4\.1/i, pricing: { inputPerMillion: 2, outputPerMillion: 8 } },
  { match: /gpt-4o/i, pricing: { inputPerMillion: 2.5, outputPerMillion: 10 } },
  { match: /o3-mini|o1-mini/i, pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 } },
  { match: /grok-4-fast/i, pricing: { inputPerMillion: 0.2, outputPerMillion: 0.5 } },
  { match: /grok/i, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
  { match: /gpt-oss-120b/i, pricing: { inputPerMillion: 0.15, outputPerMillion: 0.75 } },
  { match: /gpt-oss-20b/i, pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3 } },
  { match: /qwen3-32b/i, pricing: { inputPerMillion: 0.29, outputPerMillion: 0.59 } },
  { match: /llama.*8b/i, pricing: { inputPerMillion: 0.05, outputPerMillion: 0.08 } },
  { match: /deepseek-r1-distill/i, pricing: { inputPerMillion: 0.75, outputPerMillion: 0.99 } },
  { match: /llama.*70b/i, pricing: { inputPerMillion: 0.59, outputPerMillion: 0.79 } },
  { match: /gemini.*flash/i, pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { match: /deepseek/i, pricing: { inputPerMillion: 0.27, outputPerMillion: 1.1 } },
  { match: /mistral-large/i, pricing: { inputPerMillion: 2, outputPerMillion: 6 } },
];

let pricingCache = new Map<string, ModelPricing | null>();

function pricingFor(model?: string): ModelPricing | null {
  if (!model) return null;
  const key = model.toLowerCase();
  if (pricingCache.has(key)) return pricingCache.get(key) ?? null;
  const found = MODEL_PRICING.find(entry => entry.match.test(key))?.pricing ?? null;
  pricingCache.set(key, found);
  return found;
}

export function estimateCost(
  usage: Pick<GenerationUsage, 'inputTokens' | 'outputTokens'>,
  model?: string
): number | null {
  const pricing = pricingFor(model);
  if (!pricing) return null;
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return cost > 0 ? cost : 0;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '';
  if (usd > 0 && usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

const DEFAULT_CONTEXT_BUDGET = 6000;
const MIN_CONTEXT_BUDGET = 1000;
const MAX_CONTEXT_BUDGET = 12000;
const DEFAULT_HISTORY_LIMIT = 3;
const MAX_HISTORY_LIMIT = 10;

export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 3.5);
}

export function clampContextBudget(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONTEXT_BUDGET;
  return Math.min(MAX_CONTEXT_BUDGET, Math.max(MIN_CONTEXT_BUDGET, Math.round(parsed)));
}

export function clampHistoryLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(0, Math.round(parsed)));
}

export function outputBudgetFor(maxLength: number, document = false): number {
  if (document) return 2048;
  const words = Number.isFinite(maxLength) ? Math.max(1, maxLength) : 500;
  return Math.min(2048, Math.max(128, Math.ceil(words * 1.6) + 100));
}

export function buildUsage(params: {
  systemPrompt: string;
  prompt: string;
  answer: string;
  providerInput?: number;
  providerOutput?: number;
  model?: string;
}): GenerationUsage {
  const estimatedInput = estimateTokens(params.systemPrompt) + estimateTokens(params.prompt);
  const estimatedOutput = estimateTokens(params.answer);
  const hasProviderInput = typeof params.providerInput === 'number' && params.providerInput > 0;
  const hasProviderOutput = typeof params.providerOutput === 'number' && params.providerOutput >= 0;
  const inputTokens = hasProviderInput ? params.providerInput! : estimatedInput;
  const outputTokens = hasProviderOutput ? params.providerOutput! : estimatedOutput;
  const cost = estimateCost({ inputTokens, outputTokens }, params.model);
  return {
    inputTokens,
    outputTokens,
    estimated: !hasProviderInput || !hasProviderOutput,
    costUsd: cost ?? undefined,
  };
}

export function noUsage(): GenerationUsage {
  return { inputTokens: 0, outputTokens: 0, estimated: false };
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`;
  return String(Math.max(0, Math.round(tokens)));
}
