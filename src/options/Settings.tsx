import { useState, useEffect, useSyncExternalStore } from 'react';
import type { RetrievalMode } from '../lib/retrieval';
import { clampContextBudget, clampHistoryLimit } from '../lib/usage';
import { TONES, LANGUAGES, UI_LANGUAGES } from '../lib/options';
import type { ModelOption } from '../lib/messaging';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';
import { getProviderConfig, isChatModel } from '../lib/provider';

interface SettingsData {
  apiKey: string;
  provider: string;
  model: string;
  tone: string;
  maxLength: number;
  language: string;
  uiLanguage: string;
  retrievalMode: RetrievalMode;
  vaultContextBudget: number;
  historyContextLimit: number;
}

const DEFAULTS: SettingsData = {
  apiKey: '',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-5.5',
  tone: 'professional',
  maxLength: 500,
  language: 'en',
  uiLanguage: 'en',
  retrievalMode: 'keyword',
  vaultContextBudget: 6000,
  historyContextLimit: 3,
};

interface ProviderInfo {
  label: string;
  keyHint: string;
  keyPlaceholder: string;
  modelPlaceholder: string;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  openrouter: {
    label: 'OpenRouter',
    keyHint: 'Get a key at https://openrouter.ai/keys. You can use any model listed there.',
    keyPlaceholder: 'sk-or-v1-...',
    modelPlaceholder: 'anthropic/claude-sonnet-5.5',
  },
  anthropic: {
    label: 'Anthropic',
    keyHint: 'Get a key at https://console.anthropic.com.',
    keyPlaceholder: 'sk-ant-...',
    modelPlaceholder: 'claude-sonnet-5-5',
  },
  openai: {
    label: 'OpenAI',
    keyHint: 'Get a key at https://platform.openai.com/api-keys.',
    keyPlaceholder: 'sk-...',
    modelPlaceholder: 'gpt-4o-mini',
  },
  grok: {
    label: 'Grok (xAI)',
    keyHint: 'Get a key at https://console.x.ai/.',
    keyPlaceholder: 'xai-...',
    modelPlaceholder: 'grok-4',
  },
  groq: {
    label: 'Groq',
    keyHint: 'Get a key at https://console.groq.com/keys.',
    keyPlaceholder: 'gsk_...',
    modelPlaceholder: 'llama-3.3-70b-versatile',
  },
};

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-haiku-5.5',
    'anthropic/claude-opus-5.5',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'x-ai/grok-4.7',
    'google/gemini-3.8-flash',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  anthropic: [
    'claude-sonnet-5-5',
    'claude-sonnet-4-7',
    'claude-haiku-5-5',
    'claude-opus-4-5',
    'claude-haiku-4-7',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o3-mini',
    'o1-mini',
  ],
  grok: [
    'grok-4',
    'grok-4-fast-reasoning',
    'grok-4-fast-non-reasoning',
    'grok-3',
    'grok-3-mini',
    'grok-2-latest',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'deepseek-r1-distill-llama-70b',
    'qwen/qwen3-32b',
  ],
};

async function loadSettings(): Promise<SettingsData> {
  const result = await chrome.storage.local.get(DEFAULTS) as SettingsData;
  return {
    ...result,
    vaultContextBudget: clampContextBudget(result.vaultContextBudget),
    historyContextLimit: clampHistoryLimit(result.historyContextLimit),
  };
}

async function saveSettings(data: SettingsData): Promise<void> {
  await chrome.storage.local.set({
    ...data,
    vaultContextBudget: clampContextBudget(data.vaultContextBudget),
    historyContextLimit: clampHistoryLimit(data.historyContextLimit),
  });
}

