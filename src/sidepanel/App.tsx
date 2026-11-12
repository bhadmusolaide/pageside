import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import type {
  PanelFieldInfo,
  FieldStatus,
  ContentRequest,
  SidePanelEvent,
  VaultProfileOption,
  OptionsTab,
  GenerationUsage,
  AnswerProvenance,
} from '../lib/messaging';
import { formatTokens, formatCost } from '../lib/usage';
import { isLikelyFieldIdentifier, type PageContext } from '../lib/fieldDetector';
import { ThemeToggle } from '../components/ThemeToggle';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';
import {
  clearPageRecoveries,
  fingerprintFieldValue,
  getPageRecovery,
  isRecoveredDraftStale,
  pageRecoveryStorageKey,
  RECOVERY_ENABLED_KEY,
  savePageDrafts,
  type RecoveredDraft,
} from '../lib/recovery';
import { Chat } from './Chat';

interface PanelItem extends PanelFieldInfo {
  frameId: number;
}

interface SetupHealth {
  loading: boolean;
  apiKey: boolean;
  vaultCount: number;
  vaultError: boolean;
}

let activeTabId: number | null = null;

async function updateActiveTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTabId = tabs[0]?.id ?? null;
  } catch {
    activeTabId = null;
  }
  return activeTabId;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

async function frameIdsFor(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const ids = (frames ?? [])
      .map(frame => frame.frameId)
      .filter((id): id is number => typeof id === 'number');
    return ids.length > 0 ? ids : [0];
  } catch {
    return [0];
  }
}

async function sendToFrame(frameId: number, msg: ContentRequest): Promise<unknown> {
  const id = await updateActiveTabId();
  if (id === null) return null;
  try {
    return await chrome.tabs.sendMessage(id, msg as any, { frameId });
  } catch {
    return null;
  }
}

async function openOptionsTab(tab: OptionsTab): Promise<void> {
  try {
    await chrome.storage.local.set({ 'sr-options-tab': tab });
    await chrome.runtime.openOptionsPage();
  } catch {
    return;
  }
}

function siteOriginPattern(tab: chrome.tabs.Tab): string | null {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'file:') return 'file:///*';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Chrome match patterns do not support ports; hostname keeps every port covered.
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

const STATUS_KEY: Record<FieldStatus, string> = {
  none: 'status.none',
  drafting: 'status.drafting',
  draft: 'status.draft',
  inserted: 'status.inserted',
  skipped: 'status.skipped',
  cancelled: 'status.cancelled',
  error: 'status.error',
};

const STATUS_CLASS: Record<FieldStatus, string> = {
  none: 'bg-gray-200 text-gray-600',
  drafting: 'bg-blue-100 text-blue-700',
  draft: 'bg-blue-100 text-blue-700',
  inserted: 'bg-green-100 text-green-800',
  skipped: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-800',
};

const SOURCE_KEY: Record<AnswerProvenance, string> = {
  vault: 'source.vault',
  history: 'source.history',
  llm: 'source.llm',
};

const SOURCE_CLASS: Record<AnswerProvenance, string> = {
  vault: 'bg-amber-100 text-amber-800',
  history: 'bg-amber-100 text-amber-800',
  llm: 'bg-indigo-100 text-indigo-800',
};

const REVIEWABLE: FieldStatus[] = ['draft'];

const REVISIONS: Array<{ labelKey: string; instruction: string }> = [
  { labelKey: 'action.shorter', instruction: 'Make the answer SHORTER, about half the length.' },
  { labelKey: 'action.longer', instruction: 'Make the answer LONGER and more detailed.' },
  { labelKey: 'action.casual', instruction: 'Make the answer more casual and conversational.' },
  { labelKey: 'action.formal', instruction: 'Make the answer more formal and professional.' },
];

function itemKey(frameId: number, fieldId: string): string {
  return `${frameId}:${fieldId}`;
}

function displayFieldLabel(field: PanelItem['field']): string {
  for (const candidate of [field.label, field.placeholder, field.sectionHeading]) {
    const text = candidate?.trim();
    if (text && !isLikelyFieldIdentifier(text)) return text;
  }
  const name = field.name?.trim();
  if (name && !isLikelyFieldIdentifier(name)) return name.replace(/[-_]/g, ' ');
  return '(untitled field)';
}

function contentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.[0]?.js ?? [];
}

async function injectTemporarily(tabId: number): Promise<boolean> {
  const files = contentScriptFiles();
  if (files.length === 0) return false;

  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files });
  } catch (e) {
    console.warn('[Pageside] Temporary injection failed:', e);
    return false;
  }

  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  if (frames) {
    await Promise.all(frames
      .filter(frame => frame.frameId !== 0)
      .map(frame =>
        chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files })
          .catch(() => {})
      ));
  }

  return true;
}

