import { scanElement, extractPageContext, classifyField, isLikelyFieldIdentifier, type DetectedField } from '../lib/fieldDetector';
import { fillField, undoFill } from '../lib/filler';
import {
  selectRelevantVaultItems,
  buildSystemPrompt,
  buildUserPrompt,
  findDirectVaultAnswer,
  stripNeedsInputMarkers,
  sanitizeAnswerStyle,
  buildCoverLetterPrompt,
  buildVideoScriptPrompt,
  extractSourceExcerpt,
} from '../lib/promptBuilder';
import { similarityScore } from '../lib/history';
import { makeFieldError, fieldErrorFromStream } from '../lib/errors';
import { clampContextBudget, clampHistoryLimit, estimateTokens, formatTokens, formatCost, outputBudgetFor } from '../lib/usage';
import type { RetrievalMode } from '../lib/retrieval';
import { findMatchingProfile, type SiteProfile } from '../lib/profile';
import {
  getVaultProfiles,
  getVaultProfileOverride,
  setVaultProfileOverride,
  resolveVaultProfileId,
  type VaultProfile,
} from '../lib/vaultProfile';
import { findValueForField } from './autoFill';
import { fingerprintFieldValue } from '../lib/recovery';
import {
  initToolbar, onToolbarButton, hideToolbar, destroyToolbar,
  highlightField, unhighlightField, clearHighlights,
  showAnswerCard, updateAnswerCard, closeAnswerCard,
  getActiveCardFieldId, getCardAnswerText, setCardAnswerText, setCardApproved,
  showDocModal, showTriageModal, type DocModalHandle,
  setVaultProfileOptions, onVaultProfileChange,
} from './ui';
import type { VaultItem } from '../lib/vault';
import type { HistoryAnswer } from '../lib/history';
import type {
  AnswerSource, AnswerProvenance, StreamEvent, StreamRequest,
  ContentRequest, ContentResponse,
  PanelFieldInfo, FieldStatus, FieldError, GenerationUsage, VaultProfileOption,
} from '../lib/messaging';

const PROFILES_KEY = 'sr-profiles';

interface CardContext {
  field: DetectedField;
  question: string;
  systemPrompt: string;
  basePrompt: string;
  sources: AnswerSource[];
  maxOutputTokens: number;
}

type DocumentKind = 'cover_letter' | 'video_script';

type StreamTarget =
  | { kind: 'card' }
  | { kind: 'none' }
  | { kind: 'doc'; handle: DocModalHandle; title: string };

const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  cover_letter: 'Cover Letter',
  video_script: 'Video Script',
};

interface DraftSnapshot {
  status: FieldStatus;
  draft: string;
  source: AnswerProvenance | null;
  sources: string[];
  sourceDetails: AnswerSource[];
  flags: string[];
  usage: GenerationUsage | null;
}

let state: {
  fields: DetectedField[];
  fieldElements: Map<string, HTMLElement>;
  vaultItems: VaultItem[];
  scanning: boolean;
} = {
  fields: [],
  fieldElements: new Map<string, HTMLElement>(),
  vaultItems: [],
  scanning: false,
};

const panelStates = new Map<string, PanelFieldInfo>();
const fieldSources = new Map<string, number[]>();
const fieldContexts = new Map<string, CardContext>();
const previousDrafts = new Map<string, DraftSnapshot>();
const retrievalCache = new Map<string, { context: string; usedItems: VaultItem[] }>();
let currentVaultProfileId = 'default';
let currentMatchedProfileName: string | null = null;
let currentVaultProfileOverride = false;
let vaultProfilesCache: VaultProfileOption[] = [{ id: 'default', name: 'Default' }];
let lastDraft: { fieldId: string; text: string } | null = null;

let streamPort: chrome.runtime.Port | null = null;
let activeRequestId: string | null = null;
let pendingFullText = '';
let pendingFieldId: string | null = null;
let lastMeta: { sources: AnswerSource[]; flags: string[] } = { sources: [], flags: [] };
let currentContext: CardContext | null = null;
let historyNote = '';
let streamTarget: StreamTarget = { kind: 'card' };
let activeDocKind: DocumentKind = 'cover_letter';
let activeDocHandle: DocModalHandle | null = null;
const pendingResolvers = new Map<string, () => void>();
let uiWired = false;

/* ------------------------- Extension context lifetime ------------------------- */

let contextInvalid = false;

function extensionAlive(): boolean {
  if (contextInvalid) return false;
  try {
    return typeof chrome !== 'undefined' && chrome.runtime != null && Boolean(chrome.runtime.id);
  } catch {
    return false;
  }
}

function isContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(message);
}

function markContextInvalid(): void {
  if (contextInvalid) return;
  contextInvalid = true;
  try { streamPort?.disconnect(); } catch { /* noop */ }
  streamPort = null;
  activeRequestId = null;
  pendingFieldId = null;
  clearHighlights();
  closeAnswerCard();
}

function handleError(err: unknown): void {
  if (isContextInvalidatedError(err)) {
    markContextInvalid();
    return;
  }
  console.warn('[Pageside]', err);
}

function run(promise: Promise<unknown>): void {
  promise.catch(handleError);
}

async function safeStorageGet<T extends Record<string, unknown>>(defaults: T): Promise<T> {
  if (!extensionAlive()) return defaults;
  try {
    return (await chrome.storage.local.get(defaults)) as T;
  } catch (err) {
    handleError(err);
    return defaults;
  }
}

function safeSend(message: Record<string, unknown>): void {
  if (!extensionAlive()) return;
  try {
    void chrome.runtime.sendMessage(message).catch(handleError);
  } catch (err) {
    handleError(err);
  }
}

/* ------------------------- Storage helpers ------------------------- */

function pageOrigin(): string {
  return window.location.protocol === 'file:' ? 'file://' : window.location.origin;
}

function updateVaultProfileSelector(): void {
  const autoName = vaultProfilesCache.find(profile => profile.id === currentVaultProfileId)?.name ?? 'Default';
  setVaultProfileOptions(
    vaultProfilesCache,
    currentVaultProfileOverride ? currentVaultProfileId : null,
    `Auto — ${autoName}`
  );
}

async function refreshVaultProfile(): Promise<void> {
  try {
    const context = extractPageContext(document);
    const siteProfiles = await loadProfiles();
    const matched = findMatchingProfile(siteProfiles, context);
    const profiles = await getVaultProfiles();
    const origin = pageOrigin();
    const override = await getVaultProfileOverride(origin);
    const id = await resolveVaultProfileId(origin, matched?.vaultProfileId ?? null);

    currentVaultProfileId = id;
    currentVaultProfileOverride = Boolean(override);
    currentMatchedProfileName = matched?.name ?? null;
    vaultProfilesCache = profiles.map(profile => ({ id: profile.id, name: profile.name }));
    updateVaultProfileSelector();
  } catch (err) {
    handleError(err);
  }
}

function emitVaultProfileChanged(): void {
  safeSend({
    type: 'vault_profile_changed',
    vaultProfileId: currentVaultProfileId,
    vaultProfiles: vaultProfilesCache,
    override: currentVaultProfileOverride,
  });
}

async function setVaultProfile(profileId: string | null): Promise<void> {
  await setVaultProfileOverride(pageOrigin(), profileId);
  await refreshVaultProfile();
  retrievalCache.clear();
  const items = await loadVaultItems(1, currentVaultProfileId);
  if (items) state.vaultItems = items;
  emitVaultProfileChanged();
  emitPanelUpdate();
}

