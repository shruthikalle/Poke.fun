import { ApiError } from "./battle/battleApi";
export { ApiError as ArenaApiError } from "./battle/battleApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * A fighter's move, derived on the server from PokéAPI data (services/api/internal/arena/fighters.go).
 * `damage` is the hit against an average target; real hits depend on the target's defence and,
 * for specials, its types. Specials spray in a `cone` or burst in a `radius` around the attacker.
 */
export type ArenaMove = { id: string; name: string; type: string; category: "physical" | "special"; power: number; damage: number; range: number; cooldownMs: number; shape?: "radius" | "cone" };
/** One fighter per species in the server's Pokédex; matchmaking only pairs equal tiers. */
export type ArenaCard = { id: string; name: string; type: string; types: string[]; tier: number; level: number; maxHp: number; speed: number; sprite: string; basic: ArenaMove; special: ArenaMove };
export type Fighter = { name: string; card: ArenaCard; x: number; y: number; hp: number; energy: number; basicCooldownMs: number; specialCooldownMs: number; dodgeCooldownMs: number; dodging: boolean; charging: boolean; chargeMsLeft: number; chargeX: number; chargeY: number; chargeDx: number; chargeDy: number; lastAttack?: string; lastAttackTick: number; attackX: number; attackY: number; attackDx: number; attackDy: number; attackTargetX: number; attackTargetY: number; lastAttackHit: boolean };
export type ArenaView = { id: string; status: "waiting" | "playing" | "finished"; you: number; fighters: [Fighter, Fighter | null]; tick: number; timeLeftMs: number; winner?: "player1" | "player2" | "draw"; endReason?: "forfeit" | "disconnect" | "timeout" | "knockout"; connected?: [boolean, boolean]; disconnectDeadline?: [string, string] };
export type ArenaSession = { id: string; token: string; entryCents?: number; player?: string; stakeLamports?: number; wager?: string; makerAddress?: string; opponentAddress?: string; expiresAt?: number; paidQueue?: { id: string; token: string } };
export type ArenaQueueTicket = { id: string; token: string; status: "waiting" | "matched"; entryCents: number; arena?: ArenaSession; opponent?: string };
export const ARENA_QUEUE_STORAGE_KEY = "pokefun-realtime-queue";
export const ARENA_SESSION_STORAGE_KEY = "pokefun-realtime-arena";

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    });
  } catch { throw new Error("Cannot reach the Go arena server. Start it on port 8080."); }
  const body = response.status === 204 ? undefined : await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export const arenaApi = {
  /** Every fighter: over 1,200, so prefer cardsByIds when only a few are needed. */
  cards: () => request<ArenaCard[]>("/api/arena-cards"),
  /** Just these fighters, by species key; unknown keys are left out. */
  cardsByIds: (ids: string[]) => request<ArenaCard[]>(`/api/arena-cards?ids=${ids.map(encodeURIComponent).join(",")}`),
  enqueue: (name: string, cardId: string, rating: number, entryCents = 0, ownedAsset?: { assetId: string; walletAddress: string }) => request<ArenaQueueTicket>("/api/arena-queue", { method: "POST", body: JSON.stringify({ name, cardId, rating, entryCents, rental: !ownedAsset, ...ownedAsset }) }),
  queueStatus: (ticket: ArenaQueueTicket) => request<ArenaQueueTicket>(`/api/arena-queue/${encodeURIComponent(ticket.id)}`, undefined, ticket.token),
  cancelQueue: (ticket: ArenaQueueTicket) => request<void>(`/api/arena-queue/${encodeURIComponent(ticket.id)}`, { method: "DELETE" }, ticket.token),
  create: (name: string, cardId: string) => request<ArenaSession>("/api/arenas", { method: "POST", body: JSON.stringify({ name, cardId }) }),
  join: (id: string, name: string, cardId: string) => request<ArenaSession>(`/api/arenas/${encodeURIComponent(id)}/join`, { method: "POST", body: JSON.stringify({ name, cardId }) }),
  view: (session: ArenaSession) => request<ArenaView>(`/api/arenas/${encodeURIComponent(session.id)}`, undefined, session.token),
  forfeit: (session: ArenaSession) => request<ArenaView>(`/api/arenas/${encodeURIComponent(session.id)}/forfeit`, { method: "POST" }, session.token),
  socketUrl: (id: string) => `${API_URL.replace(/^http/, "ws")}/api/arenas/${encodeURIComponent(id)}/ws`,
};

/** Only definitive credential/session failures may erase a saved token. */
export const arenaSessionExpired = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
export type ArenaConnection = "offline" | "connecting" | "online" | "reconnecting" | "expired";
