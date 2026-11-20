import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Note, Passage, Quiz, StudySummary } from '../lib/types';
import { LocalError } from './constants';

export interface Page {
  text: string;
  page_number: number | null;
}
export interface StoredNote extends Note {
  pages: Page[];
}
export interface VectorPassage extends Passage {
  vector: Float32Array;
}
export interface LocalData {
  key: 'current';
  id: string;
  name: string;
  revision: number;
  created_at: string;
  result_limit: number;
  ai_consent?: boolean;
  quizzes?: Quiz[];
  summaries?: StudySummary[];
  documents: StoredNote[];
  index: { revision: number; model_id: string; passages: VectorPassage[] } | null;
  activity: { id: number; kind: string; label: string; created_at: string }[];
}
interface Schema extends DBSchema {
  workspace: { key: string; value: LocalData };
}
export function freshData(): LocalData {
  return {
    key: 'current',
    id: crypto.randomUUID(),
    name: 'My study space',
    revision: 0,
    created_at: new Date().toISOString(),
    result_limit: 5,
    ai_consent: false,
    quizzes: [],
    summaries: [],
    documents: [],
    index: null,
    activity: [],
  };
}
export class LocalStore {
  private connection: Promise<IDBPDatabase<Schema>> | undefined;
  constructor(private name = 'padhai-browser-v1') {}
  private connect() {
    if (!this.connection) {
      if (typeof indexedDB === 'undefined')
        throw new LocalError(
          'storage_unavailable',
          'IndexedDB is unavailable. Open PadhAI in a recent browser with site storage enabled.',
        );
      this.connection = openDB<Schema>(this.name, 1, {
        upgrade(db) {
          db.createObjectStore('workspace', { keyPath: 'key' });
        },
        blocking: () => {
          void this.connection?.then((db) => db.close());
          this.connection = undefined;
        },
        terminated: () => {
          this.connection = undefined;
        },
      }).catch(() => {
        this.connection = undefined;
        throw new LocalError(
          'storage_unavailable',
          'Browser storage could not open. Allow site storage or try a regular browser window.',
        );
      });
    }
    return this.connection;
  }
  async read(): Promise<LocalData> {
    const db = await this.connect();
    const existing = await db.get('workspace', 'current');
    if (existing) return existing;
    return this.update((state) => state);
  }
  /** Callback is synchronous: IndexedDB serializes writes across tabs atomically. */
  async update<T>(change: (state: LocalData) => T): Promise<T> {
    const db = await this.connect();
    const tx = db.transaction('workspace', 'readwrite');
    try {
      const state = (await tx.store.get('current')) ?? freshData();
      const result = change(state);
      await tx.store.put(state);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Transaction may already be aborted. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async close() {
    (await this.connection)?.close();
    this.connection = undefined;
  }
}
export function requireVersion(state: LocalData, id: string, revision: number) {
  if (state.id !== id || state.revision !== revision)
    throw new LocalError(
      'notes_changed',
      'Your notes changed during processing. Rebuild the index for the current notes.',
      409,
    );
}
export function activity(state: LocalData, kind: string, label: string) {
  state.activity.unshift({ id: Date.now(), kind, label, created_at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 20);
}