// Returns the vault items, or null if the request failed (vs. a genuinely empty vault).
async function loadVaultItems(retries = 1, profileId?: string): Promise<VaultItem[] | null> {
  const targetProfileId = profileId ?? (await refreshVaultProfile(), currentVaultProfileId);
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!extensionAlive()) return null;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_vault_items', vaultProfileId: targetProfileId });
      if (response && (response as any).error) {
        console.warn('[Pageside] Vault read failed:', (response as any).error);
        return null;
      }
      if (response && Array.isArray((response as any).items)) {
        return (response as any).items as VaultItem[];
      }
    } catch (err) {
      if (isContextInvalidatedError(err)) {
        markContextInvalid();
        return null;
      }
      /* service worker may still be starting; retry below */
    }
    if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function loadProfiles(): Promise<SiteProfile[]> {
  try {
    const data = await chrome.storage.local.get(PROFILES_KEY);
    return (data[PROFILES_KEY] as SiteProfile[]) ?? [];
  } catch {
    return [];
  }
}

async function getSimilarAnswers(question: string, limit: number): Promise<HistoryAnswer[]> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_similar_answers', question, limit });
    return (response as any)?.items ?? [];
  } catch {
    return [];
  }
}

async function recordToHistory(field: DetectedField, answer: string, sourceIds: number[]): Promise<void> {
  if (!answer || answer.length < 3) return;
  try {
    await chrome.runtime.sendMessage({
      type: 'record_answer',
      question: questionOf(field),
      answer,
      sourceIds,
    });
  } catch { }
}

/* ------------------------- Scan ------------------------- */

async function scanPage(): Promise<void> {
  if (state.scanning) return;
  state.scanning = true;

  try {
    clearHighlights();
    closeAnswerCard();
    cancelActiveRequest();
    retrievalCache.clear();

    const fieldElements = new Map<string, HTMLElement>();
    const fields = scanElement(document.documentElement, 0, 20, fieldElements);

    const vaultItems = (await loadVaultItems()) ?? [];

    fields.forEach(f => {
      const el = fieldElements.get(f.id) ?? findElementBySelector(f.selector);
      if (el) {
        fieldElements.set(f.id, el);
        highlightField(el);
        el.addEventListener('click', onFieldClick);
      }
    });

    state.fields = fields;
    state.fieldElements = fieldElements;
    state.vaultItems = vaultItems;

    panelStates.clear();
    fieldSources.clear();
    fieldContexts.clear();
    previousDrafts.clear();
    for (const field of fields) {
      panelStates.set(field.id, newPanelInfo(field));
    }

    for (const field of fields) {
      const category = classifyField(field);
      if (category === 'factual') {
        const value = findValueForField(field, vaultItems);
        if (value && fieldElements.has(field.id)) {
          const el = fieldElements.get(field.id);
          if (el) {
            const result = fillField(el as HTMLElement, value);
            if (!result || !result.success) continue;
            setPanelStatus(field.id, 'inserted', value, 'vault');
            void recordToHistory(field, value, []);
          }
        }
      }
    }

    updateAnswerCard(`Scanned ${fields.length} fields`, [], 'Skipped');
    emitPanelUpdate();
  } finally {
    state.scanning = false;
  }
}

function findElementBySelector(selector: string): HTMLElement | null {
  try {
    const el = document.documentElement?.querySelector(selector);
    if (el instanceof HTMLElement) return el;
    if (selector.startsWith('#')) {
      const byId = document.getElementById(selector.substring(1));
      if (byId instanceof HTMLElement) return byId;
    }
    return null;
  } catch {
    return null;
  }
}

function questionOf(field: DetectedField): string {
  for (const candidate of [field.label, field.placeholder]) {
    const text = candidate?.trim();
    if (text && !isLikelyFieldIdentifier(text)) return text;
  }
  return '';
}

/* ------------------------- Panel state & events ------------------------- */

function newPanelInfo(field: DetectedField): PanelFieldInfo {
  return {
    field,
    category: classifyField(field),
    status: 'none',
    source: null,
    draft: '',
    sources: [],
    sourceDetails: [],
    flags: [],
    approved: false,
    error: null,
    usage: null,
    recovered: false,
    stale: false,
    recoveryValueFingerprint: null,
  };
}

function getPanelInfo(): PanelFieldInfo[] {
  return state.fields.map(f => panelStates.get(f.id) ?? newPanelInfo(f));
}

const REVIEWABLE_STATUSES: FieldStatus[] = ['draft'];

function setPanelStatus(fieldId: string, status: FieldStatus, draft: string, source: AnswerProvenance | null = null): void {
  const info = panelStates.get(fieldId);
  if (!info) return;
  info.status = status;
  info.draft = draft;
  info.source = draft ? source : null;
  if (!draft) {
    info.sources = [];
    info.sourceDetails = [];
    info.flags = [];
  }
  info.error = null;
  if (status === 'drafting' || status === 'draft' || status === 'inserted') {
    info.recovered = false;
    info.stale = false;
    info.recoveryValueFingerprint = null;
  }
  if (status !== 'inserted') info.usage = null;
  if (status === 'inserted') {
    info.approved = true;
  } else if (status === 'drafting' || REVIEWABLE_STATUSES.includes(status) || status === 'none' || status === 'skipped' || status === 'cancelled' || status === 'error') {
    info.approved = false;
  }
}

function setPanelDraftMeta(
  fieldId: string,
  source: AnswerProvenance,
  sources: string[],
  flags: string[],
  sourceDetails: AnswerSource[] = []
): void {
  const info = panelStates.get(fieldId);
  if (!info) return;
  info.source = source;
  info.sources = sources;
  info.sourceDetails = sourceDetails;
  info.flags = flags;
}

function setPanelDraft(fieldId: string, draft: string): void {
  const info = panelStates.get(fieldId);
  if (!info || !REVIEWABLE_STATUSES.includes(info.status)) return;
  info.draft = draft;
  info.approved = false;
  emitPanelUpdate();
}

function setPanelError(fieldId: string, error: FieldError, usage: GenerationUsage | null = null): void {
  const info = panelStates.get(fieldId);
  if (!info) return;
  info.status = 'error';
  info.draft = '';
  info.source = null;
  info.sources = [];
  info.sourceDetails = [];
  info.flags = [];
  info.approved = false;
  info.error = error;
  info.usage = usage;
}

function setPanelUsage(fieldId: string, usage: GenerationUsage): void {
  const info = panelStates.get(fieldId);
  if (!info) return;
  info.usage = usage;
}

function setPanelApproved(fieldId: string, approved: boolean): void {
  const info = panelStates.get(fieldId);
  if (!info || info.stale || !REVIEWABLE_STATUSES.includes(info.status)) return;
  info.approved = approved;
  if (getActiveCardFieldId() === fieldId) setCardApproved(approved);
  emitPanelUpdate();
}

function restorePanelDraft(
  fieldId: string,
  draft: string,
  source: AnswerProvenance | null,
  sources: string[],
  flags: string[],
  usage: GenerationUsage | null,
  stale: boolean,
  valueFingerprint: string,
  sourceDetails: AnswerSource[]
): void {
  const info = panelStates.get(fieldId);
  if (!info || info.draft || info.status !== 'none' || !draft.trim()) return;
  info.status = 'draft';
  info.draft = draft;
  info.source = source;
  info.sources = sources;
  info.sourceDetails = sourceDetails;
  info.flags = flags;
  info.usage = usage;
  info.approved = false;
  info.recovered = true;
  info.stale = stale;
  info.recoveryValueFingerprint = valueFingerprint;
  info.error = null;
  emitPanelUpdate();
}

