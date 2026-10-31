import type {
  BackgroundRequest,
  BackgroundResponse,
  StreamRequest,
  StreamEvent,
  TestApiKeyRequest,
  TestApiKeyResult,
  ListModelsRequest,
  ModelListResponse,
  ModelOption,
  GetVaultItemsRequest,
  GetSimilarAnswersRequest,
  SimilarAnswersResponse,
  RecordAnswerRequest,
  RecordAnswerResponse,
  SaveVaultItemRequest,
  SaveVaultItemResponse,
  GetHistoryRequest,
  DeleteHistoryRequest,
  HistoryResponse,
  DeleteHistoryResponse,
  ExportHistoryRequest,
  ExportHistoryResponse,
  EnableSiteRequest,
  DisableSiteRequest,
  SiteToggledResponse,
} from '../lib/messaging';
import { extractNeedsInputFlags } from '../lib/promptBuilder';
import { getProviderConfig } from '../lib/provider';
import { getAllItems, addItem } from '../lib/vault';
import { getActiveVaultProfileId } from '../lib/vaultProfile';
import { findSimilarAnswers, addHistoryAnswer, getAllHistoryAnswers, deleteHistoryAnswer } from '../lib/history';
import { buildUsage, clampHistoryLimit, noUsage } from '../lib/usage';
import type { AnswerSource } from '../lib/messaging';

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'anthropic/claude-3.5-sonnet',
  provider: 'openrouter',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
});

chrome.commands.onCommand.addListener(command => {
  void handleCommand(command);
});

async function handleCommand(command: string): Promise<void> {
  switch (command) {
    case 'toggle-panel': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      return;
    }
    case 'scan-page':
    case 'answer-focused':
    case 'insert-last': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      const msg =
        command === 'scan-page' ? { type: 'scan_page' } :
        command === 'answer-focused' ? { type: 'answer_focused_field' } :
        { type: 'insert_last_draft' };
      await chrome.tabs.sendMessage(tab.id, msg as any, { frameId: 0 }).catch(() => { });
      return;
    }
    default:
      return;
  }
}

chrome.runtime.onMessage.addListener((
  request: BackgroundRequest,
  sender,
  sendResponse: (response: unknown) => void
) => {
  switch (request.type) {
    case 'test_api_key':
      handleTestApiKey(request, sendResponse);
      return true;
    case 'list_models':
      handleListModels(request, sendResponse);
      return true;
    case 'get_vault_items':
      handleGetVaultItems(request, sendResponse);
      return true;
    case 'get_similar_answers':
      handleGetSimilarAnswers(request, sendResponse);
      return true;
    case 'record_answer':
      handleRecordAnswer(request, sendResponse);
      return true;
    case 'save_vault_item':
      handleSaveVaultItem(request, sendResponse);
      return true;
    case 'get_history':
      handleGetHistory(sendResponse);
      return true;
    case 'delete_history_answer':
      handleDeleteHistory(request, sendResponse);
      return true;
    case 'export_history_csv':
      handleExportHistory(sendResponse);
      return true;
    case 'enable_site':
      handleEnableSite(request, sendResponse);
      return true;
    case 'disable_site':
      handleDisableSite(request, sender.tab?.id, sendResponse);
      return true;
  }
  return false;
});

async function handleTestApiKey(
  request: TestApiKeyRequest,
  sendResponse: (response: TestApiKeyResult) => void
): Promise<void> {
  try {
    const config = getProviderConfig(request.provider);
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: config.buildHeaders(request.apiKey),
      body: JSON.stringify(config.buildBody({
        model: request.model,
        maxTokens: 10,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
      })),
    });

    if (response.ok) {
      sendResponse({ type: 'test_api_key_result', requestId: request.requestId, success: true, message: 'API key works!' });
    } else if (response.status === 401 || response.status === 403) {
      sendResponse({ type: 'test_api_key_result', requestId: request.requestId, success: false, message: `Invalid API key (${response.status}). Check your key in settings.` });
    } else if (response.status === 429) {
      sendResponse({ type: 'test_api_key_result', requestId: request.requestId, success: false, message: 'Rate limited (429). Try again later.' });
    } else {
      const body = await response.text().catch(() => '');
      sendResponse({ type: 'test_api_key_result', requestId: request.requestId, success: false, message: `API error (${response.status}): ${body.substring(0, 200)}` });
    }
  } catch (err) {
    sendResponse({
      type: 'test_api_key_result',
      requestId: request.requestId,
      success: false,
      message: `Network error: ${(err as Error).message}`,
    });
  }
}

const modelCache = new Map<string, { at: number; models: ModelOption[] }>();
const MODEL_CACHE_MS = 10 * 60 * 1000;

