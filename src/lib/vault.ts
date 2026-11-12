import { openDB, type IDBPDatabase } from 'idb';

export interface VaultItem {
  id?: number;
  type: 'resume' | 'portfolio' | 'note' | 'tone_sample';
  title: string;
  content: string;
  tags: string[];
  vaultProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VaultExport {
  version: number;
  items: VaultItem[];
  exportedAt: number;
}

export function isVaultExport(value: unknown): value is VaultExport {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<VaultExport>;
  if (data.version !== 1 || !Number.isFinite(data.exportedAt) || !Array.isArray(data.items)) return false;
  return data.items.every(item => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<VaultItem>;
    return (
      ['resume', 'portfolio', 'note', 'tone_sample'].includes(candidate.type ?? '') &&
      typeof candidate.title === 'string' &&
      typeof candidate.content === 'string' &&
      Array.isArray(candidate.tags) &&
      candidate.tags.every(tag => typeof tag === 'string') &&
      Number.isFinite(candidate.createdAt) &&
      Number.isFinite(candidate.updatedAt) &&
      (candidate.vaultProfileId === undefined || typeof candidate.vaultProfileId === 'string')
    );
  });
}

const DB_NAME = 'screen-reader-vault';
const STORE_NAME = 'items';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('type', 'type');
          store.createIndex('title', 'title');
          store.createIndex('createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllItems(profileId?: string): Promise<VaultItem[]> {
  const db = await getDb();
  const all = await db.getAll(STORE_NAME);
  if (profileId === undefined) return all;
  return all.filter(i => (i.vaultProfileId ?? 'default') === profileId);
}

export async function getItemsByType(type: VaultItem['type']): Promise<VaultItem[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, 'type', type);
}

export async function getItem(id: number): Promise<VaultItem | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}

export async function addItem(item: {
  type: VaultItem['type'];
  title: string;
  content: string;
  tags?: string[];
  vaultProfileId?: string;
}): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  return db.add(STORE_NAME, {
    type: item.type,
    title: item.title,
    content: item.content,
    tags: item.tags ?? [],
    vaultProfileId: item.vaultProfileId ?? 'default',
    createdAt: now,
    updatedAt: now,
  }) as Promise<number>;
}

export async function updateItem(item: VaultItem): Promise<void> {
  const db = await getDb();
  item.updatedAt = Date.now();
  await db.put(STORE_NAME, item);
}

export async function deleteItem(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

export async function searchItems(query: string): Promise<VaultItem[]> {
  const all = await getAllItems();
  const lower = query.toLowerCase();
  return all.filter(item =>
    item.title.toLowerCase().includes(lower) ||
    item.content.toLowerCase().includes(lower) ||
    item.tags.some(t => t.toLowerCase().includes(lower))
  );
}

export async function exportVault(profileId?: string): Promise<VaultExport> {
  const items = await getAllItems(profileId);
  return {
    version: 1,
    items: items.map(({ id: _id, ...rest }) => rest),
    exportedAt: Date.now(),
  };
}

export async function importVault(data: VaultExport, profileId?: string): Promise<number> {
  if (!isVaultExport(data)) {
    throw new Error('Invalid vault export data.');
  }
  const db = await getDb();
  let count = 0;
  for (const item of data.items) {
    const { id: _id, ...rest } = item;
    await db.add(STORE_NAME, {
      ...rest,
      vaultProfileId: rest.vaultProfileId && profileId ? profileId : (profileId ?? rest.vaultProfileId ?? 'default'),
      updatedAt: Date.now(),
    });
    count++;
  }
  return count;
}

export async function clearVault(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}