function reviewRecoveredField(fieldId: string): void {
  const info = panelStates.get(fieldId);
  if (!info?.recovered || !info.stale) return;
  const el = state.fieldElements.get(fieldId);
  if (el) {
    info.field.currentValue = currentFieldValue(el);
    info.recoveryValueFingerprint = fingerprintFieldValue(info.field.currentValue);
  }
  info.stale = false;
  info.approved = false;
  emitPanelUpdate();
}

function currentFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return el.textContent?.trim() ?? '';
}

function skipPanelField(fieldId: string): void {
  const info = panelStates.get(fieldId);
  if (!info) return;
  info.status = 'skipped';
  info.draft = '';
  info.source = null;
  info.sources = [];
  info.sourceDetails = [];
  info.flags = [];
  info.approved = false;
  info.error = null;
  info.usage = null;
  previousDrafts.delete(fieldId);
  fieldContexts.delete(fieldId);
  if (lastDraft?.fieldId === fieldId) lastDraft = null;
  if (getActiveCardFieldId() === fieldId) closeAnswerCard();
  emitPanelUpdate();
}

function snapshotDraft(fieldId: string): void {
  const info = panelStates.get(fieldId);
  if (info && info.draft && REVIEWABLE_STATUSES.includes(info.status)) {
    previousDrafts.set(fieldId, {
      status: info.status,
      draft: info.draft,
      source: info.source,
      sources: [...info.sources],
      sourceDetails: [...info.sourceDetails],
      flags: [...info.flags],
      usage: info.usage,
    });
  } else {
    previousDrafts.delete(fieldId);
  }
}

function restorePreviousDraft(fieldId: string): DraftSnapshot | null {
  const snapshot = previousDrafts.get(fieldId);
  previousDrafts.delete(fieldId);
  if (!snapshot) return null;
  const info = panelStates.get(fieldId);
  if (info) {
    info.status = snapshot.status;
    info.draft = snapshot.draft;
    info.source = snapshot.source;
    info.sources = snapshot.sources;
    info.sourceDetails = snapshot.sourceDetails;
    info.flags = snapshot.flags;
    info.usage = snapshot.usage;
    info.approved = false;
    info.error = null;
  }
  if (lastDraft?.fieldId === fieldId) lastDraft = { fieldId, text: snapshot.draft };
  return snapshot;
}

function emitPanelUpdate(): void {
  safeSend({ type: 'questions_updated', questions: getPanelInfo() });
}

function emitAnswerProgress(fieldId: string, text: string): void {
  safeSend({ type: 'answer_progress', fieldId, text });
}

function emitAnswerReady(
  fieldId: string,
  answer: string,
  sources: string[],
  sourceDetails: AnswerSource[],
  flags: string[],
  source: AnswerProvenance,
  usage?: GenerationUsage
): void {
  safeSend({ type: 'answer_ready', fieldId, answer, sources, sourceDetails, flags, source, usage });
}

function emitAnswerError(fieldId: string, error: FieldError, usage?: GenerationUsage): void {
  safeSend({ type: 'answer_error', fieldId, error, usage });
}

function emitAnswerInserted(fieldId: string): void {
  safeSend({ type: 'answer_inserted', fieldId });
}

/* ------------------------- Factual fill ------------------------- */

function handleFactual(field: DetectedField, el: HTMLElement): void {
  const value = findValueForField(field, state.vaultItems);
  if (!value) return;
  const result = fillField(el, value);
  if (!result || !result.success) return;
  fieldSources.set(field.id, []);
  setPanelStatus(field.id, 'inserted', value, 'vault');
  emitAnswerInserted(field.id);
  emitPanelUpdate();
  void recordToHistory(field, value, []);
}

/* ------------------------- Streaming ------------------------- */

function getStreamPort(): chrome.runtime.Port | null {
  if (streamPort) return streamPort;
  if (!extensionAlive()) return null;
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect(undefined, { name: 'sr_stream' });
  } catch (err) {
    handleError(err);
    return null;
  }
  streamPort = port;
  port.onMessage.addListener(onStreamEvent);
  port.onDisconnect.addListener(() => {
    streamPort = null;
    const lastError = chrome.runtime.lastError;
    if (lastError && isContextInvalidatedError(lastError.message ?? '')) {
      markContextInvalid();
    }
  });
  return port;
}

function cancelActiveRequest(): void {
  if (activeRequestId && streamPort) {
    try {
      streamPort.postMessage({ channel: 'sr_stream', type: 'stop', requestId: activeRequestId } satisfies StreamRequest);
    } catch { }
  }
  const resolve = activeRequestId ? pendingResolvers.get(activeRequestId) : undefined;
  if (resolve) {
    pendingResolvers.delete(activeRequestId!);
    resolve();
  }
  activeRequestId = null;
  pendingFieldId = null;
  pendingFullText = '';
}

function stopActiveGeneration(): void {
  const fieldId = pendingFieldId;
  const target = streamTarget;
  cancelActiveRequest();
  if (fieldId) {
    const restored = restorePreviousDraft(fieldId);
    const info = panelStates.get(fieldId);
    if (!restored) setPanelStatus(fieldId, 'cancelled', '');
    if (target.kind === 'card' && getActiveCardFieldId() === fieldId) {
      if (restored && info) {
        updateAnswerCard(info.draft, info.sources, 'Draft', info.flags, false, info.usage ?? undefined, info.source, info.sourceDetails);
        setCardApproved(info.approved);
      } else {
        updateAnswerCard('', [], 'Cancelled', [], false);
      }
    }
    emitPanelUpdate();
  } else if (target.kind === 'card') {
    updateAnswerCard('', [], 'Cancelled', [], false);
  }
  if (target.kind === 'doc') {
    target.handle.update('Cancelled.', false);
  }
}

