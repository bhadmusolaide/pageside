import type { VaultItem } from './vault';

export type RetrievalMode = 'keyword' | 'tfidf' | 'embeddings';

export interface RetrievalResult {
  context: string;
  usedItems: VaultItem[];
}

interface Scored {
  item: VaultItem;
  index: number;
  score: number;
}

const EMBEDDING_DIMENSIONS = 512;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function withBigrams(tokens: string[]): string[] {
  const out = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return out;
}

function hashTerm(term: string): number {
  let hash = 2166136261;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function inverseDocumentFrequency(corpusTokens: string[][]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const tokens of corpusTokens) {
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const total = Math.max(1, corpusTokens.length);
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log(1 + total / df));
  }
  return idf;
}

interface SparseVector {
  terms: Map<string, number>;
  norm: number;
}

function buildSparseVector(tokens: string[], idf: Map<string, number>): SparseVector {
  const counts = termFrequencies(tokens);
  const total = Math.max(1, tokens.length);
  const terms = new Map<string, number>();
  let squared = 0;

  for (const [term, count] of counts) {
    const weight = (count / total) * (idf.get(term) ?? Math.log(2));
    terms.set(term, weight);
    squared += weight * weight;
  }

  return { terms, norm: Math.sqrt(squared) };
}

function sparseCosine(a: SparseVector, b: SparseVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] = a.terms.size <= b.terms.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small.terms) {
    const other = large.terms.get(term);
    if (other) dot += weight * other;
  }
  return dot / (a.norm * b.norm);
}

interface DenseVector {
  values: Float64Array;
  norm: number;
}

/**
 * Feature-hashing embedding: TF-IDF-weighted unigrams and bigrams projected
 * into a fixed-size signed vector. This is a dependency-free local embedding
 * (no network, no model download) and a drop-in extension point for swapping
 * in transformers.js later.
 */
function buildEmbedding(tokens: string[], idf: Map<string, number>): DenseVector {
  const values = new Float64Array(EMBEDDING_DIMENSIONS);
  const total = Math.max(1, tokens.length);
  const counts = termFrequencies(withBigrams(tokens));

  for (const [term, count] of counts) {
    const rawHash = hashTerm(term);
    const index = rawHash % EMBEDDING_DIMENSIONS;
    const sign = (rawHash >>> 16) & 1 ? -1 : 1;
    const weight = (count / total) * (idf.get(term) ?? Math.log(2));
    values[index] += sign * weight;
  }

  let squared = 0;
  for (let i = 0; i < values.length; i++) squared += values[i] * values[i];
  return { values, norm: Math.sqrt(squared) };
}

function denseCosine(a: DenseVector, b: DenseVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  let dot = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) dot += a.values[i] * b.values[i];
  return dot / (a.norm * b.norm);
}

function assembleContext(scored: Scored[], maxTokens: number): RetrievalResult {
  const budget = Math.min(12000, Math.max(1000, maxTokens));
  const used: VaultItem[] = [];
  const parts: string[] = [];
  let total = 0;

  for (const { item, score } of scored) {
    if (score <= 0) break;
    const header = `--- ${item.type.toUpperCase()}: ${item.title} ---`;
    const headerTokens = Math.ceil(header.length / 3.5) + 1;
    const remaining = budget - total - headerTokens;
    if (remaining <= 0) continue;

    const content = item.content ?? '';
    const wholeTokens = Math.ceil(content.length / 3.5) + 1;
    if (wholeTokens <= remaining) {
      total += headerTokens + wholeTokens;
      used.push(item);
      parts.push(header, content);
      continue;
    }

    const truncated = content.substring(0, Math.max(200, Math.floor(remaining * 3.5)));
    total += headerTokens + Math.ceil(truncated.length / 3.5) + 1;
    used.push(item);
    parts.push(header, truncated);
  }

  return { context: parts.join('\n\n'), usedItems: used };
}

export function retrieveByTfIdf(
  query: string,
  vaultItems: VaultItem[],
  maxTokens: number = 6000
): RetrievalResult {
  if (!Array.isArray(vaultItems) || vaultItems.length === 0) {
    return { context: '', usedItems: [] };
  }

  const corpusTokens = vaultItems.map(item => tokenize(`${item.title}\n${item.content}`));
  const idf = inverseDocumentFrequency(corpusTokens);
  const itemVectors = corpusTokens.map(tokens => buildSparseVector(tokens, idf));
  const queryVector = buildSparseVector(tokenize(query), idf);

  const scored: Scored[] = vaultItems
    .map((item, index) => ({
      item,
      index,
      score: sparseCosine(queryVector, itemVectors[index]),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return assembleContext(scored, maxTokens);
}

export function retrieveByEmbeddings(
  query: string,
  vaultItems: VaultItem[],
  maxTokens: number = 6000
): RetrievalResult {
  if (!Array.isArray(vaultItems) || vaultItems.length === 0) {
    return { context: '', usedItems: [] };
  }

  const corpusTokens = vaultItems.map(item => tokenize(`${item.title}\n${item.content}`));
  const idf = inverseDocumentFrequency(corpusTokens.map(withBigrams));
  const itemVectors = corpusTokens.map(tokens => buildEmbedding(tokens, idf));
  const queryVector = buildEmbedding(tokenize(query), idf);

  const scored: Scored[] = vaultItems
    .map((item, index) => ({
      item,
      index,
      score: denseCosine(queryVector, itemVectors[index]),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return assembleContext(scored, maxTokens);
}
