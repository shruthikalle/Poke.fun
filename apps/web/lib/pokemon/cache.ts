const memory = new Map<string, Promise<unknown>>();

/** Memoises `load` in memory and localStorage under `key`. Failed loads are not cached. */
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const storageKey = `pf:cache:${key}`;
  const hit = memory.get(storageKey);
  if (hit) return hit as Promise<T>;
  const promise = (async () => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (raw) return JSON.parse(raw) as T;
    } catch { /* corrupt or blocked storage: refetch */ }
    const value = await load();
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* quota: memory only */ }
    return value;
  })();
  memory.set(storageKey, promise);
  promise.catch(() => memory.delete(storageKey));
  return promise;
}
