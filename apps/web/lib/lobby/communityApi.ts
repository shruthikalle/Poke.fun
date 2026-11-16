const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

class CommunityError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function communityRequest<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new CommunityError(body.error ?? "Community server unavailable", response.status);
  return body as T;
}

// One ephemeral session per actual demo name in this tab. This authenticates a
// presence session, not ownership of the public name or a wallet identity.
const sessions = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export function heartbeat(name: string, roomId = "lobby"): Promise<string> {
  const run = async () => {
    const send = (token?: string) => communityRequest<{ token: string }>("/api/community/presence", {
      method: "POST", body: JSON.stringify({ name, roomId }),
    }, token);
    let result: { token: string };
    try { result = await send(sessions.get(name)); }
    catch (error) {
      if (!(error instanceof CommunityError) || error.status !== 401) throw error;
      sessions.delete(name);
      result = await send();
    }
    sessions.set(name, result.token);
    return result.token;
  };
  // Lobby and room heartbeats may start together; serialize session creation.
  const next = (pending.get(name) ?? Promise.resolve("")).catch(() => "").then(run);
  pending.set(name, next);
  void next.finally(() => { if (pending.get(name) === next) pending.delete(name); }).catch(() => {});
  return next;
}
