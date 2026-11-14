/**
 * 每日任务的草稿 (PRD part 5 §3.1 "网络不好时：内容先存在手机上，自动重传，不会丢"):
 * what the child has typed goes to localStorage, the pictures and the recording
 * to IndexedDB, per child and template. Both can be missing (private mode, an
 * old WeChat browser): then the draft only lives while the page is open.
 * A draft older than 7 days is dropped.
 */

export interface DraftText {
  /** One key per hand-in: the server returns the same submission when it is sent again. */
  clientKey: string;
  mode: "voice" | "text";
  text: string;
  aiNote: string;
  noAi: boolean;
  savedAt: number;
}

export interface DraftBlobs {
  files: { name: string; type: string; blob: Blob }[];
  voice: { blob: Blob; mimeType: string; durationMs: number } | null;
}

const MAX_AGE_MS = 7 * 24 * 3600_000;
const key = (childId: string, templateId: number) => `zyj.dailyDraft.${childId}.${templateId}`;

export function newClientKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // older browsers: a version-4 UUID from Math.random is enough for a per-hand-in key
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function loadDraftText(childId: string, templateId: number, now = Date.now()): DraftText | null {
  try {
    const raw = localStorage.getItem(key(childId, templateId));
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftText;
    if (!d.clientKey || now - d.savedAt > MAX_AGE_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraftText(childId: string, templateId: number, d: Omit<DraftText, "savedAt">, now = Date.now()): void {
  try {
    localStorage.setItem(key(childId, templateId), JSON.stringify({ ...d, savedAt: now }));
  } catch {
    // storage full or blocked: the draft stays in the page
  }
}

// ---- pictures and recording (IndexedDB) ----------------------------------------------------------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open("zyj-drafts", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("blobs");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("blobs", mode);
      const req = fn(tx.objectStore("blobs"));
      tx.oncomplete = () => resolve(req ? (req.result ?? null) : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadDraftBlobs(childId: string, templateId: number): Promise<DraftBlobs | null> {
  return ((await withStore("readonly", (s) => s.get(key(childId, templateId)))) as DraftBlobs | null) ?? null;
}

export async function saveDraftBlobs(childId: string, templateId: number, b: DraftBlobs): Promise<void> {
  await withStore("readwrite", (s) => {
    s.put(b, key(childId, templateId));
  });
}

export async function clearDraft(childId: string, templateId: number): Promise<void> {
  try {
    localStorage.removeItem(key(childId, templateId));
  } catch {
    // nothing to clear
  }
  await withStore("readwrite", (s) => {
    s.delete(key(childId, templateId));
  });
}

/** Waits before trying a hand-in again after the network failed (then every minute). */
export const RETRY_WAITS_MS = [5_000, 15_000, 30_000, 60_000];

/** The network or the server is down (worth trying again), not a refusal. */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 0 || (typeof status === "number" && status >= 500);
}
