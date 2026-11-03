/**
 * Client-side cache of per-feature analyze() results (specs/cache/spec.md).
 *
 * Memory is the copy the engine reads. chrome.storage.local is updated shortly after
 * a new result is stored, so a worker restart still hits. A full hit on reload does
 * not rewrite storage. Without chrome.storage (unit tests, a non-extension host) the
 * cache lives for the process only.
 *
 * AnalysisCache is the seam for a later mix of this store and a server cache: the
 * engine only calls get/set.
 */

import { logit } from '../utils/logger.js';
import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';

/** Cap on stored results, across every feature. Oldest entry is dropped past this. */
export const MAX_CACHE_SIZE = 5000;

const STORAGE_KEY = 'bn.analysisCache';

/** Wait briefly so a pass of chunks is one write, not one write per feature. */
const SAVE_DELAY_MS = 250;

export interface AnalysisCache {
  get(featureId: string, chunkKey: string): Promise<Partial<ModuleAnalysis> | undefined>;
  set(featureId: string, chunkKey: string, result: Partial<ModuleAnalysis>): Promise<void>;
}

export interface CacheStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface PersistedCache {
  v: 1;
  /** Oldest first. Order is the in-memory LRU at the last new result, not at the last read. */
  entries: { k: string; r: Partial<ModuleAnalysis> }[];
}

function browserLocalStorage(): CacheStorage | null {
  const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
  const local = chromeApi?.storage?.local;
  if (!local?.get || !local?.set) return null;
  return {
    get: (key) => local.get(key) as Promise<Record<string, unknown>>,
    set: (items) => local.set(items),
  };
}

function entryId(featureId: string, chunkKey: string): string {
  return `${featureId}\n${chunkKey}`;
}

/** Copy the result to a new object, so the original can't be accidentally modified. */
function snapshot(result: Partial<ModuleAnalysis>): Partial<ModuleAnalysis> | null {
  try {
    return JSON.parse(JSON.stringify(result));
  } catch (err){
	console.warn('snapshot failed', result, err);
    return null;
  }
}

export class LocalAnalysisCache implements AnalysisCache {
  private readonly map = new Map<string, Partial<ModuleAnalysis>>();
  private readonly storage: CacheStorage | null;
  private loading: Promise<void> | null = null;
  /** A failed read must not be followed by a write that replaces a cache we could not see. */
  private canSave = true;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly maxSize = MAX_CACHE_SIZE, storage?: CacheStorage | null) {
    this.storage = storage === undefined ? browserLocalStorage() : storage;
  }

  async get(featureId: string, chunkKey: string): Promise<Partial<ModuleAnalysis> | undefined> {
    await this.ensureLoaded();
    const id = entryId(featureId, chunkKey);
    const hit = this.map.get(id);
    if (!hit) return undefined;
    // Newest at the end, so eviction drops the entry nobody has needed.
    this.map.delete(id);
    this.map.set(id, hit);
	console.log('cache hit', id, hit);
    return snapshot(hit) ?? undefined;
  }

  async set(featureId: string, chunkKey: string, result: Partial<ModuleAnalysis>): Promise<void> {
    await this.ensureLoaded();
    if (!result || result.error) return;
    const stored = snapshot(result);
    if (!stored) return;
    const id = entryId(featureId, chunkKey);
    this.map.delete(id);
    this.map.set(id, stored);
    this.trim();
    this.dirty = true;
    this.scheduleSave();
  }

  /** Drop every entry. Tests use this; a settings change does not. */
  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.map.clear();
    this.dirty = true;
    await this.flush();
  }

  /** Write now. The background calls this at the end of a pass, before the worker can sleep. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.storage || !this.canSave) {
      this.dirty = false;
      return Promise.resolve();
    }
    if (this.dirty) this.kickSave();
    // A set() during the write marks dirty again; fold that in before flush resolves.
    return this.writing.then(() => (this.dirty ? this.flush() : undefined));
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loading) this.loading = this.read();
    return this.loading;
  }

  private async read(): Promise<void> {
    if (!this.storage) return;
    let bag: Record<string, unknown>;
    try {
      bag = await this.storage.get(STORAGE_KEY);
    } catch (err) {
      this.canSave = false;
      logit('warn', '[cache] load failed:', err);
      return;
    }
    const raw = bag?.[STORAGE_KEY] as PersistedCache | undefined;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.entries)) return;
    for (const entry of raw.entries) {
      if (entry && typeof entry.k === 'string' && entry.r) this.map.set(entry.k, entry.r);
    }
    this.trim();
  }

  private trim() {
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  private scheduleSave() {
    if (!this.storage || !this.canSave || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kickSave();
    }, SAVE_DELAY_MS);
  }

  private kickSave() {
    if (!this.dirty || !this.storage || !this.canSave) return;
    this.dirty = false;
    const payload: PersistedCache = {
      v: 1,
      entries: [...this.map.entries()].map(([k, r]) => ({ k, r })),
    };
	console.log('saving cache', payload);
    this.writing = this.writing
      .then(() => this.storage!.set({ [STORAGE_KEY]: payload }))
      .catch((err) => {
        logit('warn', '[cache] save failed:', err);
      });
  }
}

export const localAnalysisCache = new LocalAnalysisCache();

export function flushAnalysisCache(): Promise<void> {
  return localAnalysisCache.flush();
}

export function clearAnalysisCache(): Promise<void> {
  return localAnalysisCache.clear();
}
