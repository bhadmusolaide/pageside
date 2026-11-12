import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerSource, GenerationUsage, StreamEvent, StreamRequest } from '../lib/messaging';
import type { PageContext } from '../lib/fieldDetector';
import type { VaultItem } from '../lib/vault';
import type { RetrievalMode } from '../lib/retrieval';
import { extractSourceExcerpt, selectRelevantVaultItems } from '../lib/promptBuilder';
import { buildChatSystemPrompt, buildChatUserPrompt } from '../lib/chatPrompt';
import {
  clampContextBudget,
  estimateTokens,
  formatCost,
  formatTokens,
  outputBudgetFor,
} from '../lib/usage';
import { t } from '../lib/i18n';
import { getPageRecovery, pageRecoveryStorageKey, savePageChat } from '../lib/recovery';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources: AnswerSource[];
  usage?: GenerationUsage;
  error?: string;
  pending?: boolean;
  stopped?: boolean;
}

interface ChatSettings {
  language: string;
  maxLength: number;
  retrievalMode: RetrievalMode;
  vaultContextBudget: number;
}

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  language: 'en',
  maxLength: 500,
  retrievalMode: 'keyword',
  vaultContextBudget: 6000,
};

const REQUEST_TIMEOUT_MS = 60000;

function emptyContext(): PageContext {
  return {
    title: '',
    url: '',
    visibleText: '',
    companyName: null,
    jobTitle: null,
    jobDescription: null,
  };
}

