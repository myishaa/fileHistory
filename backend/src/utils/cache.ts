type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export const cacheTtl = {
  authSessionMs: 30_000,
  settingsMs: 60_000,
  divisionsMs: 60_000,
  lookupMs: 120_000,
} as const;

export async function getCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value as T;

  const value = await load();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function setCached<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function deleteCached(key: string) {
  cache.delete(key);
}

export function clearCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearLookupCaches() {
  clearCachePrefix("settings:");
  clearCachePrefix("divisions:");
  clearCachePrefix("lookup:");
}