function normalizeModels(models: Array<{ id?: unknown; name?: unknown; display_name?: unknown }>): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const model of models) {
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = [model.name, model.display_name].find(value => typeof value === 'string' && value.trim()) as string | undefined;
    result.push({ id, name: name?.trim() });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function handleListModels(
  request: ListModelsRequest,
  sendResponse: (response: ModelListResponse) => void
): Promise<void> {
  const provider = request.provider === 'anthropic' ? 'anthropic' : 'openrouter';
  const apiKey = (request.apiKey ?? '').trim();
  const cacheKey = provider === 'openrouter' ? 'openrouter:public' : `anthropic:${apiKey ? 'auth' : 'anon'}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) {
    sendResponse({ type: 'model_list', provider, models: cached.models });
    return;
  }

  if (provider === 'anthropic' && !apiKey) {
    sendResponse({
      type: 'model_list',
      provider,
      models: [],
      error: 'Enter an API key to load Anthropic models.',
    });
    return;
  }

  try {
    let models: ModelOption[] = [];
    if (provider === 'openrouter') {
      // The catalog endpoint is public; do not attach the user's key so a key
      // meant for a different provider cannot break model discovery.
      const response = await fetch('https://openrouter.ai/api/v1/models');
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'OpenRouter rejected the API key.'
          : `OpenRouter returned ${response.status}.`);
      }
      const body = await response.json() as { data?: Array<{ id?: string; name?: string }> };
      models = normalizeModels(body.data ?? []);
    } else {
      const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Anthropic rejected the API key.'
          : `Anthropic returned ${response.status}.`);
      }
      const body = await response.json() as { data?: Array<{ id?: string; display_name?: string }> };
      models = normalizeModels(body.data ?? []);
    }

    if (models.length > 0) modelCache.set(cacheKey, { at: Date.now(), models });
    sendResponse({ type: 'model_list', provider, models });
  } catch (err) {
    sendResponse({
      type: 'model_list',
      provider,
      models: [],
      error: (err as Error)?.message ?? 'Could not load the model list.',
    });
  }
}

async function handleGetVaultItems(
  request: GetVaultItemsRequest,
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    const profileId = request.vaultProfileId ?? await getActiveVaultProfileId();
    const items = await getAllItems(profileId);
    sendResponse({ type: 'vault_items', items, profileId });
  } catch (err) {
    console.warn('[Applyra] Failed to read vault:', err);
    sendResponse({ type: 'vault_items', items: [], error: (err as Error)?.message ?? 'Unknown error' });
  }
}

async function handleGetSimilarAnswers(
  request: GetSimilarAnswersRequest,
  sendResponse: (response: SimilarAnswersResponse) => void
): Promise<void> {
  try {
    const items = await findSimilarAnswers(request.question, 3, clampHistoryLimit(request.limit ?? 3));
    sendResponse({ type: 'similar_answers', items });
  } catch (err) {
    console.warn('[Applyra] Failed to read history:', err);
    sendResponse({ type: 'similar_answers', items: [] });
  }
}

async function handleRecordAnswer(
  request: RecordAnswerRequest,
  sendResponse: (response: RecordAnswerResponse) => void
): Promise<void> {
  try {
    const id = await addHistoryAnswer(request.question, request.answer, request.sourceIds, request.company);
    sendResponse({ type: 'answer_recorded', id });
  } catch (err) {
    console.warn('[Applyra] Failed to record answer:', err);
    sendResponse({ type: 'answer_recorded', id: 0 });
  }
}

async function handleSaveVaultItem(
  request: SaveVaultItemRequest,
  sendResponse: (response: SaveVaultItemResponse) => void
): Promise<void> {
  try {
    const profileId = request.vaultProfileId ?? await getActiveVaultProfileId();
    const id = await addItem({
      type: request.itemType,
      title: request.title,
      content: request.content,
      vaultProfileId: profileId,
    });
    sendResponse({ type: 'vault_item_saved', id });
  } catch (err) {
    console.warn('[Applyra] Failed to save vault item:', err);
    sendResponse({ type: 'vault_item_saved', id: 0 });
  }
}

async function handleGetHistory(
  sendResponse: (response: HistoryResponse) => void
): Promise<void> {
  try {
    const items = await getAllHistoryAnswers();
    items.sort((a, b) => b.createdAt - a.createdAt);
    sendResponse({ type: 'history_items', items });
  } catch (err) {
    console.warn('[Applyra] Failed to read history:', err);
    sendResponse({ type: 'history_items', items: [] });
  }
}

async function handleDeleteHistory(
  request: DeleteHistoryRequest,
  sendResponse: (response: DeleteHistoryResponse) => void
): Promise<void> {
  try {
    const deleted = await deleteHistoryAnswer(request.id);
    sendResponse({ type: 'history_deleted', id: request.id, deleted });
  } catch (err) {
    console.warn('[Applyra] Failed to delete history answer:', err);
    sendResponse({ type: 'history_deleted', id: request.id, deleted: false });
  }
}

async function handleExportHistory(
  sendResponse: (response: ExportHistoryResponse) => void
): Promise<void> {
  try {
    const items = await getAllHistoryAnswers();
    items.sort((a, b) => b.createdAt - a.createdAt);
    const csv = toHistoryCsv(items);
    sendResponse({ type: 'history_csv', csv, count: items.length });
  } catch (err) {
    console.warn('[Applyra] Failed to export history:', err);
    sendResponse({ type: 'history_csv', csv: '', count: 0 });
  }
}

function toHistoryCsv(items: Awaited<ReturnType<typeof getAllHistoryAnswers>>): string {
  const header = ['company', 'question', 'answer', 'date'];
  const rows = items.map(item => [
    item.company ?? '',
    item.question,
    item.answer,
    new Date(item.createdAt).toISOString(),
  ].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\r\n');
}

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

/* ------------------------- Runtime site permissions ------------------------- */

const SITE_SCRIPT_PREFIX = 'sr-site-';

function normalizeOrigin(origin: string): string {
  try {
    const raw = origin.includes('://') ? origin : `https://${origin}`;
    const url = new URL(raw);
    if (url.protocol === 'file:') return 'file:///*';
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      // Match patterns do not support ports.
      return `${url.protocol}//${url.hostname}/*`;
    }
  } catch {
    /* fall through */
  }

  const trimmed = origin.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/*') ? trimmed : `${trimmed}/*`;
}

function siteScriptId(origin: string): string {
  let hash = 2166136261;
  for (let i = 0; i < origin.length; i++) {
    hash ^= origin.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${SITE_SCRIPT_PREFIX}${(hash >>> 0).toString(36)}`;
}

function contentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.[0]?.js ?? [];
}

async function contentScriptAlive(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'sr_ping' }, { frameId: 0 });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function waitForContentScript(tabId: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await contentScriptAlive(tabId)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function handleEnableSite(
  request: EnableSiteRequest,
  sendResponse: (response: SiteToggledResponse) => void
): Promise<void> {
  const pattern = normalizeOrigin(request.origin);
  try {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) {
      sendResponse({ type: 'site_toggled', enabled: false, error: 'Permission was not granted for this site.' });
      return;
    }

    const files = contentScriptFiles();
    if (files.length === 0) {
      sendResponse({ type: 'site_toggled', enabled: false, error: 'Content script bundle is missing. Rebuild the extension.' });
      return;
    }

    const id = siteScriptId(pattern);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
    }

    await chrome.scripting.registerContentScripts([{
      id,
      matches: [pattern],
      js: files,
      allFrames: true,
      runAt: 'document_end',
      persistAcrossSessions: true,
    }]);

    if (await contentScriptAlive(request.tabId)) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: request.tabId }).catch(() => null);
      if (frames && frames.length > 0) {
        await Promise.all(frames.map(frame =>
          chrome.tabs.sendMessage(request.tabId, { type: 'reinit' } as any, { frameId: frame.frameId }).catch(() => {})
        ));
      }
    } else {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: request.tabId, allFrames: true },
          files,
        });
      } catch (injectErr) {
        // Cross-origin frames without permission are skipped; the top frame still loads.
        console.warn('[Applyra] Immediate injection partially failed:', injectErr);
      }
      // The loader imports its chunks asynchronously, so executeScript can
      // resolve before the message listener is ready. Wait for the first
      // successful ping so the panel does not show "Enable" again.
      await waitForContentScript(request.tabId);
    }

    sendResponse({ type: 'site_toggled', enabled: true });
  } catch (err) {
    console.warn('[Applyra] Failed to enable site:', err);
    sendResponse({ type: 'site_toggled', enabled: false, error: (err as Error).message });
  }
}

async function handleDisableSite(
  request: DisableSiteRequest,
  senderTabId: number | undefined,
  sendResponse: (response: SiteToggledResponse) => void
): Promise<void> {
  const pattern = normalizeOrigin(request.origin);
  const id = siteScriptId(pattern);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
    const tabId = request.tabId ?? senderTabId;
    if (tabId !== undefined) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
      if (frames && frames.length > 0) {
        await Promise.all(frames.map(frame =>
          chrome.tabs.sendMessage(tabId, { type: 'teardown' } as any, { frameId: frame.frameId }).catch(() => {})
        ));
      } else {
        await chrome.tabs.sendMessage(tabId, { type: 'teardown' } as any, { frameId: 0 }).catch(() => {});
      }
    }
    await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
    sendResponse({ type: 'site_toggled', enabled: false });
  } catch (err) {
    console.warn('[Applyra] Failed to disable site:', err);
    sendResponse({ type: 'site_toggled', enabled: false, error: (err as Error).message });
  }
}

/* ------------------------- Streaming ------------------------- */