async function fetchProviderModels(provider: string, apiKey: string): Promise<ModelOption[]> {
  const config = getProviderConfig(provider);
  if (config.modelsRequireKey && !apiKey.trim()) {
    throw new Error(`Enter an API key to load ${config.label} models.`);
  }
  const response = await fetch(config.modelsUrl, {
    headers: config.buildModelsHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? `${config.label} rejected the API key.`
      : `${config.label} returned ${response.status}.`);
  }
  const body = await response.json() as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>;
  };
  return (body.data ?? [])
    .filter(model => typeof model.id === 'string' && model.id.trim())
    .filter(model => isChatModel(provider, model.id!.trim()))
    .map(model => ({
      id: model.id!.trim(),
      name: (model.name ?? model.display_name)?.trim(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function Settings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [apiTesting, setApiTesting] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [activeModelIndex, setActiveModelIndex] = useState(0);
  const [modelsRefresh, setModelsRefresh] = useState(0);

  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s);
      setLoading(false);
      setDirty(false);
    });
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    const fallback: ModelOption[] = (MODEL_SUGGESTIONS[settings.provider] ?? []).map(id => ({ id }));
    setModelsLoading(true);
    setModelsError(null);

    const timer = window.setTimeout(async () => {
      let fetched: ModelOption[] = [];
      let loadError: string | null = null;

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'list_models',
          provider: settings.provider,
          apiKey: settings.apiKey.trim() || undefined,
        });
        if (response?.type === 'model_list') {
          fetched = Array.isArray(response.models) ? response.models : [];
          loadError = response.error ?? null;
        } else {
          loadError = 'The background worker did not return a model list.';
        }
      } catch (e) {
        loadError = (e as Error).message;
      }

      if (!cancelled && fetched.length === 0) {
        try {
          const direct = await fetchProviderModels(settings.provider, settings.apiKey);
          if (direct.length > 0) {
            fetched = direct;
            loadError = null;
          } else if (!loadError) {
            loadError = 'The provider returned no models.';
          }
        } catch (e) {
          loadError = loadError ?? (e as Error).message;
        }
      }

      if (cancelled) return;
      const merged = [...fetched];
      for (const item of fallback) {
        if (!merged.some(model => model.id === item.id)) merged.push(item);
      }
      merged.sort((a, b) => a.id.localeCompare(b.id));
      setModelOptions(merged);
      setModelsError(loadError);
      setModelsLoading(false);
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settings.provider, settings.apiKey, modelsRefresh]);

  const modelQuery = settings.model.trim().toLowerCase();
  const filteredModels = modelOptions
    .filter(model => {
      if (!modelQuery) return true;
      return model.id.toLowerCase().includes(modelQuery) ||
        (model.name ?? '').toLowerCase().includes(modelQuery);
    })
    .sort((a, b) => {
      const aStarts = a.id.toLowerCase().startsWith(modelQuery) ? 0 : 1;
      const bStarts = b.id.toLowerCase().startsWith(modelQuery) ? 0 : 1;
      return aStarts - bStarts || a.id.localeCompare(b.id);
    })
    .slice(0, 60);

  function chooseModel(id: string): void {
    update('model', id);
    setModelOpen(false);
    setActiveModelIndex(0);
  }

  function handleModelKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setModelOpen(true);
      setActiveModelIndex(index => filteredModels.length === 0 ? 0 : Math.min(filteredModels.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveModelIndex(index => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      if (modelOpen && filteredModels[activeModelIndex]) {
        event.preventDefault();
        chooseModel(filteredModels[activeModelIndex].id);
      }
    } else if (event.key === 'Escape') {
      setModelOpen(false);
    }
  }

  function update<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSavedMessage(false);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings(settings);
      setDirty(false);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2000);
    } catch (e) {
      setSaveError(`Failed to save settings: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestApiKey() {
    if (!settings.apiKey.trim()) {
      setApiTestResult({ success: false, message: 'Enter an API key first.' });
      return;
    }
    if (!settings.model.trim()) {
      setApiTestResult({ success: false, message: 'Enter a model first.' });
      return;
    }
    setApiTesting(true);
    setApiTestResult(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'test_api_key',
        requestId: crypto.randomUUID(),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        provider: settings.provider,
      });
      setApiTestResult({
        success: response.success,
        message: response.message,
      });
    } catch (e) {
      setApiTestResult({ success: false, message: `Error: ${(e as Error).message}` });
    } finally {
      setApiTesting(false);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-600 py-8">{t('settings.loading')}</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
        {dirty && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" role="status">
            {t('settings.unsaved')}
          </span>
        )}
      </div>

      {savedMessage && (
        <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-2 rounded mb-4" role="status">{t('settings.savedMessage')}</div>
      )}

      {saveError && (
        <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded mb-4" role="alert">{saveError}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.uiLanguage')}</label>
          <select
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={settings.uiLanguage}
            onChange={e => update('uiLanguage', e.target.value)}
          >
            {UI_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <p className="text-xs text-gray-600 mt-1">{t('settings.uiLanguageHelp')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.provider')}</label>
          <select
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={settings.provider}
            onChange={e => {
              const provider = e.target.value;
              update('provider', provider);
              update('model', MODEL_SUGGESTIONS[provider]?.[0] ?? '');
            }}
          >
            {Object.entries(PROVIDER_INFO).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-600 mt-1">
            {(PROVIDER_INFO[settings.provider] ?? PROVIDER_INFO.openrouter).keyHint}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="sr-api-key" className="block text-sm font-medium text-gray-700">{t('settings.apiKey')}</label>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                onClick={() => setShowKey(value => !value)}
              >
                {showKey ? t('settings.hide') : t('settings.show')}
              </button>
              {settings.apiKey && (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                  onClick={() => update('apiKey', '')}
                >
                  {t('settings.clear')}
                </button>
              )}
            </div>
          </div>
          <input
            id="sr-api-key"
            type={showKey ? 'text' : 'password'}
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm font-mono"
            placeholder={(PROVIDER_INFO[settings.provider] ?? PROVIDER_INFO.openrouter).keyPlaceholder}
            value={settings.apiKey}
            onChange={e => update('apiKey', e.target.value)}
          />
          <p className="text-xs text-gray-600 mt-1">
            {t('settings.apiKeyNote')}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="sr-model" className="block text-sm font-medium text-gray-700">{t('settings.model')}</label>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
              onClick={() => { setModelOptions([]); setModelsRefresh(value => value + 1); }}
              disabled={modelsLoading}
            >
              {t('settings.refreshModels')}
            </button>
          </div>
          <div className="relative">
            <input
              id="sr-model"
              role="combobox"
              aria-expanded={modelOpen}
              aria-controls="sr-model-listbox"
              aria-autocomplete="list"
              aria-activedescendant={modelOpen && filteredModels[activeModelIndex] ? `sr-model-option-${activeModelIndex}` : undefined}
              autoComplete="off"
              className="w-full border border-gray-400 rounded px-3 py-2 text-sm font-mono"
              placeholder={(PROVIDER_INFO[settings.provider] ?? PROVIDER_INFO.openrouter).modelPlaceholder}
              value={settings.model}
              onFocus={() => setModelOpen(true)}
              onChange={e => {
                update('model', e.target.value);
                setActiveModelIndex(0);
                setModelOpen(true);
              }}
              onKeyDown={handleModelKeyDown}
              onBlur={() => window.setTimeout(() => setModelOpen(false), 120)}
            />
            {modelOpen && (
              <ul
                id="sr-model-listbox"
                role="listbox"
                aria-label={t('settings.model')}
                className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded border border-gray-300 bg-white shadow-lg"
              >
                {filteredModels.map((model, index) => (
                  <li
                    key={model.id}
                    id={`sr-model-option-${index}`}
                    role="option"
                    aria-selected={index === activeModelIndex}
                    className={`cursor-pointer px-3 py-2 text-sm ${index === activeModelIndex ? 'bg-blue-100 text-blue-900' : 'text-gray-800 hover:bg-gray-100'}`}
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setActiveModelIndex(index)}
                    onClick={() => chooseModel(model.id)}
                  >
                    <span className="block font-mono text-xs">{model.id}</span>
                    {model.name && model.name !== model.id && (
                      <span className="block text-xs text-gray-600">{model.name}</span>
                    )}
                  </li>
                ))}
                {filteredModels.length === 0 && (
                  <li className="px-3 py-2 text-xs text-gray-600" role="presentation">
                    {t('settings.noModelMatches')}
                  </li>
                )}
              </ul>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-1">{t('settings.modelHelp')}</p>
          {modelsLoading && <p className="text-xs text-gray-600 mt-1" role="status">{t('settings.modelsLoading')}</p>}
          {!modelsLoading && modelOptions.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">{t('settings.modelsCount').replace('{count}', String(modelOptions.length))}</p>
          )}
          {!modelsLoading && modelsError && <p className="text-xs text-amber-800 mt-1">{modelsError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.tone')}</label>
          <select
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={settings.tone}
            onChange={e => update('tone', e.target.value)}
          >
            {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.maxLength')}</label>
            <input
              type="number"
              className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
              min={50}
              max={2000}
              step={50}
              value={settings.maxLength}
              onChange={e => update('maxLength', parseInt(e.target.value) || 500)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.language')}</label>
            <select
              className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
              value={settings.language}
              onChange={e => update('language', e.target.value)}
            >
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.retrieval')}</label>
          <select
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={settings.retrievalMode}
            onChange={e => update('retrievalMode', e.target.value as RetrievalMode)}
          >
            <option value="keyword">Keyword scoring (fast, default)</option>
            <option value="tfidf">TF-IDF similarity</option>
            <option value="embeddings">Local embeddings (experimental)</option>
          </select>
          <p className="text-xs text-gray-600 mt-1">
            All retrieval runs locally. Embeddings use a dependency-free hashed vector model; no network calls or model downloads.
          </p>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="sr-context-budget" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.contextBudget')}</label>
            <input
              id="sr-context-budget"
              type="number"
              className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
              min={1000}
              max={12000}
              step={500}
              value={settings.vaultContextBudget}
              onChange={e => update('vaultContextBudget', parseInt(e.target.value) || 0)}
              onBlur={() => update('vaultContextBudget', clampContextBudget(settings.vaultContextBudget))}
            />
            <p className="text-xs text-gray-600 mt-1">1,000 to 12,000. Defaults to 6,000. Lower means less cost and faster requests.</p>
          </div>
          <div className="flex-1">
            <label htmlFor="sr-history-limit" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.historyLimit')}</label>
            <input
              id="sr-history-limit"
              type="number"
              className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
              min={0}
              max={10}
              step={1}
              value={settings.historyContextLimit}
              onChange={e => update('historyContextLimit', parseInt(e.target.value) || 0)}
              onBlur={() => update('historyContextLimit', clampHistoryLimit(settings.historyContextLimit))}
            />
            <p className="text-xs text-gray-600 mt-1">0 to 10. Defaults to 3, capped by a 1,200-token history budget.</p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          className={`px-6 py-2 text-sm rounded text-white ${saving ? 'bg-blue-400' : dirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400'}`}
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : dirty ? t('settings.save') : t('settings.savedButton')}
        </button>

        <button
          className={`px-4 py-2 text-sm rounded ${apiTesting ? 'bg-gray-300 text-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          disabled={apiTesting}
          onClick={handleTestApiKey}
        >
          {apiTesting ? t('settings.testing') : t('settings.testKey')}
        </button>
      </div>

      {apiTestResult && (
        <div className={`mt-3 px-4 py-3 rounded text-sm ${apiTestResult.success ? 'bg-green-100 border border-green-400 text-green-700' : 'bg-red-100 border border-red-400 text-red-700'}`}>
          {apiTestResult.message}
        </div>
      )}
    </div>
  );
}

export default Settings;