function onStreamEvent(event: StreamEvent): void {
  if (!activeRequestId || event.requestId !== activeRequestId) return;

  const target = streamTarget;

  if (event.type === 'chunk') {
    pendingFullText += event.text;
    if (target.kind === 'doc') {
      target.handle.update(pendingFullText, true);
    } else if (target.kind === 'card') {
      updateAnswerCard(pendingFullText, [], 'Drafting', [], true);
    }
    if (pendingFieldId) {
      setPanelStatus(pendingFieldId, 'drafting', pendingFullText);
      emitAnswerProgress(pendingFieldId, pendingFullText);
    }
  } else if (event.type === 'done') {
    lastMeta = { sources: event.sources, flags: event.untraceableClaims };
    const sourceTitles = event.sources.map(s => s.title);
    const rawAnswer = event.answer.trim();
    let cleanAnswer = sanitizeAnswerStyle(stripNeedsInputMarkers(rawAnswer));
    // Never let cleanup turn a non-empty model response into a blank draft.
    if (!cleanAnswer && rawAnswer) cleanAnswer = rawAnswer;

    if (target.kind === 'doc') {
      target.handle.update(cleanAnswer, false);
      const notes: string[] = [];
      if (sourceTitles.length) notes.push(`Sources: ${sourceTitles.join(', ')}`);
      if (event.untraceableClaims.length) notes.push(`Needs input: ${event.untraceableClaims.join('; ')}`);
      if (event.usage) {
        notes.push(`Tokens: ${event.usage.estimated ? '~' : ''}${formatTokens(event.usage.inputTokens)} in · ${formatTokens(event.usage.outputTokens)} out`);
        if (event.usage.costUsd !== undefined) notes.push(`Est. ${formatCost(event.usage.costUsd)}`);
      }
      target.handle.setNote(notes.join(' · '));
    } else {
      if (historyNote) sourceTitles.push(historyNote);
      if (target.kind === 'card') {
        updateAnswerCard(cleanAnswer, sourceTitles, 'Draft', event.untraceableClaims, false, event.usage, 'llm', event.sources);
        setCardApproved(false);
      }
      const doneFieldId = pendingFieldId;
      if (doneFieldId) {
        previousDrafts.delete(doneFieldId);
        fieldSources.set(doneFieldId, event.sources.map(s => s.id));
        setPanelStatus(doneFieldId, 'draft', cleanAnswer, 'llm');
        setPanelDraftMeta(doneFieldId, 'llm', sourceTitles, event.untraceableClaims, event.sources);
        if (event.usage) setPanelUsage(doneFieldId, event.usage);
        lastDraft = { fieldId: doneFieldId, text: cleanAnswer };
        emitAnswerReady(doneFieldId, cleanAnswer, sourceTitles, event.sources, event.untraceableClaims, 'llm', event.usage);
        emitPanelUpdate();
      }
    }
    settleRequest(event.requestId);
  } else if (event.type === 'error') {
    const error = fieldErrorFromStream(event.code, event.error);
    if (target.kind === 'doc') {
      target.handle.update(`Error: ${error.message}`, false);
    } else {
      const errFieldId = pendingFieldId;
      const restored = errFieldId ? restorePreviousDraft(errFieldId) : null;
      if (errFieldId) {
        if (restored) {
          const info = panelStates.get(errFieldId);
          if (info) {
            info.error = error;
            if (event.usage) info.usage = event.usage;
          }
          if (target.kind === 'card' && getActiveCardFieldId() === errFieldId) {
            updateAnswerCard(restored.draft, restored.sources, 'Draft', restored.flags, false, event.usage, restored.source, restored.sourceDetails);
            setCardApproved(false);
          }
        } else {
          setPanelError(errFieldId, error, event.usage ?? null);
          if (target.kind === 'card') {
            updateAnswerCard(`Error: ${error.message}`, [], 'Error', [], false, event.usage);
          }
        }
        emitAnswerError(errFieldId, error, event.usage);
        emitPanelUpdate();
      } else if (target.kind === 'card') {
        updateAnswerCard(`Error: ${error.message}`, [], 'Error', [], false, event.usage);
      }
    }
    settleRequest(event.requestId);
  }
}

function settleRequest(requestId: string): void {
  const resolve = pendingResolvers.get(requestId);
  if (resolve) {
    pendingResolvers.delete(requestId);
    resolve();
  }
  if (activeRequestId === requestId) activeRequestId = null;
}

const REQUEST_TIMEOUT_MS = 60000;

async function generate(
  question: string,
  prompt: string,
  systemPrompt: string,
  sources: AnswerSource[],
  fieldId: string | null,
  target: StreamTarget = { kind: 'card' },
  maxOutputTokens: number = 900
): Promise<void> {
  const previousFieldId = pendingFieldId;
  cancelActiveRequest();
  if (previousFieldId && previousFieldId !== fieldId) {
    if (!restorePreviousDraft(previousFieldId)) {
      setPanelStatus(previousFieldId, 'cancelled', '');
    }
    emitPanelUpdate();
  }
  if (fieldId) snapshotDraft(fieldId);

  streamTarget = target;
  activeRequestId = crypto.randomUUID();
  pendingFullText = '';
  pendingFieldId = fieldId;
  if (fieldId) {
    setPanelStatus(fieldId, 'drafting', '');
    emitPanelUpdate();
  }
  if (target.kind === 'doc') {
    target.handle.update('Generating…', true);
  } else if (target.kind === 'card') {
    updateAnswerCard('Generating…', [], 'Drafting', [], true);
    setCardApproved(false);
  }

  const failLocally = (error: FieldError): void => {
    const restoreFieldId = fieldId;
    const restored = restoreFieldId ? restorePreviousDraft(restoreFieldId) : null;
    if (restoreFieldId) {
      if (!restored) setPanelError(restoreFieldId, error);
      else {
        const info = panelStates.get(restoreFieldId);
        if (info) info.error = error;
      }
      emitAnswerError(restoreFieldId, error);
      emitPanelUpdate();
    }
    if (target.kind === 'doc') {
      target.handle.update(`Error: ${error.message}`, false);
    } else if (target.kind === 'card' && restoreFieldId && getActiveCardFieldId() === restoreFieldId) {
      if (restored) {
        updateAnswerCard(restored.draft, restored.sources, 'Draft', restored.flags, false, restored.usage ?? undefined, restored.source, restored.sourceDetails);
      } else {
        updateAnswerCard(`Error: ${error.message}`, [], 'Error', [], false);
      }
    }
  };

  const requestId = activeRequestId!;
  // Register the completion resolver before posting so a very fast done/error
  // event cannot arrive before we are waiting for it.
  const completion = new Promise<void>(resolve => {
    pendingResolvers.set(requestId, resolve);
  });

  const port = getStreamPort();
  if (!port) {
    settleRequest(requestId);
    failLocally(makeFieldError('no_connection', 'The extension connection was lost. Refresh the page and try again.'));
    return;
  }
  try {
    port.postMessage({
      channel: 'sr_stream',
      type: 'start',
      requestId,
      prompt,
      systemPrompt,
      sources,
      maxOutputTokens,
    } satisfies StreamRequest);
  } catch (err) {
    handleError(err);
    settleRequest(requestId);
    failLocally(makeFieldError('no_connection', 'The connection to the extension was lost. Refresh the page and try again.'));
    return;
  }

  const timeout = setTimeout(() => {
    if (activeRequestId === requestId) {
      cancelActiveRequest();
      failLocally(makeFieldError('timeout', 'The request timed out after 60 seconds. Try again or use a faster model.'));
    }
  }, REQUEST_TIMEOUT_MS);

  await completion;

  clearTimeout(timeout);
}

/* ------------------------- Prompt construction ------------------------- */

