/** Storage that never throws: blocked, full or unavailable storage falls back to memory. */
type Kind = "local" | "session";
const memory: Record<Kind, Map<string, string>> = { local: new Map(), session: new Map() };

function backend(kind: Kind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function make(kind: Kind) {
  return {
    get(key: string): string | null {
      try { const v = backend(kind)?.getItem(key); if (v != null) return v; } catch { /* fall through */ }
      return memory[kind].get(key) ?? null;
    },
    set(key: string, value: string) {
      memory[kind].set(key, value);
      try { backend(kind)?.setItem(key, value); } catch { /* memory only */ }
    },
    remove(key: string) {
      memory[kind].delete(key);
      try { backend(kind)?.removeItem(key); } catch { /* ignore */ }
    },
    keys(): string[] {
      try { const s = backend(kind); if (s) return Object.keys(s); } catch { /* fall through */ }
      return [...memory[kind].keys()];
    },
  };
}

export const local = make("local");
export const session = make("session");
