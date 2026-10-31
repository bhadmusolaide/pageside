import { openDB, type IDBPDatabase } from 'idb';

export interface HistoryAnswer {
  id?: number;
  question: string;
  answer: string;
  sourceIds: number[];
  company?: string;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'screen-reader-history';
const STORE_NAME = 'answers';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('question', 'question');
          store.createIndex('createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function addHistoryAnswer(
  question: string,
  answer: string,
  sourceIds: number[],
  company?: string
): Promise<number> {
  const db = await getDb();
  const now = Date.now();

  const existing = (await db.getAll(STORE_NAME)).find(item =>
    normalize(item.question) === normalize(question) &&
    normalize(item.answer) === normalize(answer)
  );

  if (existing?.id !== undefined) {
    await db.put(STORE_NAME, {
      ...existing,
      sourceIds: sourceIds.length > 0 ? sourceIds : existing.sourceIds,
      company: company ?? existing.company,
      updatedAt: now,
    });
    return existing.id;
  }

  return db.add(STORE_NAME, {
    question,
    answer,
    sourceIds,
    company: company ?? undefined,
    createdAt: now,
    updatedAt: now,
  }) as Promise<number>;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function getAllHistoryAnswers(): Promise<HistoryAnswer[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function deleteHistoryAnswer(id: number): Promise<boolean> {
  const db = await getDb();
  const existing = await db.get(STORE_NAME, id);
  if (existing === undefined) return false;
  await db.delete(STORE_NAME, id);
  return true;
}

export async function findSimilarAnswers(
  question: string,
  minScore: number = 3,
  limit: number = 30
): Promise<HistoryAnswer[]> {
  const all = await getAllHistoryAnswers();
  const scored = all.map(item => ({ item, score: similarityScore(question, item.question) }));
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter(s => s.score >= minScore)
    .slice(0, limit)
    .map(s => s.item);
}

export function similarityScore(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;

  let shared = 0;
  for (const w of wa) {
    if (wb.has(w)) shared++;
  }

  const ratio = shared / Math.max(1, Math.min(wa.size, wb.size));
  return shared * ratio;
}

function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  return new Set(words);
}