async function buildGenerationContext(question: string, fieldId: string | null) {
  const defaults = await safeStorageGet<{
    tone: string;
    maxLength: number;
    language: string;
    retrievalMode: RetrievalMode;
    vaultContextBudget: number;
    historyContextLimit: number;
  }>({
    tone: 'professional',
    maxLength: 500,
    language: 'en',
    retrievalMode: 'keyword',
    vaultContextBudget: 6000,
    historyContextLimit: 3,
  });
  const context = extractPageContext(document);
  const profiles = await loadProfiles();
  const profile = findMatchingProfile(profiles, context);

  const tone = profile?.tone ?? defaults.tone;
  const maxLength = profile?.maxLength ?? defaults.maxLength;
  const language = profile?.language ?? defaults.language;
  const emphasis = profile?.emphasis ?? '';

  const items = await loadVaultItems();
  let vaultLoadFailed = false;
  if (items === null) {
    vaultLoadFailed = state.vaultItems.length === 0;
  } else {
    state.vaultItems = items;
  }

  const query = [question, context.jobTitle].filter(Boolean).join(' ');
  const budget = clampContextBudget(defaults.vaultContextBudget);
  const historyLimit = clampHistoryLimit(defaults.historyContextLimit);
  const vaultSignature = state.vaultItems.map(item => `${item.id}:${item.updatedAt}`).join(',');
  const cacheKey = [
    location.href,
    question,
    context.jobTitle ?? '',
    budget,
    defaults.retrievalMode,
    currentVaultProfileId,
    vaultSignature,
  ].join('|');

  let retrieval = retrievalCache.get(cacheKey);
  if (!retrieval) {
    retrieval = selectRelevantVaultItems(query, state.vaultItems, budget, defaults.retrievalMode);
    if (retrievalCache.size > 50) retrievalCache.clear();
    retrievalCache.set(cacheKey, retrieval);
  }
  const { context: vaultContext, usedItems } = retrieval;

  const similar = await getSimilarAnswers(question, historyLimit);
  const strongMatch = similar.find(s => similarityScore(question, s.question) >= 4);

  const historyParts: string[] = [];
  let historyTokens = 0;
  for (const item of similar) {
    const part = `Q: ${item.question}\nA: ${item.answer}`;
    const partTokens = estimateTokens(part);
    const remaining = 1200 - historyTokens;
    if (remaining <= 0) break;
    if (partTokens > remaining) {
      if (historyParts.length === 0) {
        historyParts.push(part.substring(0, Math.floor(remaining * 3.5)));
      }
      break;
    }
    historyParts.push(part);
    historyTokens += partTokens;
  }
  const historyContext = historyParts.join('\n\n');

  const systemPrompt = buildSystemPrompt(tone, maxLength, language, emphasis);
  const basePrompt = buildUserPrompt(question, context, vaultContext, undefined, historyContext || undefined);
  const sources = usedItems.map(v => ({
    id: v.id!,
    title: v.title,
    type: v.type,
    excerpt: extractSourceExcerpt(question, v.content),
  }));

  return {
    context,
    profile,
    systemPrompt,
    basePrompt,
    sources,
    strongMatch,
    historyContext,
    hasVault: state.vaultItems.length > 0,
    vaultLoadFailed,
    maxOutputTokens: outputBudgetFor(maxLength),
  };
}

/* ------------------------- Answer generation ------------------------- */

async function answerField(field: DetectedField, opts: { silent?: boolean; force?: boolean } = {}): Promise<void> {
  const el = state.fieldElements.get(field.id);
  if (!el) return;

  const previousFieldId = pendingFieldId;
  cancelActiveRequest();
  if (previousFieldId && previousFieldId !== field.id) {
    if (!restorePreviousDraft(previousFieldId)) {
      setPanelStatus(previousFieldId, 'cancelled', '');
    }
    emitPanelUpdate();
  }
  currentContext = null;
  historyNote = '';
  if (opts.silent) closeAnswerCard();

  const category = classifyField(field);
  if (category === 'factual') {
    handleFactual(field, el);
    return;
  }

  const question = questionOf(field);
  const existing = panelStates.get(field.id);
  if (!opts.force && existing?.draft && REVIEWABLE_STATUSES.includes(existing.status)) {
    if (opts.silent) return;
    const gen = await buildGenerationContext(question, field.id);
    const ctx: CardContext = {
      field,
      question,
      systemPrompt: gen.systemPrompt,
      basePrompt: gen.basePrompt,
      sources: gen.sources,
      maxOutputTokens: gen.maxOutputTokens,
    };
    currentContext = ctx;
    fieldContexts.set(field.id, ctx);
    lastMeta = { sources: gen.sources, flags: existing.flags };
    showAnswerCard(field, el, makeCallbacks(field, el, question, gen.sources));
    updateAnswerCard(existing.draft, existing.sources, 'Draft', existing.flags, false, existing.usage ?? undefined, existing.source, existing.sourceDetails);
    setCardApproved(existing.approved);
    return;
  }

  if (!question) {
    const error = makeFieldError(
      'unknown',
      "Could not read this field's question. Use Read Selection on the question text, or add the question to your vault and rescan."
    );
    setPanelError(field.id, error);
    emitAnswerError(field.id, error);
    emitPanelUpdate();
    if (!opts.silent) {
      showAnswerCard(field, el, makeCallbacks(field, el, question, []));
      updateAnswerCard(`Error: ${error.message}`, [], 'Error');
    }
    return;
  }

  const gen = await buildGenerationContext(question, field.id);
  const ctx: CardContext = {
    field,
    question,
    systemPrompt: gen.systemPrompt,
    basePrompt: gen.basePrompt,
    sources: gen.sources,
    maxOutputTokens: gen.maxOutputTokens,
  };
  currentContext = ctx;
  fieldContexts.set(field.id, ctx);

  if (gen.strongMatch) {
    fieldSources.set(field.id, gen.strongMatch.sourceIds);
    const labels = ['Shared past answer reused'];
    setPanelStatus(field.id, 'draft', gen.strongMatch.answer, 'history');
    setPanelDraftMeta(field.id, 'history', labels, []);
    lastDraft = { fieldId: field.id, text: gen.strongMatch.answer };
    emitAnswerReady(field.id, gen.strongMatch.answer, labels, [], [], 'history');
    emitPanelUpdate();
    if (!opts.silent) {
      showAnswerCard(field, el, makeCallbacks(field, el, question, gen.sources));
      updateAnswerCard(gen.strongMatch.answer, labels, 'Draft', [], false, undefined, 'history');
      setCardApproved(false);
    }
    return;
  }

  if (!gen.hasVault) {
    const error = gen.vaultLoadFailed
      ? makeFieldError('vault_load_failed', 'Could not load your vault. Reload the page and try again.')
      : makeFieldError('no_vault', 'No vault items found. Add your resume, notes, or portfolio in Vault, then try again.');
    setPanelError(field.id, error);
    emitAnswerError(field.id, error);
    emitPanelUpdate();
    if (!opts.silent) {
      showAnswerCard(field, el, makeCallbacks(field, el, question, []));
      updateAnswerCard(`Error: ${error.message}`, [], 'Error');
    }
    return;
  }

  const direct = findDirectVaultAnswer(question, state.vaultItems);
  if (direct) {
    const sources: AnswerSource[] = direct.id !== undefined ? [{
      id: direct.id,
      title: direct.title,
      type: direct.type,
      excerpt: extractSourceExcerpt(question, direct.content),
    }] : [];
    const labels = sources.map(s => s.title);
    fieldSources.set(field.id, sources.map(s => s.id));
    setPanelStatus(field.id, 'draft', direct.content, 'vault');
    setPanelDraftMeta(field.id, 'vault', labels, [], sources);
    lastDraft = { fieldId: field.id, text: direct.content };
    emitAnswerReady(field.id, direct.content, labels, sources, [], 'vault');
    emitPanelUpdate();
    if (!opts.silent) {
      lastMeta = { sources, flags: [] };
      showAnswerCard(field, el, makeCallbacks(field, el, question, sources));
      updateAnswerCard(direct.content, labels, 'Draft', [], false, undefined, 'vault', sources);
      setCardApproved(false);
    }
    return;
  }

  if (gen.historyContext) historyNote = 'Similar past answer used as context';

  if (!opts.silent) {
    showAnswerCard(field, el, makeCallbacks(field, el, question, gen.sources));
  }
  const target: StreamTarget = opts.silent ? { kind: 'none' } : { kind: 'card' };
  await generate(question, gen.basePrompt, gen.systemPrompt, gen.sources, field.id, target, gen.maxOutputTokens);
}

function cardAnswerText(): string {
  return getCardAnswerText();
}

function runRevision(instruction: string): void {
  const ctx = currentContext;
  if (!ctx) return;
  if (activeRequestId && pendingFieldId === ctx.field.id) return;
  const prev = cardAnswerText();
  if (!prev || prev === 'Generating…' || prev === 'Revising…') return;
  const prompt = `${ctx.basePrompt}\n\nPrevious answer:\n${prev}\n\nNow modify the answer: ${instruction}`;
  updateAnswerCard('Revising…', [], 'Drafting', [], true);
  run(generate(ctx.question, prompt, ctx.systemPrompt, lastMeta.sources, ctx.field.id, { kind: 'card' }, ctx.maxOutputTokens));
}

