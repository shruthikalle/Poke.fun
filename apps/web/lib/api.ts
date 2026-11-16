const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type Attack = {
  id: string;
  name: string;
  element: string;
  category: "physical" | "special";
  power: number;
  damage: number;
  cost: number;
  gain: number;
};

export type Card = {
  id: string;
  name: string;
  element: string;
  maxHp: number;
  types: string[];
  level: number;
  tier: number;
  sprite: string;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  attacks: Attack[];
};

export type Player = {
  name: string;
  card: Card;
  hp: number;
  energy: number;
};

export type Effectiveness = "super" | "resisted" | "immune" | "normal";

export type Turn = {
  number: number;
  attacks: [string, string];
  damage: [number, number];
  effect: [Effectiveness, Effectiveness];
  auto: [boolean, boolean];
  hp: [number, number];
};

export type Match = {
  id: string;
  status: "waiting" | "playing" | "finished";
  you: number;
  players: [Player, Player | null];
  submitted: [boolean, boolean];
  turn: number;
  winner?: "player1" | "player2" | "draw";
  history: Turn[];
  rulesVersion: string;
  catalogVersion: string;
  deadlineUnixMs?: number;
};

export type Session = { id: string; token: string };

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Cannot reach the Go API. Start it on port 8080.");
  }
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error ?? `Request failed (${response.status})`);
  }
  return result as T;
}

export const api = {
  cards: () => request<Card[]>("/api/cards"),
  create: (name: string, cardId: string) =>
    request<Session>("/api/matches", {
      method: "POST",
      body: JSON.stringify({ name, cardId }),
    }),
  join: (id: string, name: string, cardId: string) =>
    request<Session>(`/api/matches/${encodeURIComponent(id)}/join`, {
      method: "POST",
      body: JSON.stringify({ name, cardId }),
    }),
  match: (session: Session) =>
    request<Match>(`/api/matches/${encodeURIComponent(session.id)}`, undefined, session.token),
  attack: (session: Session, attackId: string) =>
    request<Match>(`/api/matches/${encodeURIComponent(session.id)}/attacks`, {
      method: "POST",
      body: JSON.stringify({ attackId }),
    }, session.token),
};