export function App() {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [view, setView] = useState<'questions' | 'chat'>('questions');
  const [questions, setQuestions] = useState<PanelItem[]>([]);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryPageUrl, setRecoveryPageUrl] = useState('');
  const [recoveryReadyPageKey, setRecoveryReadyPageKey] = useState('');
  const [notice, setNotice] = useState<string>('');
  const [needsEnable, setNeedsEnable] = useState(false);
  const [siteResponded, setSiteResponded] = useState(false);
  const [chatPageContext, setChatPageContext] = useState<PageContext | undefined>(undefined);
  const [enabling, setEnabling] = useState(false);
  const [vaultProfileId, setVaultProfileId] = useState('default');
  const [vaultProfiles, setVaultProfiles] = useState<VaultProfileOption[]>([]);
  const [vaultProfileOverride, setVaultProfileOverride] = useState(false);
  const [matchedProfileName, setMatchedProfileName] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [lastInsert, setLastInsert] = useState<Array<{ frameId: number; fieldIds: string[] }> | null>(null);
  const [sessionUsage, setSessionUsage] = useState({ inputTokens: 0, outputTokens: 0, estimated: false, costUsd: 0, hasCost: false });
  const [health, setHealth] = useState<SetupHealth>({
    loading: true,
    apiKey: false,
    vaultCount: 0,
    vaultError: false,
  });
  const originRef = useRef<string | null>(null);
  const tabIdRef = useRef<number | null>(null);
  const autoEnableAttempted = useRef<Set<string>>(new Set());

  const checkHealth = useCallback(async () => {
    try {
      const settings = await chrome.storage.local.get({ apiKey: '' });
      const response = await chrome.runtime.sendMessage({ type: 'get_vault_items' }) as any;
      const items = response?.type === 'vault_items' && Array.isArray(response.items) ? response.items : [];
      setHealth({
        loading: false,
        apiKey: Boolean(String(settings.apiKey ?? '').trim()),
        vaultCount: items.length,
        vaultError: Boolean(response?.error),
      });
    } catch {
      setHealth({ loading: false, apiKey: false, vaultCount: 0, vaultError: true });
    }
  }, []);

  const refresh = useCallback(async () => {
    const tab = await activeTab();
    if (tab?.id === undefined) return;
    await updateActiveTabId();
    tabIdRef.current = tab.id;
    originRef.current = siteOriginPattern(tab);
    setRecoveryPageUrl(tab.url ?? '');

    const frameIds = await frameIdsFor(tab.id);
    const results = await Promise.all(frameIds.map(async frameId => ({
      frameId,
      response: await sendToFrame(frameId, { type: 'get_panel_state' }) as any,
    })));

    const merged: PanelItem[] = [];
    let recoveryFailed = false;
    let responded = false;
    let profileMeta: {
      id?: string;
      profiles?: VaultProfileOption[];
      override?: boolean;
      matchedProfileName?: string | null;
    } | null = null;
    let pageContext: PageContext | null = null;

    for (const { frameId, response } of results) {
      if (response?.type === 'panel_state') {
        responded = true;
        if (!pageContext && response.context) {
          pageContext = response.context as PageContext;
        }
        if (!profileMeta && response.vaultProfileId) {
          profileMeta = {
            id: response.vaultProfileId as string,
            profiles: response.vaultProfiles as VaultProfileOption[] | undefined,
            override: Boolean(response.vaultProfileOverride),
            matchedProfileName: (response.matchedProfileName as string | null | undefined) ?? null,
          };
        }
        for (const question of response.questions as PanelFieldInfo[]) {
          merged.push({ ...question, frameId });
        }
      }
    }

    merged.sort((a, b) => a.frameId - b.frameId);
    const recoveryKey = tab.url ? pageRecoveryStorageKey(tab.url) : '';
    if (recoveryReady && recoveryEnabled && tab.url) {
      try {
        const saved = await getPageRecovery(tab.url);
        const savedDrafts = new Map((saved?.drafts ?? []).map(draft => [
          itemKey(draft.frameId, draft.fieldId),
          draft,
        ]));
        const unmatchedSavedDrafts = (saved?.drafts ?? []).slice();
        for (let index = 0; index < merged.length; index++) {
          const item = merged[index];
          const exactKey = itemKey(item.frameId, item.field.id);
          let savedDraft = savedDrafts.get(exactKey);
          let identityChanged = false;
          if (!savedDraft) {
            const selectorMatches = unmatchedSavedDrafts.filter(draft =>
              draft.frameId === item.frameId && draft.selector === item.field.selector
            );
            if (selectorMatches.length === 1) {
              savedDraft = selectorMatches[0];
              identityChanged = true;
            }
          }
          if (!savedDraft || item.draft || item.status !== 'none') continue;
          const savedIndex = unmatchedSavedDrafts.indexOf(savedDraft);
          if (savedIndex >= 0) unmatchedSavedDrafts.splice(savedIndex, 1);
          const stale = identityChanged || isRecoveredDraftStale(savedDraft, item.field);
          const restored: PanelItem = {
            ...item,
            status: 'draft',
            source: savedDraft.source,
            draft: savedDraft.draft,
            sources: savedDraft.sources,
            sourceDetails: savedDraft.sourceDetails ?? [],
            flags: savedDraft.flags,
            approved: false,
            error: null,
            usage: savedDraft.usage,
            recovered: true,
            stale,
            recoveryValueFingerprint: savedDraft.valueFingerprint,
          };
          merged[index] = restored;
          void sendToFrame(item.frameId, {
            type: 'restore_field_draft',
            fieldId: item.field.id,
            draft: restored.draft,
            source: restored.source,
            sources: restored.sources,
            flags: restored.flags,
            usage: restored.usage,
            stale: restored.stale,
            valueFingerprint: savedDraft.valueFingerprint,
            sourceDetails: restored.sourceDetails,
          });
        }
      } catch (error) {
        console.warn('[Pageside] Could not restore this page session:', error);
        recoveryFailed = true;
      }
    }
    setRecoveryReadyPageKey(recoveryReady && recoveryEnabled ? recoveryKey : '');
    setQuestions(merged);
    setChatPageContext(pageContext ?? undefined);

    if (!responded) {
      // The host permission can survive an extension reload while the dynamic
      // content script registration is cleared. Recover silently in that case
      // instead of asking the user to enable the site again.
      const pattern = originRef.current;
      const key = pattern ? `${tab.id}:${pattern}` : null;
      if (pattern && key && !autoEnableAttempted.current.has(key)) {
        autoEnableAttempted.current.add(key);
        try {
          const granted = await chrome.permissions.contains({ origins: [pattern] });
          if (granted) {
            const response = await chrome.runtime.sendMessage({
              type: 'enable_site',
              tabId: tab.id,
              origin: pattern,
            });
            if (response?.enabled) {
              setNeedsEnable(false);
              setNotice('Reconnecting to this site…');
              window.setTimeout(() => { void refresh(); }, 250);
              return true;
            }
          }
        } catch {
          /* fall through to the normal enable state */
        }
        autoEnableAttempted.current.delete(key);
      }
    }

    setNeedsEnable(!responded);
    setSiteResponded(responded);
    setNotice(recoveryFailed ? 'Could not restore saved drafts. Check extension storage and try again.' : '');
    setConfirmBulk(false);
    if (profileMeta) {
      setVaultProfileId(profileMeta.id ?? 'default');
      setVaultProfiles(profileMeta.profiles ?? []);
      setVaultProfileOverride(Boolean(profileMeta.override));
      setMatchedProfileName(profileMeta.matchedProfileName ?? null);
    }
    return responded;
  }, [recoveryEnabled, recoveryReady]);

  const refreshUntilReady = async (attempts = 16): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const responded = await refresh();
      if (responded) return true;
      await new Promise(resolve => window.setTimeout(resolve, 150));
    }
    return false;
  };

  useEffect(() => {
    void chrome.storage.local.get({ [RECOVERY_ENABLED_KEY]: false })
      .then(settings => setRecoveryEnabled(settings[RECOVERY_ENABLED_KEY] === true))
      .catch(error => {
        console.warn('[Pageside] Could not load recovery preference:', error);
        setNotice('Could not load the session-recovery setting.');
      })
      .finally(() => setRecoveryReady(true));
  }, []);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[RECOVERY_ENABLED_KEY]) {
        const enabled = changes[RECOVERY_ENABLED_KEY].newValue === true;
        setRecoveryEnabled(enabled);
        if (!enabled) setRecoveryReadyPageKey('');
      }
      if (changes.apiKey) void checkHealth();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [checkHealth]);

  useEffect(() => {
    if (!recoveryReady || !recoveryEnabled || !recoveryPageUrl || questions.length === 0) return;
    const recoveryKey = pageRecoveryStorageKey(recoveryPageUrl);
    if (recoveryReadyPageKey !== recoveryKey) return;
    if (questions.some(item => item.stale && item.recovered)) return;
    const timer = window.setTimeout(() => {
      const drafts: RecoveredDraft[] = questions
        .filter(item => item.draft && item.status === 'draft')
        .map(item => ({
          frameId: item.frameId,
          fieldId: item.field.id,
          fieldType: item.field.type,
          label: item.field.label ?? item.field.placeholder ?? '',
          selector: item.field.selector,
          valueFingerprint: fingerprintFieldValue(item.field.currentValue),
          draft: item.draft,
          source: item.source,
          sources: item.sources,
          sourceDetails: item.sourceDetails,
          flags: item.flags,
          usage: item.usage,
          updatedAt: Date.now(),
        }));
      void savePageDrafts(recoveryPageUrl, drafts).catch(error => {
        console.warn('[Pageside] Could not save page drafts:', error);
        setNotice('Could not save this session. Check available extension storage.');
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [questions, recoveryEnabled, recoveryPageUrl, recoveryReady, recoveryReadyPageKey]);

  useEffect(() => {
    void refresh();
    void checkHealth();
    const listener = (msg: SidePanelEvent, sender: chrome.runtime.MessageSender): boolean => {
      if (sender.tab?.id !== activeTabId) return false;
      handleEvent(msg, sender.frameId ?? 0);
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);

    const onActivated = () => {
      setLastInsert(null);
      setSessionUsage({ inputTokens: 0, outputTokens: 0, estimated: false, costUsd: 0, hasCost: false });
      void refresh();
      void checkHealth();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [refresh, checkHealth, recoveryReady]);

  async function toggleRecovery(enabled: boolean): Promise<void> {
    try {
      await chrome.storage.local.set({ [RECOVERY_ENABLED_KEY]: enabled });
      setRecoveryEnabled(enabled);
      if (!enabled) {
        await clearPageRecoveries();
        setRecoveryReadyPageKey('');
      } else {
        await refresh();
      }
    } catch (error) {
      console.warn('[Pageside] Could not update session recovery:', error);
      setNotice('Could not update session recovery. Check extension storage and try again.');
    }
  }

  function addUsage(usage?: GenerationUsage): void {
    if (!usage) return;
    setSessionUsage(prev => ({
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      estimated: prev.estimated || usage.estimated,
      costUsd: prev.costUsd + (usage.costUsd ?? 0),
      hasCost: prev.hasCost || usage.costUsd !== undefined,
    }));
  }

  function handleEvent(msg: SidePanelEvent, frameId: number): void {
    switch (msg.type) {
      case 'questions_updated':
        setQuestions(prev => {
          const others = prev.filter(q => q.frameId !== frameId);
          const updated = msg.questions.map(q => ({ ...q, frameId }));
          return [...others, ...updated].sort((a, b) => a.frameId - b.frameId);
        });
        break;
      case 'answer_progress':
        updateItem(frameId, msg.fieldId, q => ({
          ...q,
          status: 'drafting',
          source: 'llm',
          draft: msg.text,
          sources: [],
          flags: [],
          approved: false,
          error: null,
          usage: null,
        }));
        break;
      case 'answer_ready':
        addUsage(msg.usage);
        updateItem(frameId, msg.fieldId, q => ({
          ...q,
          status: 'draft',
          source: msg.source,
          draft: msg.answer,
          sources: msg.sources,
          sourceDetails: msg.sourceDetails,
          flags: msg.flags,
          approved: false,
          error: null,
          usage: msg.usage ?? null,
        }));
        break;
      case 'answer_inserted':
        updateItem(frameId, msg.fieldId, q => ({
          ...q,
          status: 'inserted',
          approved: true,
          error: null,
        }));
        break;
      case 'answer_error':
        addUsage(msg.usage);
        updateItem(frameId, msg.fieldId, q => {
          const keepDraft = q.status === 'draft' && Boolean(q.draft);
          return {
            ...q,
            status: keepDraft ? 'draft' : 'error',
            draft: keepDraft ? q.draft : '',
            source: keepDraft ? q.source : null,
            approved: false,
            error: msg.error,
            usage: msg.usage ?? q.usage,
          };
        });
        break;
      case 'vault_profile_changed':
        setVaultProfileId(msg.vaultProfileId);
        setVaultProfiles(msg.vaultProfiles);
        setVaultProfileOverride(msg.override);
        break;
    }
  }

  function updateItem(frameId: number, fieldId: string, updater: (item: PanelItem) => PanelItem): void {
    setQuestions(prev => prev.map(q => (q.frameId === frameId && q.field.id === fieldId ? updater(q) : q)));
  }

  async function handleScan(): Promise<void> {
    const tab = await activeTab();
    if (tab?.id === undefined) return;
    const frameIds = await frameIdsFor(tab.id);
    await Promise.all(frameIds.map(frameId => sendToFrame(frameId, { type: 'scan_page' })));
    await refresh();
  }

  function handleEnable(): void {
    const pattern = originRef.current;
    const tabId = tabIdRef.current;
    const isFilePage = pattern === 'file:///*';
    if (tabId === null) {
      setNotice('This page cannot be enabled. Try refreshing the panel or the page.');
      return;
    }

    setEnabling(true);
    setNotice('Requesting permission…');

    const finish = (message?: string) => {
      if (message) {
        console.warn('[Pageside] Enable site:', message);
        setNotice(message);
      }
      setEnabling(false);
    };

    const fallback = async (reason: string) => {
      const injected = await injectTemporarily(tabId);
      if (injected) {
        await refreshUntilReady();
        finish(`${reason} Enabled for this page only; reloading will require enabling again.`);
      } else {
        finish(isFilePage
          ? `${reason} For local files, enable "Allow access to file URLs" in chrome://extensions, or serve the page over HTTP.`
          : reason);
      }
    };

    if (!pattern) {
      void fallback('Could not determine this site origin.');
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      void fallback('The permission prompt did not respond.');
    }, 10000);

    const settle = (next: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      next();
    };

    try {
      chrome.permissions.request({ origins: [pattern] }, granted => {
        settle(() => {
          if (chrome.runtime.lastError) {
            void fallback(chrome.runtime.lastError.message ?? 'Permission request failed.');
            return;
          }
          if (!granted) {
            void fallback(isFilePage
              ? 'Permission was not granted. For local files, enable "Allow access to file URLs" in chrome://extensions, or serve the page over HTTP.'
              : 'Permission was not granted.');
            return;
          }

          void (async () => {
            try {
              const response = await chrome.runtime.sendMessage({
                type: 'enable_site',
                tabId,
                origin: pattern,
              });
              if (!response?.enabled) {
                await fallback(response?.error ?? 'Could not enable this site.');
                return;
              }
              await refreshUntilReady();
              finish();
            } catch (e) {
              await fallback(`Could not enable this site: ${(e as Error).message}`);
            }
          })();
        });
      });
    } catch (e) {
      settle(() => {
        void fallback(`Permission request failed: ${(e as Error).message}`);
      });
    }
  }

  async function insertReviewed(): Promise<void> {
    const byFrame = new Map<number, string[]>();
    for (const item of approvedItems) {
      const ids = byFrame.get(item.frameId) ?? [];
      ids.push(item.field.id);
      byFrame.set(item.frameId, ids);
    }

    const results = await Promise.all([...byFrame.entries()].map(async ([frameId, fieldIds]) => {
      const response = await sendToFrame(frameId, { type: 'bulk_insert', fieldIds }) as any;
      const inserted = response?.type === 'bulk_insert_result' ? response.insertedFieldIds as string[] : [];
      return { frameId, fieldIds: inserted };
    }));

    const inserted = results.filter(group => group.fieldIds.length > 0);
    setLastInsert(inserted.length > 0 ? inserted : null);
    setConfirmBulk(false);
  }

  async function undoLastInsert(): Promise<void> {
    if (!lastInsert) return;
    await Promise.all(lastInsert.map(group =>
      sendToFrame(group.frameId, { type: 'undo_bulk', fieldIds: group.fieldIds })
    ));
    setLastInsert(null);
  }

  const approvedItems = questions.filter(q => q.approved && REVIEWABLE.includes(q.status));
  const lastInsertCount = lastInsert?.reduce((sum, group) => sum + group.fieldIds.length, 0) ?? 0;
  const autoProfileName = vaultProfiles.find(profile => profile.id === vaultProfileId)?.name ?? 'Default';

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      <header className="px-3 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold">{t('panel.title')}</h1>
          <ThemeToggle />
        </div>
        <div className="mt-2 flex gap-1" role="group" aria-label="Panel view">
          <button
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded ${view === 'questions' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            aria-pressed={view === 'questions'}
            onClick={() => setView('questions')}
          >
            {t('panel.questions')}
          </button>
          <button
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded ${view === 'chat' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            aria-pressed={view === 'chat'}
            onClick={() => setView('chat')}
          >
            {t('panel.chat')}
          </button>
        </div>
        <p className="text-xs text-gray-600" aria-live="polite">{t('panel.detected')}{questions.length > 0 ? ` · ${questions.length}` : ''}</p>
        <label className="mt-1 flex items-start gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-400 text-blue-600 focus:ring-blue-500"
            checked={recoveryEnabled}
            disabled={!recoveryReady}
            onChange={event => void toggleRecovery(event.target.checked)}
          />
          <span>
            Save drafts and chat on this device
            <span className="block text-gray-600">Stored locally. Turning this off clears saved sessions.</span>
          </span>
        </label>
        {(sessionUsage.inputTokens > 0 || sessionUsage.outputTokens > 0) && (
          <p className="text-xs text-gray-600 mt-0.5" aria-live="polite">
            {t('panel.session')}: {sessionUsage.estimated ? '~' : ''}{formatTokens(sessionUsage.inputTokens)} in · {formatTokens(sessionUsage.outputTokens)} out
            {sessionUsage.hasCost ? ` · Est. ${formatCost(sessionUsage.costUsd)}` : ''}
          </p>
        )}
        {matchedProfileName && (
          <p className="text-xs text-gray-600 mt-0.5">Site profile: {matchedProfileName}</p>
        )}
        {vaultProfiles.length > 0 && (
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-gray-600 shrink-0">{t('panel.vault')}</span>
            <select
              className="flex-1 min-w-0 border border-gray-400 rounded px-2 py-2 text-sm bg-white" aria-label="Vault profile"
              value={vaultProfileOverride ? vaultProfileId : ''}
              onChange={e => void sendToFrame(0, { type: 'set_vault_profile', profileId: e.target.value || null })}
              disabled={needsEnable}
            >
              <option value="">{t('panel.auto')} — {autoProfileName}</option>
              {vaultProfiles.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>
        )}
      </header>

      <div className={view === 'questions' ? 'contents' : 'hidden'}>
      <div className="px-3 py-2 flex gap-2 border-b border-gray-200 bg-white">
        <button
          className="flex-1 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600"
          disabled={needsEnable}
          onClick={() => void handleScan()}
        >
          {t('panel.scan')}
        </button>
        <button
          className={`flex-1 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded ${approvedItems.length ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-600'}`}
          disabled={!approvedItems.length || needsEnable}
          onClick={() => setConfirmBulk(true)}
        >
          {t('panel.insertApproved')} ({approvedItems.length})
        </button>
      </div>

      {confirmBulk && approvedItems.length > 0 && (
        <div className="px-3 py-2 border-b border-amber-200 bg-amber-50" role="alert">
          <p className="text-sm text-amber-900">
            Insert {approvedItems.length} approved {approvedItems.length === 1 ? 'answer' : 'answers'} into the page? You can undo this afterward.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              className="px-3 py-2 min-h-[40px] text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700"
              onClick={() => void insertReviewed()}
            >
              Insert {approvedItems.length}
            </button>
            <button
              className="px-3 py-2 min-h-[40px] text-sm font-medium rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100"
              onClick={() => setConfirmBulk(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {lastInsert && (
        <div className="px-3 py-2 flex items-center gap-2 border-b border-green-200 bg-green-50" role="status">
          <span className="text-sm text-green-800">
            Inserted {lastInsertCount} {lastInsertCount === 1 ? 'answer' : 'answers'}.
          </span>
          <button
            className="ml-auto text-sm font-medium px-2.5 py-1.5 rounded bg-white border border-green-400 text-green-900 hover:bg-green-100"
            onClick={() => void undoLastInsert()}
          >
            Undo last insert
          </button>
        </div>
      )}

      <div className="px-3 py-2 flex gap-2 border-b border-gray-200 bg-gray-50">
        <button
          className="flex-1 px-3 py-2 min-h-[40px] text-sm font-medium rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          disabled={needsEnable}
          onClick={() => void sendToFrame(0, { type: 'generate_document', kind: 'cover_letter' })}
        >
          {t('panel.coverLetter')}
        </button>
        <button
          className="flex-1 px-3 py-2 min-h-[40px] text-sm font-medium rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          disabled={needsEnable}
          onClick={() => void sendToFrame(0, { type: 'generate_document', kind: 'video_script' })}
        >
          {t('panel.videoScript')}
        </button>
      </div>

      {needsEnable && (
        <div className="px-3 py-3 bg-amber-50 border-b border-amber-200">
          <p className="text-sm text-amber-900 mb-2">
            {t('panel.enablePrompt')}
          </p>
          {originRef.current === 'file:///*' && (
            <p className="text-sm text-amber-800 mb-2">
              Local files need <strong>Allow access to file URLs</strong> enabled on the extension, or serve the page over HTTP (e.g. <code>python3 -m http.server 8080</code>).
            </p>
          )}
          <button
            className={`px-3 py-2 min-h-[40px] text-sm font-medium rounded text-white ${enabling ? 'bg-amber-500' : 'bg-amber-700 hover:bg-amber-800'}`}
            disabled={enabling}
            onClick={handleEnable}
          >
            {enabling ? t('panel.enabling') : t('panel.enable')}
          </button>
          {notice && (
            <p className="text-sm text-amber-900 mt-2">{notice}</p>
          )}
        </div>
      )}

      {notice && !needsEnable && (
        <div className="px-3 py-2 text-sm text-amber-900 bg-amber-50 border-b border-amber-200" role="status">{notice}</div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {questions.length === 0 && !notice && (
          <section className="rounded-md border border-gray-300 bg-white p-3" aria-live="polite">
            <h2 className="text-sm font-semibold">Before you draft</h2>
            {health.loading ? (
              <p className="mt-2 text-sm text-gray-600">Checking setup…</p>
            ) : (
              <ul className="mt-2 space-y-2">
                <SetupStep
                  done={health.apiKey}
                  title={health.apiKey ? 'API key configured' : 'API key needed'}
                  detail={health.apiKey ? undefined : 'Add your OpenRouter or Anthropic key to draft answers.'}
                  actionLabel={health.apiKey ? undefined : 'Add API key'}
                  onAction={() => void openOptionsTab('settings')}
                />
                <SetupStep
                  done={health.vaultCount > 0}
                  title={health.vaultError ? 'Could not check your vault' : health.vaultCount > 0 ? `${health.vaultCount} vault items available` : 'Vault is empty'}
                  detail={health.vaultError ? 'Reload the extension, then retry.' : health.vaultCount > 0 ? undefined : 'Add a resume, notes, or portfolio so drafts have facts to use.'}
                  actionLabel={health.vaultError ? 'Retry check' : health.vaultCount > 0 ? undefined : 'Add vault content'}
                  onAction={health.vaultError ? () => void checkHealth() : () => void openOptionsTab('vault')}
                />
                <SetupStep
                  done={!needsEnable}
                  title={needsEnable ? 'Site access is off' : 'Site access is enabled'}
                  detail={needsEnable ? 'Enable this page below before scanning.' : undefined}
                  actionLabel={needsEnable ? 'Enable this site' : undefined}
                  onAction={needsEnable ? handleEnable : undefined}
                />
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-600">
              {needsEnable ? 'Finish setup, then scan the page.' : 'No questions detected yet. Scan the page to find form fields.'}
            </p>
            {!needsEnable && (
              <button
                className="mt-2 w-full px-3 py-2 min-h-[44px] text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => void handleScan()}
              >
                {t('panel.scan')}
              </button>
            )}
          </section>
        )}
        {questions.map(q => (
          <FieldCard key={itemKey(q.frameId, q.field.id)} info={q} />
        ))}
      </div>
      </div>

      <div className={view === 'chat' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <Chat
          vaultProfileId={siteResponded ? vaultProfileId : undefined}
          pageContext={chatPageContext}
          pageUrl={recoveryPageUrl}
          recoveryEnabled={recoveryEnabled}
          onUsage={addUsage}
          active={view === 'chat'}
        />
      </div>
    </div>
  );
}

function SetupStep({
  done,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  done: boolean;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}
        aria-hidden="true"
      >
        {done ? '✓' : '!'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {detail && <p className="mt-0.5 text-xs text-gray-600">{detail}</p>}
        {actionLabel && onAction && (
          <button
            className="mt-1 text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </li>
  );
}

function FieldCard({ info }: { info: PanelItem }) {
  const { field, status, source, draft, frameId, approved, error, usage, sources, sourceDetails, flags, recovered, stale } = info;
  const [text, setText] = useState(draft);
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDraft = Boolean(draft) && status !== 'none' && status !== 'error' && status !== 'skipped';
  const canReview = REVIEWABLE.includes(status);
  const canDraft = (status === 'none' || status === 'skipped' || status === 'cancelled') && info.category !== 'factual';

  useEffect(() => {
    setText(draft);
  }, [draft]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function commitDraft(): void {
    setEditing(false);
    if (text !== draft) {
      void sendToFrame(frameId, { type: 'update_field_draft', fieldId: field.id, draft: text });
    }
  }

  async function copyDraft(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text || draft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const typeLabel = field.type === 'textarea' || field.type === 'richtext' ? 'long text' : 'short text';
  const displayLabel = displayFieldLabel(field);

  return (
    <div className="bg-white border border-gray-200 rounded-md p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{displayLabel}</p>
          {field.sectionHeading && (
            <p className="text-xs text-gray-600 mt-0.5 truncate" title={field.sectionHeading}>{field.sectionHeading}</p>
          )}
          <p className="text-xs text-gray-600 mt-0.5">
            {field.type} · {typeLabel}
            {field.required ? ' · required' : ''}
            {frameId > 0 ? ` · frame ${frameId}` : ''}
          </p>
          {field.currentValue && (
            <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">Current: {field.currentValue}</p>
          )}
          {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
            <p className="text-xs text-gray-600 mt-0.5">
              {usage.estimated ? '~' : ''}{formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
              {usage.costUsd !== undefined ? ` · Est. ${formatCost(usage.costUsd)}` : ''}
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_CLASS[status]}`} aria-live="polite">
            {t(STATUS_KEY[status])}
          </span>
          {source && hasDraft && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${SOURCE_CLASS[source]}`}>
              {t(SOURCE_KEY[source])}
            </span>
          )}
          {recovered && (
            <p className="mt-1 text-xs text-gray-600">Recovered from this device</p>
          )}
          {stale && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-2" role="alert">
              <p className="text-xs text-amber-900">
                This field or its value changed since the draft was saved. Review the current question and value before using this draft.
              </p>
              <button
                className="mt-1.5 px-2.5 py-1.5 min-h-[36px] text-xs font-medium rounded bg-white border border-amber-500 text-amber-900 hover:bg-amber-100"
                onClick={() => void sendToFrame(frameId, { type: 'review_recovered_field', fieldId: field.id })}
              >
                I reviewed this field
              </button>
            </div>
          )}
        </div>
      </div>

      {(hasDraft || canReview) && (
        <textarea
          className="mt-2 w-full box-border text-sm text-gray-800 border border-gray-300 rounded px-2 py-1.5 leading-relaxed max-h-52 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:bg-gray-50"
          rows={4}
          value={text}
          aria-label={`Draft answer for ${displayLabel}`}
          aria-live={status === 'drafting' ? 'polite' : undefined}
          readOnly={!canReview}
          onFocus={() => setEditing(true)}
          onChange={e => { setText(e.target.value); setEditing(true); }}
          onBlur={commitDraft}
        />
      )}

      {flags.length > 0 && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5">
          <p className="text-xs font-semibold text-red-800">Missing information (NEEDS INPUT)</p>
          {flags.map((flag, index) => (
            <p key={index} className="text-xs text-red-800 mt-0.5">{flag}</p>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <p className="mt-1 text-xs text-gray-600 truncate" title={sources.join(', ')}>Sources: {sources.join(', ')}</p>
      )}
      {sourceDetails.length > 0 && (
        <details className="mt-1 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
          <summary className="cursor-pointer font-medium">View supporting passages ({sourceDetails.length})</summary>
          <div className="mt-1 space-y-2">
            {sourceDetails.map(sourceDetail => (
              <div key={`${sourceDetail.id}:${sourceDetail.title}`}>
                <p className="font-medium">{sourceDetail.title}</p>
                <blockquote className="mt-0.5 border-l-2 border-gray-300 pl-2 whitespace-pre-wrap">
                  {sourceDetail.excerpt || 'No excerpt available for this source.'}
                </blockquote>
              </div>
            ))}
          </div>
        </details>
      )}

      <button
        className="mt-1 text-xs text-gray-600 underline underline-offset-2 hover:text-gray-800"
        onClick={() => setShowDetails(value => !value)}
        aria-expanded={showDetails}
      >
        {showDetails ? t('action.hideDetails') : t('action.details')}
      </button>
      {showDetails && (
        <dl className="mt-1 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700 space-y-0.5">
          <div><dt className="inline font-medium">Selector: </dt><dd className="inline break-all">{field.selector || '(none)'}</dd></div>
          <div><dt className="inline font-medium">Name: </dt><dd className="inline">{field.name ?? '(none)'}</dd></div>
          <div><dt className="inline font-medium">Placeholder: </dt><dd className="inline">{field.placeholder ?? '(none)'}</dd></div>
          {field.maxLength !== null && (
            <div><dt className="inline font-medium">Max length: </dt><dd className="inline">{field.maxLength}</dd></div>
          )}
        </dl>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5" role="alert">
          <p className="text-sm text-red-800 leading-relaxed">{error.message}</p>
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            {error.retryable && (
              <button
                className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-white border border-red-400 text-red-800 hover:bg-red-100"
                onClick={() => void sendToFrame(frameId, { type: 'answer_field', fieldId: field.id })}
              >
                {t('action.retry')}
              </button>
            )}
            {error.action && (
              <button
                className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100"
                onClick={() => void openOptionsTab(error.action!.optionsTab)}
              >
                {error.action.label}
              </button>
            )}
          </div>
        </div>
      )}

      {canReview && (
        <label className="mt-2 flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-400 text-blue-600 focus:ring-blue-500"
            checked={approved}
            disabled={stale}
            onChange={e => void sendToFrame(frameId, {
              type: 'set_field_approved',
              fieldId: field.id,
              approved: e.target.checked,
            })}
          />
          <span>{approved ? t('action.approved') : t('action.approve')}</span>
        </label>
      )}

      <div className="mt-2 flex gap-1.5 flex-wrap">
        {canDraft && (
          <button
            className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-blue-50 text-blue-800 border border-blue-300 hover:bg-blue-100"
            onClick={() => void sendToFrame(frameId, { type: 'answer_field', fieldId: field.id })}
          >
            {t('action.draft')}
          </button>
        )}
        {canReview && (
          <>
            <button
              className="text-xs px-2.5 py-1.5 min-h-[36px] rounded bg-green-600 text-white hover:bg-green-700"
              onClick={() => void sendToFrame(frameId, { type: 'insert_field', fieldId: field.id })}
            >
              {t('action.insert')}
            </button>
            <button
              className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
              onClick={() => void sendToFrame(frameId, { type: 'regenerate_answer', fieldId: field.id })}
            >
              {t('action.regenerate')}
            </button>
            {REVISIONS.map(revision => (
              <button
                key={revision.labelKey}
                className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                onClick={() => void sendToFrame(frameId, {
                  type: 'revise_field',
                  fieldId: field.id,
                  instruction: revision.instruction,
                })}
              >
                {t(revision.labelKey)}
              </button>
            ))}
            <button
              className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
              onClick={() => void sendToFrame(frameId, { type: 'skip_field', fieldId: field.id })}
            >
              {t('action.skip')}
            </button>
          </>
        )}
        {hasDraft && (
          <button
            className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            onClick={() => void copyDraft()}
          >
            {copied ? t('action.copied') : t('action.copy')}
          </button>
        )}
        {status === 'drafting' && (
          <button
            className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-red-50 text-red-800 border border-red-300 hover:bg-red-100"
            onClick={() => void sendToFrame(frameId, { type: 'stop_generation' })}
          >
            {t('action.stop')}
          </button>
        )}
        {status === 'inserted' && (
          <button
            className="text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
            onClick={() => void sendToFrame(frameId, { type: 'undo_field', fieldId: field.id })}
          >
            {t('action.undo')}
          </button>
        )}
        <button
          className="ml-auto text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          onClick={() => void sendToFrame(frameId, { type: 'set_field_focus', fieldId: field.id })}
        >
          {t('action.locate')}
        </button>
      </div>
    </div>
  );
}