async function revisePanelField(fieldId: string, instruction: string): Promise<void> {
  const field = state.fields.find(f => f.id === fieldId);
  const info = panelStates.get(fieldId);
  if (!field || !info || !info.draft || !REVIEWABLE_STATUSES.includes(info.status)) return;
  if (activeRequestId && pendingFieldId === fieldId) return;

  const existingCtx = fieldContexts.get(fieldId);
  const base = existingCtx ?? (await (async () => {
    const gen = await buildGenerationContext(questionOf(field), fieldId);
    const next: CardContext = {
      field,
      question: questionOf(field),
      systemPrompt: gen.systemPrompt,
      basePrompt: gen.basePrompt,
      sources: gen.sources,
      maxOutputTokens: gen.maxOutputTokens,
    };
    fieldContexts.set(fieldId, next);
    return next;
  })());

  const prompt = `${base.basePrompt}\n\nPrevious answer:\n${info.draft}\n\nNow modify the answer: ${instruction}`;
  await generate(base.question, prompt, base.systemPrompt, lastMeta.sources, fieldId, { kind: 'none' }, base.maxOutputTokens);
}

function makeCallbacks(
  field: DetectedField,
  el: HTMLElement,
  question: string,
  sources: AnswerSource[]
) {
  return {
    onApprove: (approved: boolean) => {
      setPanelApproved(field.id, approved);
    },
    onInsert: () => {
      const raw = cardAnswerText();
      if (!raw || raw === 'Generating…' || raw === 'Revising…') return;
      const info = panelStates.get(field.id);
      if (!info?.approved) return;
      const clean = stripNeedsInputMarkers(raw);
      fillField(el, clean);
      updateAnswerCard(clean, info.sources, 'Inserted', info.flags, false, info.usage ?? undefined, info.source, info.sourceDetails);
      setPanelStatus(field.id, 'inserted', clean, info.source);
      emitAnswerInserted(field.id);
      emitPanelUpdate();
      void recordToHistory({ ...field, label: question }, clean, fieldSources.get(field.id) ?? []);
    },
    onUndo: () => {
      const result = undoFill(el);
      if (!result?.success) return;
      setPanelStatus(field.id, 'none', '');
      emitPanelUpdate();
      updateAnswerCard('', [], 'Skipped', [], false);
    },
    onCopy: async () => {
      const raw = cardAnswerText();
      if (!raw || raw === 'Generating…' || raw === 'Revising…') return;
      try {
        await navigator.clipboard.writeText(raw);
      } catch { }
    },
    onRegenerate: () => {
      if (!currentContext) return;
      if (activeRequestId && pendingFieldId === currentContext.field.id) return;
      lastMeta = { sources: [], flags: [] };
      run(generate(currentContext.question, currentContext.basePrompt, currentContext.systemPrompt, sources, field.id, { kind: 'card' }, currentContext.maxOutputTokens));
    },
    onShorter: () => runRevision('Make the answer SHORTER, about half the length.'),
    onLonger: () => runRevision('Make the answer LONGER and more detailed.'),
    onCasual: () => runRevision('Make the answer more casual and conversational.'),
    onFormal: () => runRevision('Make the answer more formal and professional.'),
    onStop: stopActiveGeneration,
    onClose: () => {
      stopActiveGeneration();
      const fieldEl = state.fieldElements.get(field.id);
      if (fieldEl) unhighlightField(fieldEl);
    },
  };
}

function onFieldClick(this: HTMLElement, _e: Event): void {
  const fieldId = state.fields.find(f => state.fieldElements.get(f.id) === this)?.id;
  if (!fieldId) return;

  const field = state.fields.find(f => f.id === fieldId);
  if (!field) return;

  if (getActiveCardFieldId() === fieldId) {
    closeAnswerCard();
    cancelActiveRequest();
    unhighlightField(this);
    return;
  }

  closeAnswerCard();
  state.fields.filter(f => f.id !== fieldId).forEach(f => {
    const el = state.fieldElements.get(f.id);
    if (el) unhighlightField(el);
  });
  highlightField(this);

  run(answerField(field));
}

/* ------------------------- Read selection ------------------------- */

async function readSelection(): Promise<void> {
  const selection = window.getSelection();
  const text = selection?.toString()?.trim();
  if (!text || text.length < 10) {
    updateAnswerCard('Select some text on the page first (at least 10 characters).', [], 'Error');
    return;
  }

  cancelActiveRequest();
  currentContext = null;
  historyNote = '';

  const field: DetectedField = {
    id: 'selection',
    type: 'textarea',
    label: 'Read Selection',
    sectionHeading: null,
    placeholder: null,
    currentValue: '',
    maxLength: null,
    required: false,
    selector: '',
    tagName: 'div',
    name: null,
    attributes: {},
  };

  if (state.vaultItems.length === 0) {
    const items = await loadVaultItems();
    if (items && items.length > 0) state.vaultItems = items;
  }

  const defaults = await safeStorageGet<{
    tone: string;
    maxLength: number;
    language: string;
    retrievalMode: RetrievalMode;
    vaultContextBudget: number;
    historyContextLimit: number;
  }>({
    tone: 'professional',
    maxLength: 500,
    language: 'en',
    retrievalMode: 'keyword',
    vaultContextBudget: 6000,
    historyContextLimit: 3,
  });
  const { context: vaultContext, usedItems } = selectRelevantVaultItems(
    text,
    state.vaultItems,
    clampContextBudget(defaults.vaultContextBudget),
    defaults.retrievalMode
  );
  const profiles = await loadProfiles();
  const profile = findMatchingProfile(profiles, extractPageContext(document));
  const systemPrompt = buildSystemPrompt(
    profile?.tone ?? defaults.tone,
    profile?.maxLength ?? defaults.maxLength,
    profile?.language ?? defaults.language,
    profile?.emphasis ?? ''
  );
  const basePrompt = `Selected text from the page:\n\n${text}\n\n${vaultContext ? `Relevant background:\n${vaultContext}\n\n` : ''}Please analyze or respond to the selected text above.`;
  const maxOutputTokens = outputBudgetFor(profile?.maxLength ?? defaults.maxLength);
  const sources = usedItems.map(v => ({
    id: v.id!,
    title: v.title,
    type: v.type,
    excerpt: extractSourceExcerpt('Read Selection', v.content),
  }));
  currentContext = { field, question: 'Read Selection', systemPrompt, basePrompt, sources, maxOutputTokens };

  showAnswerCard(field, document.body, {
    onApprove: () => { },
    onInsert: () => { },
    onUndo: () => { },
    onCopy: async () => {
      const raw = cardAnswerText();
      if (raw) {
        try { await navigator.clipboard.writeText(raw); } catch { }
      }
    },
    onRegenerate: () => {
      if (!currentContext) return;
      lastMeta = { sources: [], flags: [] };
      run(generate(currentContext.question, currentContext.basePrompt, currentContext.systemPrompt, sources, null, { kind: 'card' }, currentContext.maxOutputTokens));
    },
    onShorter: () => runRevision('Make the answer SHORTER, about half the length.'),
    onLonger: () => runRevision('Make the answer LONGER and more detailed.'),
    onCasual: () => runRevision('Make the answer more casual and conversational.'),
    onFormal: () => runRevision('Make the answer more formal and professional.'),
    onStop: stopActiveGeneration,
    onClose: stopActiveGeneration,
  });

  await generate('Read Selection', basePrompt, systemPrompt, sources, null, { kind: 'card' }, maxOutputTokens);
}

