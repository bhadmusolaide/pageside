import { useState, useEffect, useRef } from 'react';
import type { VaultItem } from '../lib/vault';
import { getAllItems, addItem, updateItem, deleteItem, exportVault, importVault } from '../lib/vault';
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

const ITEM_TYPES = ['resume', 'portfolio', 'note', 'tone_sample'] as const;
const TYPE_LABELS: Record<string, string> = {
  resume: 'Resume',
  portfolio: 'Portfolio',
  note: 'Notes',
  tone_sample: 'Tone Samples',
};

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
        setSaveError(`Could not read ${file.name}: ${(e as Error).message}`);
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
      setSaveError((e as Error).message);
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
        <h2 id="sr-vault-form-title" className="text-lg font-semibold mb-4">{isEditing ? 'Edit Item' : 'Add Item'}</h2>

        {saveError && <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded mb-4" role="alert">{saveError}</div>}

        <div className="mb-3">
          <label htmlFor="sr-vault-type" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            id="sr-vault-type"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            value={formType}
            onChange={e => setFormType(e.target.value as VaultItem['type'])}
          >
            {ITEM_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label htmlFor="sr-vault-title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            id="sr-vault-title"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder="e.g. Senior Engineer Resume"
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="sr-vault-content" className="block text-sm font-medium text-gray-700">Content</label>
            <button
              className={`text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 ${importing ? 'opacity-60' : ''}`}
              disabled={importing}
              onClick={() => void handleFileImport()}
            >
              {importing ? 'Reading file…' : 'Import PDF / DOCX / TXT'}
            </button>
          </div>
          <textarea
            id="sr-vault-content"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm h-48"
            placeholder="Paste or type your content here, or import a file..."
            value={formContent}
            onChange={e => setFormContent(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <label htmlFor="sr-vault-tags" className="block text-sm font-medium text-gray-700 mb-1">Tags (comma separated)</label>
          <input
            id="sr-vault-tags"
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder="e.g. engineering, leadership"
            value={formTags}
            onChange={e => setFormTags(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300" onClick={onCancel}>Cancel</button>
          <button
            className={`px-4 py-2 text-sm rounded text-white ${saving ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            disabled={saving || !formTitle.trim() || !formContent.trim()}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
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
          {TYPE_LABELS[item.type] ?? item.type}
        </span>
        <div className="flex gap-1">
          <button className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={onEdit}>Edit</button>
          <button className="text-xs px-2.5 py-1.5 rounded bg-red-100 text-red-800 hover:bg-red-200" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <h3 className="font-medium text-sm">{item.title}</h3>
      {item.tags && item.tags.length > 0 && (
        <div className="flex gap-1 mt-1">
          {item.tags.map(t => <span key={t} className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">{t}</span>)}
        </div>
      )}
      <p className="text-gray-700 text-xs mt-1 whitespace-pre-wrap">{preview}{hasMore ? '...' : ''}</p>
      <p className="text-gray-600 text-xs mt-1">Updated: {new Date(item.updatedAt).toLocaleDateString()}</p>
    </div>
  );
}

export function VaultManager() {
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
      setError((e as Error).message);
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
      setNotice({ kind: 'error', message: 'Enter a profile name.' });
      return;
    }
    try {
      if (profileEditor.mode === 'create') {
        const profile = await addVaultProfile(name);
        await refreshProfiles();
        await handleProfileChange(profile.id);
        setNotice({ kind: 'success', message: `Created profile “${name}”.` });
      } else {
        await renameVaultProfile(activeProfileId, name);
        await refreshProfiles();
        setProfileEditor(null);
        setNotice({ kind: 'success', message: `Renamed profile to “${name}”.` });
      }
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not save profile: ${(e as Error).message}` });
    }
  }

  async function handleDeleteProfile() {
    if (activeProfileId === 'default') return;
    try {
      await deleteVaultProfile(activeProfileId);
      const active = await refreshProfiles();
      await handleProfileChange(active);
      setNotice({ kind: 'success', message: 'Profile deleted. Its items were kept but are hidden until that profile id is restored.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not delete profile: ${(e as Error).message}` });
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
      setNotice({ kind: 'error', message: `Could not delete item: ${(e as Error).message}` });
    }
  }

  async function handleUndoDelete() {
    if (!deletedItem) return;
    try {
      await updateItem(deletedItem);
      setDeletedItem(null);
      await loadItems();
      setNotice({ kind: 'success', message: 'Item restored.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not restore item: ${(e as Error).message}` });
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
      setNotice({ kind: 'error', message: `Export failed: ${(e as Error).message}` });
    }
  }

  async function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version || !Array.isArray(data.items)) {
          setNotice({ kind: 'error', message: 'Invalid vault file format.' });
          return;
        }
        const count = await importVault(data, activeProfileId);
        setNotice({ kind: 'success', message: `Imported ${count} items into the active profile.` });
        await loadItems();
      } catch (e) {
        setNotice({ kind: 'error', message: `Import failed: ${(e as Error).message}` });
      }
    };
    input.click();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
        <label className="text-xs font-medium text-gray-700">Vault profile</label>
        <select
          className="border border-gray-400 rounded px-2 py-1.5 text-sm min-w-40"
          aria-label="Vault profile"
          value={activeProfileId}
          onChange={e => void handleProfileChange(e.target.value)}
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{p.id === 'default' ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <button className="px-2.5 py-1.5 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={handleAddProfile}>
          + New profile
        </button>
        <button
          className="px-2.5 py-1.5 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-40"
          disabled={activeProfileId === 'default'}
          onClick={handleRenameProfile}
        >
          Rename
        </button>
        <button
          className="px-2.5 py-1.5 text-xs rounded bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 disabled:opacity-40"
          disabled={activeProfileId === 'default'}
          onClick={() => setConfirmDeleteProfile(true)}
        >
          Delete
        </button>
        <span className="ml-auto text-xs text-gray-600">{items.length} items in this profile</span>
      </div>

      {profileEditor && (
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-blue-300 bg-blue-50 p-3"
          onSubmit={event => { event.preventDefault(); void submitProfileEditor(); }}
        >
          <div className="flex-1 min-w-48">
            <label htmlFor="sr-profile-name" className="block text-xs font-medium text-gray-700 mb-1">
              {profileEditor.mode === 'create' ? 'New profile name' : 'Rename profile'}
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
            Save profile
          </button>
          <button
            type="button"
            className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-800 hover:bg-gray-100"
            onClick={() => setProfileEditor(null)}
          >
            Cancel
          </button>
        </form>
      )}

      {confirmDeleteProfile && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-900">
            Delete profile “{profiles.find(p => p.id === activeProfileId)?.name ?? activeProfileId}”? Its items are kept but hidden until the profile id is restored.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="px-3 py-2 text-sm rounded bg-red-700 text-white hover:bg-red-800"
              onClick={() => void handleDeleteProfile()}
            >
              Delete profile
            </button>
            <button
              className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-800 hover:bg-gray-100"
              onClick={() => setConfirmDeleteProfile(false)}
            >
              Cancel
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
          <p className="text-sm text-amber-900 flex-1">Deleted “{deletedItem.title}”.</p>
          <button className="px-3 py-2 text-sm rounded bg-white border border-amber-400 text-amber-900 hover:bg-amber-100" onClick={() => void handleUndoDelete()}>
            Undo
          </button>
          <button className="px-3 py-2 text-sm rounded bg-transparent text-amber-900 hover:bg-amber-100" onClick={() => setDeletedItem(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <input
            className="w-full border border-gray-400 rounded px-3 py-2 text-sm"
            placeholder="Search vault..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => setShowAddForm(true)}>
          + Add item
        </button>
        <button className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50" onClick={handleExport}>
          Export
        </button>
        <button className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50" onClick={handleImport}>
          Import
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        <button
          className={`px-3 py-1.5 text-xs rounded ${filterType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => setFilterType('all')}
        >
          All
        </button>
        {ITEM_TYPES.map(t => (
          <button
            key={t}
            className={`px-3 py-1.5 text-xs rounded ${filterType === t ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
            onClick={() => setFilterType(t)}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-600 py-8">Loading vault...</div>}

      {error && <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-3 rounded mb-4" role="alert">{error}</div>}

      {!loading && !error && filteredItems().length === 0 && (
        <div className="text-center text-gray-600 py-8">
          <p className="text-lg mb-2">No vault items yet</p>
          <p className="text-sm">Click "+ Add item" to add your resume, portfolio, notes, or tone samples.</p>
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
    </div>
  );
}

export default VaultManager;