const controllers = new Map<string, AbortController>();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'sr_stream') return;

  port.onDisconnect.addListener(() => {
    for (const [requestId, controller] of controllers) {
      if (!controller.signal.aborted) {
        controller.abort();
        controllers.delete(requestId);
      }
    }
  });

  port.onMessage.addListener((message: StreamRequest) => {
    if (message.type === 'start') {
      const controller = new AbortController();
      controllers.set(message.requestId, controller);
      streamAnswer(port, message, controller).finally(() => controllers.delete(message.requestId));
    } else if (message.type === 'stop') {
      controllers.get(message.requestId)?.abort();
      controllers.delete(message.requestId);
    }
  });
});

async function streamAnswer(
  port: chrome.runtime.Port,
  request: Extract<StreamRequest, { type: 'start' }>,
  controller: AbortController
): Promise<void> {
  const post = (event: StreamEvent) => {
    try {
      port.postMessage(event);
    } catch { }
  };

  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

    if (!settings.apiKey) {
      post({ channel: 'sr_stream', type: 'error', requestId: request.requestId, error: 'No API key configured. Open settings to add one.', code: 'bad_key', usage: noUsage() });
      return;
    }

    const maxOutputTokens = Math.min(2048, Math.max(64, request.maxOutputTokens ?? 900));
    const config = getProviderConfig(settings.provider);
    const requestBody = config.buildBody({
      model: settings.model,
      maxTokens: maxOutputTokens,
      stream: true,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.prompt }],
    }) as Record<string, unknown>;
    if (settings.provider === 'openrouter') {
      requestBody.stream_options = { include_usage: true };
    }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: config.buildHeaders(settings.apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const code = response.status === 401 || response.status === 403 ? 'bad_key' : response.status === 429 ? 'rate_limit' : 'api_error';
      const usage = buildUsage({
        systemPrompt: request.systemPrompt,
        prompt: request.prompt,
        answer: '',
        providerOutput: 0,
        model: settings.model,
      });
      post({ channel: 'sr_stream', type: 'error', requestId: request.requestId, error: `API error (${response.status}): ${body.substring(0, 300)}`, code, usage });
      return;
    }

    if (!response.body) {
      post({ channel: 'sr_stream', type: 'error', requestId: request.requestId, error: 'API returned no response body.', code: 'api_error', usage: noUsage() });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let streamError: string | null = null;
    let providerInput: number | undefined;
    let providerOutput: number | undefined;

    const captureUsage = (parsed: any) => {
      const usage = parsed?.usage ?? parsed?.message?.usage;
      if (!usage) return;
      const input = usage.input_tokens ?? usage.prompt_tokens;
      const output = usage.output_tokens ?? usage.completion_tokens;
      if (typeof input === 'number' && input > 0) providerInput = input;
      if (typeof output === 'number' && output >= 0) providerOutput = output;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.substring(5).trim();
        if (!data || data === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        captureUsage(parsed);

        const text = config.extractTextDelta(parsed);
        if (text) {
          fullText += text;
          post({ channel: 'sr_stream', type: 'chunk', requestId: request.requestId, text });
        }

        const err = config.extractError(parsed);
        if (err) {
          streamError = err;
          break;
        }
      }
      if (streamError) break;
    }

    if (controller.signal.aborted) return;

    if (streamError) throw new Error(streamError);

    const finalAnswer = fullText.trim();
    const untraceableClaims = extractNeedsInputFlags(finalAnswer);
    const sources = sanitizeSources(request.sources);
    const usage = buildUsage({
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      answer: finalAnswer,
      providerInput,
      providerOutput,
      model: settings.model,
    });

    post({
      channel: 'sr_stream',
      type: 'done',
      requestId: request.requestId,
      answer: finalAnswer,
      sources,
      untraceableClaims,
      usage,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    const name = (err as Error)?.name;
    if (name === 'AbortError') return;
    post({
      channel: 'sr_stream',
      type: 'error',
      requestId: request.requestId,
      error: `Network error: ${(err as Error).message}`,
      code: 'network',
      usage: buildUsage({
        systemPrompt: request.systemPrompt,
        prompt: request.prompt,
        answer: '',
        providerOutput: 0,
        model: (await chrome.storage.local.get(DEFAULT_SETTINGS)).model,
      }),
    });
  }
}

function sanitizeSources(sources: AnswerSource[]): AnswerSource[] {
  return (sources ?? []).filter(s => s && typeof s.id === 'number' && typeof s.title === 'string');
}