/* ------------------------- Documents (cover letter / video script) ------------------------- */

async function generateDocument(kind: DocumentKind): Promise<void> {
  cancelActiveRequest();
  currentContext = null;
  historyNote = '';
  activeDocKind = kind;

  const items = await loadVaultItems();
  if (items) state.vaultItems = items;

  const defaults = await safeStorageGet<{
    tone: string;
    language: string;
    retrievalMode: RetrievalMode;
    vaultContextBudget: number;
  }>({ tone: 'professional', language: 'en', retrievalMode: 'keyword', vaultContextBudget: 6000 });

  const pageContext = extractPageContext(document);
  const profiles = await loadProfiles();
  const profile = findMatchingProfile(profiles, pageContext);
  const tone = profile?.tone ?? defaults.tone;
  const language = profile?.language ?? defaults.language;

  const title = DOCUMENT_TITLES[kind];
  const companySuffix = pageContext.companyName ? ` — ${pageContext.companyName}` : '';
  const fullTitle = `${title}${companySuffix}`;

  const handle = showDocModal(
    fullTitle,
    text => { if (text.trim()) void navigator.clipboard.writeText(text).catch(() => { }); },
    text => downloadText(`${title.toLowerCase().replace(/\s+/g, '-')}.txt`, text),
    text => { if (activeDocHandle) void saveDocumentToVault(activeDocHandle, text); },
    () => { run(generateDocument(kind)); },
    () => {
      activeDocHandle = null;
      cancelActiveRequest();
    }
  );
  activeDocHandle = handle;

  if (state.vaultItems.length === 0) {
    handle.update('No vault items found. Add your resume, notes, or portfolio in Options → Vault, then try again.', false);
    return;
  }

  const query = [
    pageContext.jobTitle,
    pageContext.companyName,
    pageContext.jobDescription?.substring(0, 1500),
  ].filter(Boolean).join(' ') || pageContext.visibleText.substring(0, 2000);

  const { context: vaultContext, usedItems } = selectRelevantVaultItems(
    query,
    state.vaultItems,
    clampContextBudget(defaults.vaultContextBudget),
    defaults.retrievalMode
  );

  const prompt = kind === 'cover_letter'
    ? buildCoverLetterPrompt(pageContext, vaultContext, tone, language)
    : buildVideoScriptPrompt(pageContext, vaultContext, tone, language);

  const sources = usedItems.map(v => ({
    id: v.id!,
    title: v.title,
    type: v.type,
    excerpt: extractSourceExcerpt(query, v.content),
  }));

  await generate(title, prompt.user, prompt.system, sources, null, {
    kind: 'doc',
    handle,
    title: fullTitle,
  }, outputBudgetFor(0, true));
}

async function saveDocumentToVault(handle: DocModalHandle, text: string): Promise<void> {
  const content = text.trim();
  if (!content || content.startsWith('Error:')) return;
  const pageContext = extractPageContext(document);
  const suffix = pageContext.companyName ? ` — ${pageContext.companyName}` : '';
  const title = `${DOCUMENT_TITLES[activeDocKind]}${suffix}`;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'save_vault_item',
      itemType: 'note',
      title,
      content,
      vaultProfileId: currentVaultProfileId,
    });
    if (response?.type === 'vault_item_saved' && response.id) {
      handle.setNote(`Saved to vault: ${title}`);
    } else {
      handle.setNote('Could not save to vault. Reload the page and try again.');
    }
  } catch (err) {
    handleError(err);
    handle.setNote('Could not save to vault. Reload the page and try again.');
  }
}

