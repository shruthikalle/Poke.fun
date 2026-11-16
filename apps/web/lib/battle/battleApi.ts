const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** A non-2xx response from the Go API, carrying the status for callers to branch on. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * JSON request to the Go battle API. Sends the player token as a bearer token
 * when given, and throws ApiError (with the server's message) on failure.
 */
export async function apiRequest<T = any>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    signal,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}
