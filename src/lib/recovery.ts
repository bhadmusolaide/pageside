import type { AnswerProvenance, GenerationUsage } from './messaging';
import type { AnswerSource } from './messaging';
import type { DetectedField } from './fieldDetector';

export interface RecoveredDraft {
  frameId: number;
  fieldId: string;
  fieldType: string;
  label: string;
  selector: string;
  valueFingerprint: string;
  draft: string;
  source: AnswerProvenance | null;
  sources: string[];
  sourceDetails: AnswerSource[];
  flags: string[];
  usage: GenerationUsage | null;
  updatedAt: number;
}

export interface RecoveredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources: AnswerSource[];
  usage?: GenerationUsage;
  error?: string;
  pending?: boolean;
  stopped?: boolean;
}

export interface PageRecovery {
  version: 1;
  drafts: RecoveredDraft[];
  chat: RecoveredChatMessage[];
  updatedAt: number;
}

export const RECOVERY_ENABLED_KEY = 'sr-recovery-enabled';
export const RECOVERY_STORAGE_PREFIX = 'sr-page-recovery-';
const MAX_SAVED_DRAFTS = 100;
const MAX_SAVED_CHAT_MESSAGES = 60;
let writeQueue: Promise<void> = Promise.resolve();

export function pageRecoveryStorageKey(pageUrl: string): string {
  let base = pageUrl;
  try {
    const url = new URL(pageUrl);
    base = `${url.origin}${url.pathname}${url.search}`;
  } catch {
    base = pageUrl.split('#', 1)[0];
  }

  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${RECOVERY_STORAGE_PREFIX}${(hash >>> 0).toString(16)}`;
}

export function fingerprintFieldValue(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function isRecoveredDraftStale(
  draft: Pick<RecoveredDraft, 'fieldType' | 'label' | 'selector' | 'valueFingerprint'>,
  field: Pick<DetectedField, 'type' | 'label' | 'placeholder' | 'selector' | 'currentValue'>
): boolean {
  return draft.fieldType !== field.type ||
    draft.label !== (field.label ?? field.placeholder ?? '') ||
    draft.selector !== field.selector ||
    draft.valueFingerprint !== fingerprintFieldValue(field.currentValue);
}

export function normalizeRecoveryDrafts(drafts: RecoveredDraft[]): RecoveredDraft[] {
  const latest = new Map<string, RecoveredDraft>();
  for (const draft of drafts) {
    if (!draft.draft.trim()) continue;
    latest.set(`${draft.frameId}:${draft.fieldId}`, {
      ...draft,
      draft: draft.draft.slice(0, 20000),
      sources: draft.sources.slice(0, 30),
      sourceDetails: (Array.isArray(draft.sourceDetails) ? draft.sourceDetails : []).slice(0, 30).map(source => ({
        ...source,
        excerpt: source.excerpt?.slice(0, 500),
      })),
      flags: draft.flags.slice(0, 30),
    });
  }
  return [...latest.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_DRAFTS);
}

export function normalizeRecoveryChat(messages: RecoveredChatMessage[]): RecoveredChatMessage[] {
  return messages
    .filter(message => message.text.trim())
    .slice(-MAX_SAVED_CHAT_MESSAGES)
    .map(message => ({
      ...message,
      text: message.text.slice(0, 20000),
      pending: undefined,
      error: message.pending ? 'Response interrupted when the panel closed.' : message.error,
      stopped: message.stopped || message.pending || undefined,
    }));
}

export async function getPageRecovery(pageUrl: string): Promise<PageRecovery | null> {
  const key = pageRecoveryStorageKey(pageUrl);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key] as PageRecovery | undefined;
  if (!value || value.version !== 1) return null;
  return {
    version: 1,
    drafts: Array.isArray(value.drafts) ? value.drafts.map(draft => ({
      ...draft,
      sourceDetails: Array.isArray(draft.sourceDetails) ? draft.sourceDetails : [],
    })) : [],
    chat: Array.isArray(value.chat) ? value.chat : [],
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

export async function savePageDrafts(pageUrl: string, drafts: RecoveredDraft[]): Promise<void> {
  await updatePageRecovery(pageUrl, recovery => ({
    ...recovery,
    drafts: normalizeRecoveryDrafts(drafts),
    updatedAt: Date.now(),
  }));
}

export async function savePageChat(pageUrl: string, chat: RecoveredChatMessage[]): Promise<void> {
  await updatePageRecovery(pageUrl, recovery => ({
    ...recovery,
    chat: normalizeRecoveryChat(chat),
    updatedAt: Date.now(),
  }));
}

async function updatePageRecovery(
  pageUrl: string,
  update: (recovery: PageRecovery) => PageRecovery
): Promise<void> {
  await enqueue(async () => {
    const preference = await chrome.storage.local.get({ [RECOVERY_ENABLED_KEY]: false });
    if (preference[RECOVERY_ENABLED_KEY] !== true) return;
    const key = pageRecoveryStorageKey(pageUrl);
    const current = await getPageRecovery(pageUrl) ?? {
      version: 1 as const,
      drafts: [],
      chat: [],
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [key]: update(current) });
  });
}

export async function clearPageRecoveries(): Promise<void> {
  await enqueue(async () => {
    const all = await chrome.storage.local.get();
    const keys = Object.keys(all).filter(key => key.startsWith(RECOVERY_STORAGE_PREFIX));
    if (keys.length > 0) await chrome.storage.local.remove(keys);
  });
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}