function downloadText(filename: string, text: string): void {
  if (!text.trim()) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------- Commands & panel-driven actions ------------------------- */

async function answerFieldForPanel(fieldId: string, force = false): Promise<void> {
  const field = state.fields.find(f => f.id === fieldId);
  if (!field) return;
  await answerField(field, { silent: true, force });
}

async function openDraftTriage(): Promise<void> {
  if (state.fields.length === 0) await scanPage();
  if (state.vaultItems.length === 0) {
    const items = await loadVaultItems();
    if (items) state.vaultItems = items;
  }

  const openEnded = state.fields.filter(field => {
    if (classifyField(field) !== 'open_ended') return false;
    const info = panelStates.get(field.id);
    return !info?.draft || !REVIEWABLE_STATUSES.includes(info.status);
  });

  if (openEnded.length === 0) {
    updateAnswerCard('No open-ended questions need a draft. Check the side panel for existing drafts.', [], 'Skipped');
    return;
  }

  const items = [];
  for (const field of openEnded) {
    const label = questionOf(field);
    if (!label) continue;
    const gen = await buildGenerationContext(label, field.id);
    items.push({
      id: field.id,
      label,
      estimateTokens: estimateTokens(gen.systemPrompt) + estimateTokens(gen.basePrompt),
    });
  }

  if (items.length === 0) {
    updateAnswerCard('Could not read any open-ended questions on this page. Try Read Selection on the question text.', [], 'Skipped');
    return;
  }

  showTriageModal(items, ids => {
    void (async () => {
      const selected = openEnded.filter(field => ids.includes(field.id));
      for (const field of selected) {
        await answerField(field, { silent: true });
      }
      const first = selected[0];
      if (first && panelStates.get(first.id)?.draft) await answerField(first);
    })();
  });
}

function setFieldFocus(fieldId: string): void {
  const el = state.fieldElements.get(fieldId);
  if (!el) return;
  state.fields.filter(f => f.id !== fieldId).forEach(f => {
    const fe = state.fieldElements.get(f.id);
    if (fe) unhighlightField(fe);
  });
  highlightField(el);
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

async function answerFocusedField(): Promise<void> {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const fieldId = state.fields.find(f => state.fieldElements.get(f.id) === active)?.id;
  if (!fieldId) {
    updateAnswerCard('No detected field is currently focused. Scan the page first.', [], 'Skipped');
    return;
  }
  setFieldFocus(fieldId);
  const field = state.fields.find(f => f.id === fieldId);
  if (field) await answerField(field);
}

async function insertLastDraft(): Promise<void> {
  if (!lastDraft) return;
  const { fieldId, text } = lastDraft;
  const el = state.fieldElements.get(fieldId);
  if (!el || !text) return;

  const info = panelStates.get(fieldId);
  if (info && (info.stale || info.status === 'inserted' || info.status === 'drafting' || info.status === 'error' || info.status === 'skipped')) return;
  if (info?.recovered && info.recoveryValueFingerprint !== null &&
      fingerprintFieldValue(currentFieldValue(el)) !== info.recoveryValueFingerprint) {
    info.stale = true;
    info.approved = false;
    emitPanelUpdate();
    return;
  }

  const clean = stripNeedsInputMarkers(text);
  fillField(el, clean);
  setPanelStatus(fieldId, 'inserted', clean, info?.source ?? null);
  emitAnswerInserted(fieldId);
  emitPanelUpdate();
  const field = state.fields.find(f => f.id === fieldId);
  if (field) void recordToHistory(field, clean, fieldSources.get(fieldId) ?? []);
}

function insertPanelField(fieldId: string): boolean {
  const info = panelStates.get(fieldId);
  if (!info || info.stale || !REVIEWABLE_STATUSES.includes(info.status)) return false;
  const el = state.fieldElements.get(fieldId);
  if (!el || !info.draft) return false;
  if (info.recovered && info.recoveryValueFingerprint !== null &&
      fingerprintFieldValue(currentFieldValue(el)) !== info.recoveryValueFingerprint) {
    info.stale = true;
    info.approved = false;
    emitPanelUpdate();
    return false;
  }

  const clean = stripNeedsInputMarkers(info.draft);
  const result = fillField(el, clean);
  if (!result?.success) return false;

  setPanelStatus(fieldId, 'inserted', clean, info.source);
  emitAnswerInserted(fieldId);
  const field = state.fields.find(f => f.id === fieldId);
  if (field) void recordToHistory(field, clean, fieldSources.get(fieldId) ?? []);
  return true;
}

async function bulkInsert(fieldIds: string[]): Promise<string[]> {
  const inserted: string[] = [];
  for (const fieldId of fieldIds) {
    const info = panelStates.get(fieldId);
    if (!info?.approved || info.stale || !REVIEWABLE_STATUSES.includes(info.status)) continue;
    if (insertPanelField(fieldId)) inserted.push(fieldId);
  }
  emitPanelUpdate();
  return inserted;
}

function insertSingleField(fieldId: string): void {
  if (!insertPanelField(fieldId)) return;
  emitPanelUpdate();
}

function undoField(fieldId: string): boolean {
  const el = state.fieldElements.get(fieldId);
  if (!el) return false;
  const result = undoFill(el);
  if (!result?.success) return false;
  setPanelStatus(fieldId, 'none', '');
  return true;
}

function undoBulk(fieldIds: string[]): string[] {
  const reverted: string[] = [];
  for (const fieldId of fieldIds) {
    if (undoField(fieldId)) reverted.push(fieldId);
  }
  emitPanelUpdate();
  return reverted;
}

function teardown(): void {
  cancelActiveRequest();
  clearHighlights();
  closeAnswerCard();
  destroyToolbar();
  state.fields = [];
  state.fieldElements.clear();
  panelStates.clear();
  fieldSources.clear();
  fieldContexts.clear();
  previousDrafts.clear();
  retrievalCache.clear();
  lastDraft = null;
  uiWired = false;
}

/* ------------------------- Message handling ------------------------- */

chrome.runtime.onMessage.addListener((
  msg: ContentRequest,
  _sender,
  sendResponse: (response: unknown) => void
) => {
  switch (msg.type) {
    case 'scan_page':
      run(scanPage().then(() => sendResponse({ ok: true })));
      return true;
    case 'get_panel_state':
      run(refreshVaultProfile().then(() => {
        sendResponse({
          type: 'panel_state',
          questions: getPanelInfo(),
          context: extractPageContext(document),
          vaultProfileId: currentVaultProfileId,
          vaultProfiles: vaultProfilesCache,
          vaultProfileOverride: currentVaultProfileOverride,
          matchedProfileName: currentMatchedProfileName,
        } satisfies ContentResponse);
      }));
      return true;
    case 'set_vault_profile':
      run(setVaultProfile(msg.profileId));
      return false;
    case 'answer_field':
      run(answerFieldForPanel(msg.fieldId));
      return false;
    case 'regenerate_answer':
      run(answerFieldForPanel(msg.fieldId, true));
      return false;
    case 'revise_field':
      run(revisePanelField(msg.fieldId, msg.instruction));
      return false;
    case 'update_field_draft':
      setPanelDraft(msg.fieldId, msg.draft);
      if (getActiveCardFieldId() === msg.fieldId) setCardAnswerText(msg.draft);
      return false;
    case 'restore_field_draft':
      restorePanelDraft(
        msg.fieldId,
        msg.draft,
        msg.source,
        msg.sources,
        msg.flags,
        msg.usage,
        msg.stale,
        msg.valueFingerprint,
        msg.sourceDetails
      );
      return false;
    case 'review_recovered_field':
      reviewRecoveredField(msg.fieldId);
      return false;
    case 'stop_generation':
      stopActiveGeneration();
      return false;
    case 'insert_field':
      insertSingleField(msg.fieldId);
      return false;
    case 'set_field_approved':
      setPanelApproved(msg.fieldId, msg.approved);
      return false;
    case 'skip_field':
      skipPanelField(msg.fieldId);
      return false;
    case 'answer_focused_field':
      run(answerFocusedField());
      return false;
    case 'insert_last_draft':
      run(insertLastDraft());
      return false;
    case 'bulk_insert':
      run(bulkInsert(msg.fieldIds).then(insertedFieldIds => {
        sendResponse({ type: 'bulk_insert_result', insertedFieldIds } satisfies ContentResponse);
      }));
      return true;
    case 'undo_bulk':
      run(Promise.resolve(undoBulk(msg.fieldIds)).then(revertedFieldIds => {
        sendResponse({ type: 'undo_bulk_result', revertedFieldIds } satisfies ContentResponse);
      }));
      return true;
    case 'set_field_focus':
      setFieldFocus(msg.fieldId);
      return false;
    case 'undo_field':
      undoField(msg.fieldId);
      emitPanelUpdate();
      return false;
    case 'fill_field': {
      const el = findElementBySelector(msg.fieldSelector);
      const result = el ? fillField(el, msg.value) : null;
      sendResponse({ type: 'fill_result', fieldSelector: msg.fieldSelector, success: Boolean(result?.success) } satisfies ContentResponse);
      return false;
    }
    case 'undo_fill': {
      const el = findElementBySelector(msg.fieldSelector);
      const result = el ? undoFill(el) : null;
      sendResponse({ type: 'fill_result', fieldSelector: msg.fieldSelector, success: Boolean(result?.success) } satisfies ContentResponse);
      return false;
    }
    case 'teardown':
      teardown();
      sendResponse({ ok: true });
      return false;
    case 'reinit':
      void init().then(() => sendResponse({ ok: true }));
      return true;
    case 'sr_ping':
      sendResponse({ ok: true });
      return false;
    case 'read_selection':
      run(readSelection());
      return false;
    case 'generate_document':
      run(generateDocument(msg.kind));
      return false;
    default:
      return false;
  }
});

/* ------------------------- Toolbar / init ------------------------- */

async function init(): Promise<void> {
  await refreshVaultProfile();
  initToolbar();
  updateVaultProfileSelector();

  getStreamPort();

  if (uiWired) return;
  uiWired = true;

  onVaultProfileChange(profileId => {
    run(setVaultProfile(profileId || null));
  });

  onToolbarButton('__sr-scan', async () => {
    try {
      hideToolbar();
      await scanPage();
    } catch (err) {
      handleError(err);
    }
  });

  onToolbarButton('__sr-answer-all', async () => {
    try {
      hideToolbar();
      await openDraftTriage();
    } catch (err) {
      handleError(err);
    }
  });

  onToolbarButton('__sr-read-selection', async () => {
    try {
      hideToolbar();
      await readSelection();
    } catch (err) {
      handleError(err);
    }
  });

  onToolbarButton('__sr-cover-letter', async () => {
    try {
      hideToolbar();
      await generateDocument('cover_letter');
    } catch (err) {
      handleError(err);
    }
  });

  onToolbarButton('__sr-video-script', async () => {
    try {
      hideToolbar();
      await generateDocument('video_script');
    } catch (err) {
      handleError(err);
    }
  });

  onToolbarButton('__sr-toggle-enable', async () => {
    try {
      hideToolbar();
      const origin = window.location.origin === 'null'
        ? `${window.location.protocol}//${window.location.host}/*`
        : window.location.origin;
      await chrome.runtime.sendMessage({ type: 'disable_site', origin });
      teardown();
    } catch (err) {
      handleError(err);
    }
  });
}

if (typeof document !== 'undefined') {
  init().catch(handleError);
}