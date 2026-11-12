import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import type { VaultItem } from '../lib/vault';
import { getAllItems, addItem, updateItem, deleteItem, exportVault, importVault, isVaultExport } from '../lib/vault';
import {
  decryptVaultBackup,
  encryptVaultBackup,
  EncryptedBackupError,
  isEncryptedVaultBackup,
  MAX_BACKUP_FILE_BYTES,
  type EncryptedVaultBackup,
} from '../lib/encryptedBackup';
import { extractTextFromFile } from '../lib/documentImport';
import {
  getVaultProfiles,
  getActiveVaultProfileId,
  setActiveVaultProfileId,
  addVaultProfile,
  renameVaultProfile,
  deleteVaultProfile,
  defaultVaultProfile,
  type VaultProfile,
} from '../lib/vaultProfile';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';

const ITEM_TYPES = ['resume', 'portfolio', 'note', 'tone_sample'] as const;
const TYPE_LABEL_KEYS: Record<string, string> = {
  resume: 'vault.resume',
  portfolio: 'vault.portfolio',
  note: 'vault.notes',
  tone_sample: 'vault.toneSamples',
};

type BackupDialogState =
  | { mode: 'export' }
  | { mode: 'import'; backup: EncryptedVaultBackup; fileName: string };

function VaultForm({ item, onSave, onCancel }: {
  item: Partial<VaultItem> | null;
  onSave: (data: { type: VaultItem['type']; title: string; content: string; tags: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const type = item?.type ?? 'note';
  const title = item?.title ?? '';
  const content = item?.content ?? '';
  const tags = item?.tags?.join(', ') ?? '';
  const isEditing = item?.id !== undefined;

  const [formType, setFormType] = useState(type);
  const [formTitle, setFormTitle] = useState(title);
  const [formContent, setFormContent] = useState(content);
  const [formTags, setFormTags] = useState(tags);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []
    ).filter(element => element.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  async function handleFileImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setSaveError(null);
      try {
        const text = await extractTextFromFile(file);
        setFormContent(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
        if (!formTitle.trim()) {
          setFormTitle(file.name.replace(/\.[^.]+$/, ''));
        }
      } catch (e) {
        setSaveError(t('vault.fileReadError', { file: file.name, error: (e as Error).message }));
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  async function handleSave() {
    if (!formTitle.trim() || !formContent.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        type: formType as VaultItem['type'],
        title: formTitle.trim(),
        content: formContent.trim(),
        tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
      });
    } catch (e) {
      setSaveError(t('vault.saveError', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-vault-form-title"
      >
        <h2 id="sr-vault-form-title" className="text-lg font-semibold mb-4">{t(isEditing ? 'vault.editItem' : 'vault.addItem')}</h2>

        {saveError && <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded mb-4" role="alert">{saveError}</div>}

        <div className="mb-3">
          <label htmlFor="sr-vault-type" className="block text-sm font-medium text-gray-700 mb-1">{t('vault.type')}</label>
          <select
            id="sr-vault-type"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={formType}
            onChange={e => setFormType(e.target.value as VaultItem['type'])}
          >
            {ITEM_TYPES.map(type => <option key={type} value={type}>{t(TYPE_LABEL_KEYS[type])}</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label htmlFor="sr-vault-title" className="block text-sm font-medium text-gray-700 mb-1">{t('vault.title')}</label>
          <input
            id="sr-vault-title"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder={t('vault.resumeTitlePlaceholder')}
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="sr-vault-content" className="block text-sm font-medium text-gray-700">{t('vault.content')}</label>
            <button
              className={`text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 ${importing ? 'opacity-60' : ''}`}
              disabled={importing}
              onClick={() => void handleFileImport()}
            >
              {importing ? t('vault.readingFile') : t('vault.importFile')}
            </button>
          </div>
          <textarea
            id="sr-vault-content"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm h-48"
            placeholder={t('vault.contentPlaceholder')}
            value={formContent}
            onChange={e => setFormContent(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <label htmlFor="sr-vault-tags" className="block text-sm font-medium text-gray-700 mb-1">{t('vault.tags')}</label>
          <input
            id="sr-vault-tags"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder={t('vault.tagsPlaceholder')}
            value={formTags}
            onChange={e => setFormTags(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300" onClick={onCancel}>{t('vault.cancel')}</button>
          <button
            className={`px-4 py-2 text-sm rounded text-white ${saving ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            disabled={saving || !formTitle.trim() || !formContent.trim()}
            onClick={handleSave}
          >
            {saving ? t('vault.saving') : t('vault.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function VaultBackupDialog({
  mode,
  fileName,
  onClose,
  onSubmit,
}: {
  mode: 'export' | 'import';
  fileName?: string;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []
    ).filter(element => element.offsetParent !== null);
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  function getErrorMessage(cause: unknown): string {
    if (cause instanceof EncryptedBackupError) {
      return t(`vault.backupError.${cause.code}`);
    }
    return t('vault.backupError.unexpected', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (mode === 'export' && password !== confirmation) {
      setError(t('vault.passwordMismatch'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit(password);
      busyRef.current = false;
      onClose();
    } catch (cause) {
      busyRef.current = false;
      setBusy(false);
      setError(getErrorMessage(cause));
    }
  }

  const exporting = mode === 'export';
  const title = t(exporting ? 'vault.exportEncryptedTitle' : 'vault.importEncryptedTitle');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-vault-backup-title"
      >
        <h2 id="sr-vault-backup-title" className="text-lg font-semibold mb-2">{title}</h2>
        {fileName && <p className="mb-3 text-sm text-gray-600">{fileName}</p>}
        <p className="mb-4 text-sm text-gray-700">
          {t(exporting ? 'vault.exportPasswordHelp' : 'vault.importPasswordHelp')}
        </p>
        {exporting && <p className="mb-4 text-sm text-amber-800">{t('vault.passwordRecoveryWarning')}</p>}

        {error && <div className="mb-4 rounded border border-red-400 bg-red-100 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}

        <form className="space-y-3" onSubmit={event => void submit(event)}>
          <div>
            <label htmlFor="sr-backup-password" className="mb-1 block text-sm font-medium text-gray-700">{t('vault.password')}</label>
            <input
              id="sr-backup-password"
              type="password"
              autoComplete={exporting ? 'new-password' : 'current-password'}
              className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
              value={password}
              onChange={event => { setPassword(event.target.value); setError(null); }}
            />
          </div>
          {exporting && (
            <div>
              <label htmlFor="sr-backup-confirmation" className="mb-1 block text-sm font-medium text-gray-700">{t('vault.confirmPassword')}</label>
              <input
                id="sr-backup-confirmation"
                type="password"
                autoComplete="new-password"
                className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
                value={confirmation}
                onChange={event => { setConfirmation(event.target.value); setError(null); }}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
              disabled={busy}
              onClick={onClose}
            >
              {t('vault.close')}
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={busy || !password || (exporting && !confirmation)}
            >
              {busy ? t(exporting ? 'vault.encrypting' : 'vault.decrypting') : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ItemCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: () => void; onDelete: () => void }) {
  const preview = item.content.substring(0, 200);
  const hasMore = item.content.length > 200;

  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-2 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="inline-block bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded">
          {TYPE_LABEL_KEYS[item.type] ? t(TYPE_LABEL_KEYS[item.type]) : item.type}
        </span>
        <div className="flex gap-1">
          <button className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={onEdit}>{t('vault.edit')}</button>
          <button className="text-xs px-2.5 py-1.5 rounded bg-red-100 text-red-800 hover:bg-red-200" onClick={onDelete}>{t('vault.delete')}</button>
        </div>
      </div>
      <h3 className="font-medium text-sm">{item.title}</h3>
      {item.tags && item.tags.length > 0 && (
        <div className="flex gap-1 mt-1">
          {item.tags.map(t => <span key={t} className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">{t}</span>)}
        </div>
      )}
      <p className="text-gray-700 text-xs mt-1 whitespace-pre-wrap">{preview}{hasMore ? '...' : ''}</p>
      <p className="text-gray-600 text-xs mt-1">{t('vault.updated', { date: new Date(item.updatedAt).toLocaleDateString(getUiLocale()) })}</p>
    </div>
  );
}

export function VaultManager() {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [profiles, setProfiles] = useState<VaultProfile[]>([defaultVaultProfile()]);
  const [activeProfileId, setActiveProfileIdState] = useState('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState<Partial<VaultItem> | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [profileEditor, setProfileEditor] = useState<{ mode: 'create' | 'rename'; value: string } | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState(false);
  const [deletedItem, setDeletedItem] = useState<VaultItem | null>(null);
  const [backupDialog, setBackupDialog] = useState<BackupDialogState | null>(null);

  useEffect(() => {
    void (async () => {
      const active = await refreshProfiles();
      await loadItems(active);
    })();
  }, []);

  async function refreshProfiles(): Promise<string> {
    const [list, active] = await Promise.all([getVaultProfiles(), getActiveVaultProfileId()]);
    setProfiles(list);
    setActiveProfileIdState(active);
    return active;
  }

  async function loadItems(profileId: string = activeProfileId) {
    setLoading(true);
    setError(null);
    try {
      const all = await getAllItems(profileId);
      setItems(all);
    } catch (e) {
      setError(t('vault.loadError', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleProfileChange(id: string) {
    await setActiveVaultProfileId(id);
    setActiveProfileIdState(id);
    setEditingItem(null);
    setShowAddForm(false);
    setProfileEditor(null);
    setConfirmDeleteProfile(false);
    setDeletedItem(null);
    await loadItems(id);
  }

  function handleAddProfile() {
    setConfirmDeleteProfile(false);
    setProfileEditor({ mode: 'create', value: '' });
  }

  function handleRenameProfile() {
    if (activeProfileId === 'default') return;
    setConfirmDeleteProfile(false);
    const current = profiles.find(p => p.id === activeProfileId);
    setProfileEditor({ mode: 'rename', value: current?.name ?? '' });
  }

  async function submitProfileEditor() {
    const name = profileEditor?.value.trim();
    if (!profileEditor || !name) {
      setNotice({ kind: 'error', message: t('vault.enterProfileName') });
      return;
    }
    try {
      if (profileEditor.mode === 'create') {
        const profile = await addVaultProfile(name);
        await refreshProfiles();
        await handleProfileChange(profile.id);
        setNotice({ kind: 'success', message: t('vault.createdProfile', { name }) });
      } else {
        await renameVaultProfile(activeProfileId, name);
        await refreshProfiles();
        setProfileEditor(null);
        setNotice({ kind: 'success', message: t('vault.renamedProfile', { name }) });
      }
    } catch (e) {
      setNotice({ kind: 'error', message: t('vault.saveProfileError', { error: (e as Error).message }) });
    }
  }

  async function handleDeleteProfile() {
    if (activeProfileId === 'default') return;
    try {
      await deleteVaultProfile(activeProfileId);
      const active = await refreshProfiles();
      await handleProfileChange(active);
      setNotice({ kind: 'success', message: t('vault.profileDeleted') });
    } catch (e) {
      setNotice({ kind: 'error', message: t('vault.deleteProfileError', { error: (e as Error).message }) });
    } finally {
      setConfirmDeleteProfile(false);
    }
  }

  function filteredItems(): VaultItem[] {
    let result = items;
    if (filterType !== 'all') {
      result = result.filter(i => i.type === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function handleSave(data: { type: VaultItem['type']; title: string; content: string; tags: string[] }) {
    if (editingItem?.id) {
      await updateItem({
        ...editingItem,
        ...data,
        id: editingItem.id,
        vaultProfileId: editingItem.vaultProfileId ?? activeProfileId,
        updatedAt: Date.now(),
      } as VaultItem);
    } else {
      await addItem({ ...data, vaultProfileId: activeProfileId });
    }
    setEditingItem(null);
    setShowAddForm(false);
    await loadItems();
  }

  async function handleDelete(id: number) {
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    try {
      await deleteItem(id);
      setDeletedItem(item);
      setNotice(null);
      await loadItems();
    } catch (e) {
      setNotice({ kind: 'error', message: t('vault.deleteItemError', { error: (e as Error).message }) });
    }
  }

  async function handleUndoDelete() {
    if (!deletedItem) return;
    try {
      await updateItem(deletedItem);
      setDeletedItem(null);
      await loadItems();
      setNotice({ kind: 'success', message: t('vault.itemRestored') });
    } catch (e) {
      setNotice({ kind: 'error', message: t('vault.restoreItemError', { error: (e as Error).message }) });
    }
  }

  async function handleExport() {
    try {
      const data = await exportVault(activeProfileId);
      const profileName = profiles.find(p => p.id === activeProfileId)?.name ?? activeProfileId;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pageside-vault-${profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().substring(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNotice({ kind: 'error', message: t('vault.exportError', { error: (e as Error).message }) });
    }
  }

  async function handleEncryptedExport(password: string): Promise<void> {
    const backup = await encryptVaultBackup(await exportVault(activeProfileId), password);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pageside-vault-encrypted-${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: 'success', message: t('vault.encryptedExportSuccess') });
  }

  async function handleEncryptedImport(backup: EncryptedVaultBackup, password: string): Promise<void> {
    const data = await decryptVaultBackup(backup, password);
    const count = await importVault(data, activeProfileId);
    setNotice({ kind: 'success', message: t('vault.importedItems', { count }) });
    await loadItems();
  }

  async function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_BACKUP_FILE_BYTES) {
          throw new EncryptedBackupError('payload_too_large');
        }
        const text = await file.text();
        const data: unknown = JSON.parse(text);
        if (
          data &&
          typeof data === 'object' &&
          'format' in data &&
          data.format === 'pageside-encrypted-vault'
        ) {
          if (!isEncryptedVaultBackup(data)) {
            setNotice({ kind: 'error', message: t('vault.backupError.invalid_format') });
            return;
          }
          setBackupDialog({ mode: 'import', backup: data, fileName: file.name });
          return;
        }
        if (!isVaultExport(data)) {
          setNotice({ kind: 'error', message: t('vault.invalidFile') });
          return;
        }
        const count = await importVault(data, activeProfileId);
        setNotice({ kind: 'success', message: t('vault.importedItems', { count }) });
        await loadItems();
      } catch (e) {
        setNotice({
          kind: 'error',
          message: e instanceof EncryptedBackupError
            ? t(`vault.backupError.${e.code}`)
            : t('vault.importError', { error: (e as Error).message }),
        });
      }
    };
    input.click();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
        <label className="text-xs font-medium text-gray-700">{t('vault.profile')}</label>
        <select
          className="border border-gray-400 rounded px-2 py-1.5 text-sm min-w-40"
          aria-label={t('vault.profile')}
          value={activeProfileId}
          onChange={e => void handleProfileChange(e.target.value)}
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{p.id === 'default' ? ` ${t('vault.default')}` : ''}
            </option>
          ))}
        </select>
        <button className="px-2.5 py-1.5 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={handleAddProfile}>
          {t('vault.newProfile')}
        </button>
        <button
          className="px-2.5 py-1.5 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-40"
          disabled={activeProfileId === 'default'}
          onClick={handleRenameProfile}
        >
          {t('vault.rename')}
        </button>
        <button
          className="px-2.5 py-1.5 text-xs rounded bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 disabled:opacity-40"
          disabled={activeProfileId === 'default'}
          onClick={() => setConfirmDeleteProfile(true)}
        >
          {t('vault.delete')}
        </button>
        <span className="ml-auto text-xs text-gray-600">{t('vault.itemCount', { count: items.length })}</span>
      </div>

      {profileEditor && (
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-blue-300 bg-blue-50 p-3"
          onSubmit={event => { event.preventDefault(); void submitProfileEditor(); }}
        >
          <div className="flex-1 min-w-48">
            <label htmlFor="sr-profile-name" className="block text-xs font-medium text-gray-700 mb-1">
              {t(profileEditor.mode === 'create' ? 'vault.newProfileName' : 'vault.renameProfile')}
            </label>
            <input
              id="sr-profile-name"
              autoFocus
              className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm"
              value={profileEditor.value}
              onChange={event => setProfileEditor(prev => prev ? { ...prev, value: event.target.value } : prev)}
              onKeyDown={event => { if (event.key === 'Escape') setProfileEditor(null); }}
            />
          </div>
          <button type="submit" className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">
            {t('vault.saveProfile')}
          </button>
          <button
            type="button"
            className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-800 hover:bg-gray-100"
            onClick={() => setProfileEditor(null)}
          >
            {t('vault.cancel')}
          </button>
        </form>
      )}

      {confirmDeleteProfile && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-900">
            {t('vault.deleteProfileConfirm', { name: profiles.find(p => p.id === activeProfileId)?.name ?? activeProfileId })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="px-3 py-2 text-sm rounded bg-red-700 text-white hover:bg-red-800"
              onClick={() => void handleDeleteProfile()}
            >
              {t('vault.deleteProfile')}
            </button>
            <button
              className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-800 hover:bg-gray-100"
              onClick={() => setConfirmDeleteProfile(false)}
            >
              {t('vault.cancel')}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`mb-3 rounded border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-green-400 bg-green-100 text-green-800' : 'border-red-400 bg-red-100 text-red-800'}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.message}
        </div>
      )}

      {deletedItem && (
        <div className="mb-3 flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3" role="status">
          <p className="text-sm text-amber-900 flex-1">{t('vault.deletedItem', { title: deletedItem.title })}</p>
          <button className="px-3 py-2 text-sm rounded bg-white border border-amber-400 text-amber-900 hover:bg-amber-100" onClick={() => void handleUndoDelete()}>
            {t('vault.undo')}
          </button>
          <button className="px-3 py-2 text-sm rounded bg-transparent text-amber-900 hover:bg-amber-100" onClick={() => setDeletedItem(null)}>
            {t('vault.dismiss')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <input
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder={t('vault.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => setShowAddForm(true)}>
          {t('vault.addItemAction')}
        </button>
        <button className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50" onClick={handleExport}>
          {t('vault.export')}
        </button>
        <button className="px-3 py-2 text-sm rounded bg-white border border-blue-400 text-blue-700 hover:bg-blue-50" onClick={() => setBackupDialog({ mode: 'export' })}>
          {t('vault.exportEncrypted')}
        </button>
        <button className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50" onClick={handleImport}>
          {t('vault.import')}
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-600">{t('vault.plainExportWarning')}</p>

      <div className="flex gap-1 mb-4">
        <button
          className={`px-3 py-1.5 text-xs rounded ${filterType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => setFilterType('all')}
        >
          {t('vault.all')}
        </button>
        {ITEM_TYPES.map(type => (
          <button
            key={type}
            className={`px-3 py-1.5 text-xs rounded ${filterType === type ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
            onClick={() => setFilterType(type)}
          >
            {TYPE_LABEL_KEYS[type] ? t(TYPE_LABEL_KEYS[type]) : type}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-600 py-8">{t('vault.loading')}</div>}

      {error && <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-3 rounded mb-4" role="alert">{error}</div>}

      {!loading && !error && filteredItems().length === 0 && (
        <div className="text-center text-gray-600 py-8">
          <p className="text-lg mb-2">{t('vault.noItems')}</p>
          <p className="text-sm">{t('vault.emptyHelp')}</p>
        </div>
      )}

      {!loading && !error && filteredItems().length > 0 && (
        <div className="space-y-0">
          {filteredItems().map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={() => setEditingItem(item)}
              onDelete={() => handleDelete(item.id!)}
            />
          ))}
        </div>
      )}

      {showAddForm && (
        <VaultForm item={null} onSave={handleSave} onCancel={() => setShowAddForm(false)} />
      )}

      {editingItem && (
        <VaultForm item={editingItem} onSave={handleSave} onCancel={() => setEditingItem(null)} />
      )}
      {backupDialog && (
        <VaultBackupDialog
          mode={backupDialog.mode}
          fileName={backupDialog.mode === 'import' ? backupDialog.fileName : undefined}
          onClose={() => setBackupDialog(null)}
          onSubmit={password => backupDialog.mode === 'export'
            ? handleEncryptedExport(password)
            : handleEncryptedImport(backupDialog.backup, password)}
        />
      )}
    </div>
  );
}

export default VaultManager;