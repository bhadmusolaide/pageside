import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VaultManager } from './VaultManager';
import { Settings } from './Settings';
import { Profiles } from './Profiles';
import { History } from './History';
import type { OptionsTab } from '../lib/messaging';
import { ThemeToggle } from '../components/ThemeToggle';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';

type Tab = OptionsTab;

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: 'vault', labelKey: 'tabs.vault' },
  { id: 'profiles', labelKey: 'tabs.profiles' },
  { id: 'history', labelKey: 'tabs.history' },
  { id: 'settings', labelKey: 'tabs.settings' },
];

function isOptionsTab(value: unknown): value is Tab {
  return value === 'vault' || value === 'profiles' || value === 'history' || value === 'settings';
}

function tabFromHash(): Tab | null {
  const value = window.location.hash.replace(/^#/, '');
  return isOptionsTab(value) ? value : null;
}

export function App() {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [activeTab, setActiveTab] = useState<Tab>('vault');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const applyValue = (value: unknown) => {
      if (isOptionsTab(value)) {
        setActiveTab(value);
        window.location.hash = value;
      }
    };

    const initial = tabFromHash();
    if (initial) setActiveTab(initial);

    void (async () => {
      try {
        if (initial) {
          await chrome.storage.local.remove('sr-options-tab').catch(() => {});
          return;
        }
        const stored = await chrome.storage.local.get('sr-options-tab');
        const tab = stored['sr-options-tab'];
        applyValue(tab);
        if (tab !== undefined) await chrome.storage.local.remove('sr-options-tab');
      } catch {
      }
    })();

    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes['sr-options-tab']) return;
      applyValue(changes['sr-options-tab'].newValue);
      void chrome.storage.local.remove('sr-options-tab').catch(() => {});
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  function requestTab(tab: Tab): void {
    if (tab === activeTab) return;
    if (activeTab === 'settings' && settingsDirty) {
      setPendingTab(tab);
      return;
    }
    setActiveTab(tab);
    window.location.hash = tab;
  }

  function discardSettingsAndSwitch(): void {
    if (!pendingTab) return;
    setSettingsDirty(false);
    setActiveTab(pendingTab);
    window.location.hash = pendingTab;
    setPendingTab(null);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex].id;
    const blocked = activeTab === 'settings' && settingsDirty;
    requestTab(next);
    if (!blocked) tabRefs.current[next]?.focus();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Applyra</h1>
              <p className="text-sm text-gray-600 mt-1">Vault, Profiles, History & Settings</p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {pendingTab && (
        <div className="border-b border-amber-300 bg-amber-50" role="alert">
          <div className="max-w-4xl mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-amber-900 flex-1">
              You have unsaved settings. Leave without saving?
            </p>
            <button
              className="px-3 py-2 text-sm font-medium rounded bg-amber-700 text-white hover:bg-amber-800"
              onClick={discardSettingsAndSwitch}
            >
              Discard and switch
            </button>
            <button
              className="px-3 py-2 text-sm font-medium rounded bg-white border border-gray-400 text-gray-800 hover:bg-gray-100"
              onClick={() => setPendingTab(null)}
            >
              Stay
            </button>
          </div>
        </div>
      )}

      <nav
        className="max-w-4xl mx-auto px-6 mt-2 flex gap-1"
        role="tablist"
        aria-label="Options sections"
      >
        {TABS.map((tab, index) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={element => { tabRefs.current[tab.id] = element; }}
              id={`sr-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`sr-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
              onClick={() => requestTab(tab.id)}
              onKeyDown={event => handleTabKeyDown(event, index)}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </nav>

      <main
        className="max-w-4xl mx-auto px-6 py-6"
        role="tabpanel"
        id={`sr-panel-${activeTab}`}
        aria-labelledby={`sr-tab-${activeTab}`}
      >
        {activeTab === 'vault' && <VaultManager />}
        {activeTab === 'profiles' && <Profiles />}
        {activeTab === 'history' && <History />}
        {activeTab === 'settings' && <Settings onDirtyChange={setSettingsDirty} />}
      </main>
    </div>
  );
}

export default App;
