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
export type ArenaView = { id: string; status: "waiting" | "playing" | "finished"; you: number; fighters: [Fighter, Fighter | null]; tick: number; timeLeftMs: number; winner?: "player1" | "player2" | "draw" };
export type ArenaSession = { id: string; token: string; entryCents?: number };
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
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export const arenaApi = {
  cards: () => request<ArenaCard[]>("/api/arena-cards"),
  enqueue: (name: string, cardId: string, rating: number, entryCents = 0, ownedAsset?: { assetId: string; walletAddress: string }) => request<ArenaQueueTicket>("/api/arena-queue", { method: "POST", body: JSON.stringify({ name, cardId, rating, entryCents, ...ownedAsset }) }),
  queueStatus: (ticket: ArenaQueueTicket) => request<ArenaQueueTicket>(`/api/arena-queue/${encodeURIComponent(ticket.id)}`, undefined, ticket.token),
  cancelQueue: async (ticket: ArenaQueueTicket) => {
    const response = await fetch(`${API_URL}/api/arena-queue/${encodeURIComponent(ticket.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${ticket.token}` } });
    if (!response.ok) throw new Error((await response.json()).error ?? "Could not leave queue");
  },
  create: (name: string, cardId: string) => request<ArenaSession>("/api/arenas", { method: "POST", body: JSON.stringify({ name, cardId }) }),
  join: (id: string, name: string, cardId: string) => request<ArenaSession>(`/api/arenas/${encodeURIComponent(id)}/join`, { method: "POST", body: JSON.stringify({ name, cardId }) }),
  view: (session: ArenaSession) => request<ArenaView>(`/api/arenas/${encodeURIComponent(session.id)}`, undefined, session.token),
  socketUrl: (id: string) => `${API_URL.replace(/^http/, "ws")}/api/arenas/${encodeURIComponent(id)}/ws`,
};
