import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SiteProfile, ProfileMatchType } from '../lib/profile';
import { getVaultProfiles, type VaultProfile } from '../lib/vaultProfile';
import { TONES, LANGUAGES } from '../lib/options';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';

const PROFILES_KEY = 'sr-profiles';

const MATCH_LABEL_KEYS: Record<ProfileMatchType, string> = {
  url: 'profiles.matchUrl',
  company: 'profiles.matchCompany',
  title: 'profiles.matchTitle',
};

const EMPTY: Omit<SiteProfile, 'id'> = {
  name: '',
  matchType: 'url',
  matchValue: '',
  tone: '',
  maxLength: undefined,
  language: '',
  emphasis: '',
  vaultProfileId: '',
};

async function loadProfiles(): Promise<SiteProfile[]> {
  const data = await chrome.storage.local.get(PROFILES_KEY);
  return (data[PROFILES_KEY] as SiteProfile[]) ?? [];
}

async function saveProfiles(profiles: SiteProfile[]): Promise<void> {
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
}

export function Profiles() {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [vaultProfiles, setVaultProfiles] = useState<VaultProfile[]>([]);
  const [editing, setEditing] = useState<Partial<SiteProfile> & { id?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadProfiles(), getVaultProfiles()]).then(([p, vaults]) => {
      setProfiles(p);
      setVaultProfiles(vaults);
      setLoading(false);
    });
  }, []);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function persist(next: SiteProfile[]) {
    setProfiles(next);
    await saveProfiles(next);
    flashSaved();
  }

  function update<K extends keyof Omit<SiteProfile, 'id'>>(key: K, value: Omit<SiteProfile, 'id'>[K]) {
    setEditing(prev => ({ ...(prev ?? {}), [key]: value }));
    setValidationError(null);
  }

  async function handleAdd() {
    if (!editing || !editing.name?.trim() || !editing.matchValue?.trim()) {
      setValidationError(t('profiles.validation'));
      return;
    }
    setValidationError(null);
    const profile: SiteProfile = {
      id: crypto.randomUUID(),
      name: editing.name.trim(),
      matchType: editing.matchType ?? 'url',
      matchValue: editing.matchValue.trim(),
      tone: editing.tone || undefined,
      maxLength: editing.maxLength && editing.maxLength >= 50 ? editing.maxLength : undefined,
      language: editing.language || undefined,
      emphasis: editing.emphasis?.trim() || undefined,
      vaultProfileId: editing.vaultProfileId || undefined,
    };
    if (editing.id) {
      await persist(profiles.map(p => (p.id === editing.id ? profile : p)));
    } else {
      await persist([...profiles, profile]);
    }
    setEditing(null);
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null);
    await persist(profiles.filter(p => p.id !== id));
  }

  if (loading) {
    return <div className="text-center text-gray-600 py-8">{t('profiles.loading')}</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-lg font-semibold mb-1">{t('profiles.title')}</h2>
      <p className="text-xs text-gray-600 mb-4">
        {t('profiles.description')}
      </p>

      {saved && (
        <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-2 rounded mb-4" role="status">{t('profiles.saved')}</div>
      )}

      {validationError && (
        <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded mb-4" role="alert">{validationError}</div>
      )}

      <div className="space-y-3 mb-6">
        {profiles.length === 0 && (
          <p className="text-sm text-gray-600">{t('profiles.empty')}</p>
        )}
        {profiles.map(p => (
          <div key={p.id} className="border border-gray-200 rounded-md p-3 bg-white flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-gray-600 truncate">
                {t('profiles.matchSummary', { label: t(MATCH_LABEL_KEYS[p.matchType]), value: p.matchValue })}
                {p.tone ? ` · ${t('profiles.toneMeta')}: ${t(`tone.${p.tone}`)}` : ''}
                {p.maxLength ? ` · ${t('profiles.maxMeta')}: ${p.maxLength} ${t('profiles.wordUnit')}` : ''}
                {p.language ? ` · ${t('profiles.languageMeta')}: ${t(`language.${p.language}`)}` : ''}
                {p.vaultProfileId ? ` · ${t('profiles.vaultMeta')}: ${vaultProfiles.find(v => v.id === p.vaultProfileId)?.name ?? p.vaultProfileId}` : ''}
              </p>
              {p.emphasis && <p className="text-xs text-gray-600 truncate mt-0.5">{p.emphasis}</p>}
            </div>
            {confirmDeleteId === p.id ? (
              <div className="flex gap-2 shrink-0" role="alert">
                <button
                  className="text-xs px-2.5 py-1.5 rounded bg-red-600 text-white hover:bg-red-700"
                  onClick={() => void handleDelete(p.id)}
                >
                  {t('profiles.confirmDelete')}
                </button>
                <button
                  className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  {t('profiles.cancel')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2 shrink-0">
                <button
                  className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                  onClick={() => setEditing({ ...p })}
                >
                  {t('profiles.edit')}
                </button>
                <button
                  className="text-xs px-2.5 py-1.5 rounded bg-red-50 text-red-700 border border-red-300 hover:bg-red-100"
                  onClick={() => setConfirmDeleteId(p.id)}
                >
                  {t('profiles.delete')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="border border-blue-200 rounded-md p-4 bg-blue-50/40 space-y-3">
          <h3 className="text-sm font-semibold">{t(editing.id ? 'profiles.editProfile' : 'profiles.newProfile')}</h3>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.name')}</label>
              <input
                className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
                placeholder={t('profiles.namePlaceholder')}
                value={editing.name ?? ''}
                onChange={e => update('name', e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.matchOn')}</label>
              <select
                className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
                value={editing.matchType ?? 'url'}
                onChange={e => update('matchType', e.target.value as ProfileMatchType)}
              >
                <option value="url">{t('profiles.url')}</option>
                <option value="company">{t('profiles.company')}</option>
                <option value="title">{t('profiles.jobTitle')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.matchValue')}</label>
            <input
              className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
              placeholder={t(editing.matchType === 'url' ? 'profiles.urlPlaceholder' : editing.matchType === 'company' ? 'profiles.companyPlaceholder' : 'profiles.titlePlaceholder')}
              value={editing.matchValue ?? ''}
              onChange={e => update('matchValue', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.vaultProfile')}</label>
            <select
              className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
              value={editing.vaultProfileId ?? ''}
              onChange={e => update('vaultProfileId', e.target.value || undefined)}
            >
              <option value="">{t('profiles.useActiveVault')}</option>
              {vaultProfiles.map(vault => (
                <option key={vault.id} value={vault.id}>{vault.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              {t('profiles.vaultProfileHelp')}
            </p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.toneOverride')}</label>
              <select
                className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
                value={editing.tone ?? ''}
                onChange={e => update('tone', e.target.value)}
              >
                <option value="">{t('profiles.useDefault')}</option>
                {TONES.map(tone => <option key={tone.value} value={tone.value}>{t(`tone.${tone.value}`)}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.maxLength')}</label>
              <input
                type="number"
                min={50}
                max={2000}
                step={50}
                className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
                placeholder={t('profiles.useDefault')}
                value={editing.maxLength ?? ''}
                onChange={e => update('maxLength', e.target.value === '' ? undefined : parseInt(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.languageOverride')}</label>
              <select
                className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
                value={editing.language ?? ''}
                onChange={e => update('language', e.target.value)}
              >
                <option value="">{t('profiles.useDefault')}</option>
                {LANGUAGES.map(language => <option key={language.value} value={language.value}>{t(`language.${language.value}`)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('profiles.emphasis')}</label>
            <textarea
              className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
              rows={2}
              placeholder={t('profiles.emphasisPlaceholder')}
              value={editing.emphasis ?? ''}
              onChange={e => update('emphasis', e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button
              className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => void handleAdd()}
            >
              {editing.id ? t('profiles.save') : t('profiles.addProfile')}
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              onClick={() => setEditing(null)}
            >
              {t('profiles.cancel')}
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <button
          className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
          onClick={() => setEditing({ ...EMPTY })}
        >
          {t('profiles.newProfileAction')}
        </button>
      )}
    </div>
  );
}

export default Profiles;