async function loadSettings(): Promise<ChatSettings> {
  try {
    const stored = await chrome.storage.local.get(DEFAULT_CHAT_SETTINGS);
    const mode = stored.retrievalMode;
    return {
      language: typeof stored.language === 'string' ? stored.language : 'en',
      maxLength: typeof stored.maxLength === 'number' ? stored.maxLength : 500,
      retrievalMode: mode === 'tfidf' || mode === 'embeddings' ? mode : 'keyword',
      vaultContextBudget: clampContextBudget(stored.vaultContextBudget),
    };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

function buildConversationContext(messages: ChatMessage[], maxTokens = 2500): string {
  const parts: string[] = [];
  let total = 0;

  for (const message of [...messages].reverse()) {
    if (message.pending || message.error || !message.text.trim()) continue;
    const part = `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text.trim()}`;
    const tokens = estimateTokens(part);
    if (total + tokens > maxTokens) break;
    parts.unshift(part);
    total += tokens;
    if (parts.length >= 8) break;
  }

  return parts.join('\n\n');
}

export function Chat({
  vaultProfileId,
  pageContext,
  onUsage,
  active = true,
  pageUrl = '',
  recoveryEnabled = false,
}: {
  vaultProfileId?: string;
  pageContext?: PageContext;
  onUsage?: (usage: GenerationUsage) => void;
  active?: boolean;
  pageUrl?: string;
  recoveryEnabled?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoadedFor, setMessagesLoadedFor] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [tabContext, setTabContext] = useState<PageContext>(emptyContext);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [notice, setNotice] = useState('');

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const onUsageRef = useRef(onUsage);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentRecoveryKey = pageUrl ? pageRecoveryStorageKey(pageUrl) : '';

  onUsageRef.current = onUsage;

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const markAssistantError = useCallback((message: string) => {
    const id = assistantIdRef.current;
    if (!id) return;
    setMessages(prev => prev.map(item =>
      item.id === id ? { ...item, pending: false, error: message } : item
    ));
  }, []);

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    if (!requestIdRef.current || event.requestId !== requestIdRef.current) return;

    if (event.type === 'chunk') {
      const id = assistantIdRef.current;
      setMessages(prev => prev.map(item =>
        item.id === id ? { ...item, text: item.text + event.text } : item
      ));
      return;
    }

    if (event.type === 'done') {
      clearTimer();
      requestIdRef.current = null;
      setStreaming(false);
      const id = assistantIdRef.current;
      setMessages(prev => prev.map(item =>
        item.id === id
          ? {
              ...item,
              text: event.answer.trim(),
              sources: event.sources ?? [],
              usage: event.usage,
              pending: false,
              error: undefined,
            }
          : item
      ));
      if (event.usage) onUsageRef.current?.(event.usage);
      return;
    }

    clearTimer();
    requestIdRef.current = null;
    setStreaming(false);
    const id = assistantIdRef.current;
    setMessages(prev => prev.map(item =>
      item.id === id
        ? { ...item, pending: false, error: event.error || t('chat.error'), usage: event.usage ?? item.usage }
        : item
    ));
    if (event.usage) onUsageRef.current?.(event.usage);
  }, [clearTimer]);

  const getPort = useCallback((): chrome.runtime.Port | null => {
    if (portRef.current) return portRef.current;
    try {
      const port = chrome.runtime.connect(undefined, { name: 'sr_stream' });
      portRef.current = port;
      port.onMessage.addListener(handleStreamEvent);
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (requestIdRef.current) {
          requestIdRef.current = null;
          setStreaming(false);
          clearTimer();
          markAssistantError('The extension connection was lost. Reload the panel and try again.');
        }
      });
      return port;
    } catch {
      return null;
    }
  }, [clearTimer, handleStreamEvent, markAssistantError]);

  const refreshTabContext = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs[0];
      setTabContext({
        ...emptyContext(),
        title: tab?.title ?? '',
        url: tab?.url ?? '',
      });
    } catch {
      setTabContext(emptyContext());
    }
  }, []);

  const fetchVaultItems = useCallback(async (): Promise<{ items: VaultItem[]; error?: string }> => {
    try {
      const response = await chrome.runtime.sendMessage(
        vaultProfileId
          ? { type: 'get_vault_items', vaultProfileId }
          : { type: 'get_vault_items' }
      ) as { type?: string; items?: VaultItem[]; error?: string } | null;
      if (response?.type === 'vault_items' && Array.isArray(response.items)) {
        return { items: response.items };
      }
      return { items: [], error: response?.error ?? 'Unknown error' };
    } catch {
      return { items: [], error: 'Could not load your vault. Reload the panel and try again.' };
    }
  }, [vaultProfileId]);

  const refreshVault = useCallback(async () => {
    const result = await fetchVaultItems();
    setVaultItems(result.items);
    setVaultLoaded(true);
    setNotice(result.error ? `Could not load your vault: ${result.error}` : '');
  }, [fetchVaultItems]);

  useEffect(() => {
    void refreshTabContext();
  }, [refreshTabContext]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setMessagesLoadedFor('');
    if (!recoveryEnabled || !pageUrl) {
      setMessagesLoadedFor(currentRecoveryKey);
      return () => { cancelled = true; };
    }

    void getPageRecovery(pageUrl).then(recovery => {
      if (cancelled) return;
      setMessages((recovery?.chat ?? []).map(message => ({ ...message, pending: false })));
      setMessagesLoadedFor(currentRecoveryKey);
    }).catch(error => {
      if (cancelled) return;
      console.warn('[Pageside] Could not restore chat session:', error);
      setNotice('Could not restore this chat. Check extension storage and try again.');
      setMessagesLoadedFor(currentRecoveryKey);
    });
    return () => { cancelled = true; };
  }, [currentRecoveryKey, pageUrl, recoveryEnabled]);

  useEffect(() => {
    if (!recoveryEnabled || !pageUrl || messagesLoadedFor !== currentRecoveryKey) return;
    const timer = window.setTimeout(() => {
      void savePageChat(pageUrl, messages).catch(error => {
        console.warn('[Pageside] Could not save chat session:', error);
        setNotice('Could not save this chat. Check available extension storage.');
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentRecoveryKey, messages, messagesLoadedFor, pageUrl, recoveryEnabled]);

  useEffect(() => {
    setVaultLoaded(false);
    setVaultItems([]);
    void refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    const onActivated = () => {
      void refreshTabContext();
      void refreshVault();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, [refreshTabContext, refreshVault]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (!active) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [active]);

  useEffect(() => () => {
    clearTimer();
    try { portRef.current?.disconnect(); } catch { /* noop */ }
    portRef.current = null;
  }, [clearTimer]);

  const stop = useCallback(() => {
    const requestId = requestIdRef.current;
    if (requestId) {
      try {
        portRef.current?.postMessage({
          channel: 'sr_stream',
          type: 'stop',
          requestId,
        } satisfies StreamRequest);
      } catch { /* noop */ }
    }
    clearTimer();
    requestIdRef.current = null;
    setStreaming(false);
    const id = assistantIdRef.current;
    setMessages(prev => prev.map(item =>
      item.id === id ? { ...item, pending: false, stopped: true } : item
    ));
  }, [clearTimer]);

  const newChat = useCallback(() => {
    const requestId = requestIdRef.current;
    if (requestId) {
      try {
        portRef.current?.postMessage({
          channel: 'sr_stream',
          type: 'stop',
          requestId,
        } satisfies StreamRequest);
      } catch { /* noop */ }
    }
    clearTimer();
    requestIdRef.current = null;
    assistantIdRef.current = null;
    setStreaming(false);
    setMessages([]);
    setNotice('');
  }, [clearTimer]);

  const send = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? input).trim();
    if (!question || streaming) return;

    setInput('');
    setNotice('');
    const assistantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    const conversationContext = buildConversationContext(messages);

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', text: question, sources: [] },
      { id: assistantId, role: 'assistant', text: '', sources: [], pending: true },
    ]);
    setStreaming(true);

    const settings = await loadSettings();
    let items = vaultItems;
    if (!vaultLoaded) {
      const result = await fetchVaultItems();
      if (!result.error) items = result.items;
    }

    const context = pageContext ?? tabContext;
    const query = [question, context.jobTitle, context.companyName]
      .filter(Boolean)
      .join(' ');
    const { context: vaultContext, usedItems } = selectRelevantVaultItems(
      query,
      items,
      clampContextBudget(settings.vaultContextBudget),
      settings.retrievalMode
    );

    const systemPrompt = buildChatSystemPrompt(settings.language);
    const prompt = buildChatUserPrompt({
      question,
      pageContext: context,
      vaultContext,
      conversationContext: conversationContext || undefined,
      maxLength: settings.maxLength,
    });
    const sources: AnswerSource[] = usedItems.map(item => ({
      id: item.id!,
      title: item.title,
      type: item.type,
      excerpt: extractSourceExcerpt(question, item.content),
    }));

    const port = getPort();
    if (!port) {
      setStreaming(false);
      markAssistantError('The extension connection was lost. Reload the panel and try again.');
      return;
    }

    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      port.postMessage({
        channel: 'sr_stream',
        type: 'start',
        requestId,
        prompt,
        systemPrompt,
        sources,
        maxOutputTokens: outputBudgetFor(settings.maxLength),
      } satisfies StreamRequest);
    } catch {
      requestIdRef.current = null;
      setStreaming(false);
      markAssistantError('The extension connection was lost. Reload the panel and try again.');
      return;
    }

    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      try {
        port.postMessage({ channel: 'sr_stream', type: 'stop', requestId } satisfies StreamRequest);
      } catch { /* noop */ }
      requestIdRef.current = null;
      setStreaming(false);
      markAssistantError('The request timed out after 60 seconds. Try again or switch models in Settings.');
    }, REQUEST_TIMEOUT_MS);
  }, [
    clearTimer,
    fetchVaultItems,
    getPort,
    input,
    markAssistantError,
    messages,
    pageContext,
    streaming,
    tabContext,
    vaultItems,
    vaultLoaded,
  ]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const suggestions = [t('chat.suggestion1'), t('chat.suggestion2'), t('chat.suggestion3')];
  const vaultIsEmpty = vaultLoaded && vaultItems.length === 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-white shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{t('chat.emptyTitle')}</h2>
          <p className="text-xs text-gray-600 truncate">{t('chat.subtitle')}</p>
        </div>
        <button
          className="shrink-0 text-xs px-2.5 py-1.5 min-h-[32px] rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          onClick={newChat}
        >
          {t('chat.new')}
        </button>
      </div>

      {(notice || vaultIsEmpty) && (
        <div className="px-3 py-2 text-xs text-amber-900 bg-amber-50 border-b border-amber-200" role="status">
          {notice || t('chat.noVault')}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3" role="log" aria-live="polite">
        {messages.length === 0 && (
          <section className="rounded-md border border-gray-300 bg-white p-3">
            <h3 className="text-sm font-semibold">{t('chat.emptyTitle')}</h3>
            <p className="mt-1 text-xs text-gray-600">{t('chat.emptyBody')}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {suggestions.map(suggestion => (
                <button
                  key={suggestion}
                  className="text-left text-xs px-2.5 py-2 rounded border border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
        )}

        {messages.map(message => (
          <ChatBubble key={message.id} message={message} />
        ))}
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
        <label className="sr-only" htmlFor="sr-chat-input">{t('chat.placeholder')}</label>
        <textarea
          id="sr-chat-input"
          className="w-full box-border text-sm text-gray-800 border border-gray-400 rounded px-2 py-2 leading-relaxed resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          rows={2}
          value={input}
          placeholder={t('chat.placeholder')}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-xs text-gray-600 flex-1">{t('chat.footer')}</p>
          {streaming ? (
            <button
              className="text-xs px-3 py-2 min-h-[36px] rounded bg-red-50 text-red-800 border border-red-300 hover:bg-red-100"
              onClick={stop}
            >
              {t('chat.stop')}
            </button>
          ) : (
            <button
              className="text-xs px-3 py-2 min-h-[36px] rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600"
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              {t('chat.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const showThinking = message.pending && !message.text;
  const usage = message.usage;
  const hasUsage = usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const canCopy = !isUser && !message.pending && Boolean(message.text.trim());

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard access can be denied; leave the label unchanged. */
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-md px-2.5 py-2 border ${isUser ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-900 border-gray-200'}`}>
        <p className={`text-xs font-semibold ${isUser ? 'text-blue-100' : 'text-gray-600'}`}>
          {isUser ? t('chat.you') : t('chat.assistant')}
        </p>
        {showThinking ? (
          <p className={`mt-1 text-sm ${isUser ? 'text-white' : 'text-gray-600'}`}>
            {t('chat.thinking')}
          </p>
        ) : (
          <p className={`mt-1 text-sm whitespace-pre-wrap leading-relaxed ${isUser ? 'text-white' : 'text-gray-900'}`}>
            {message.text}
          </p>
        )}
        {canCopy && (
          <button
            className={`mt-1 text-xs font-medium underline underline-offset-2 ${isUser ? 'text-blue-100' : 'text-blue-700 hover:text-blue-800'}`}
            onClick={() => void copy()}
          >
            {copied ? t('action.copied') : t('action.copy')}
          </button>
        )}
        {message.stopped && (
          <p className={`mt-1 text-xs ${isUser ? 'text-blue-100' : 'text-gray-500'}`}>{t('chat.stopped')}</p>
        )}
        {message.error && (
          <p className={`mt-1.5 text-xs rounded px-2 py-1 ${isUser ? 'bg-red-700 text-white' : 'bg-red-50 text-red-800 border border-red-200'}`} role="alert">
            {message.error}
          </p>
        )}
        {message.sources.length > 0 && (
          <>
            <p className={`mt-1.5 text-xs truncate ${isUser ? 'text-blue-100' : 'text-gray-600'}`} title={message.sources.map(source => source.title).join(', ')}>
              {t('chat.sources')}: {message.sources.map(source => source.title).join(', ')}
            </p>
            {!isUser && message.sources.some(source => source.excerpt) && (
              <details className="mt-1 text-xs text-gray-700">
                <summary className="cursor-pointer font-medium">View supporting passages</summary>
                <div className="mt-1 space-y-2">
                  {message.sources.filter(source => source.excerpt).map(source => (
                    <div key={`${source.id}:${source.title}`}>
                      <p className="font-medium">{source.title}</p>
                      <blockquote className="mt-0.5 border-l-2 border-gray-300 pl-2 whitespace-pre-wrap">
                        {source.excerpt}
                      </blockquote>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        {hasUsage && (
          <p className={`mt-0.5 text-xs ${isUser ? 'text-blue-100' : 'text-gray-600'}`}>
            {usage.estimated ? '~' : ''}{formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
            {usage.costUsd !== undefined ? ` · Est. ${formatCost(usage.costUsd)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
