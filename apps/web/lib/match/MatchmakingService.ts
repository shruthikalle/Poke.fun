import { session } from "../storage";
import type { Trainer } from "../battle/types";
import { opponentAssets } from "../cards/collection";
import { buildTeam, resolveCard, type CardPick, type MatchFormat, type PowerTier } from "../cards/mapping";
import { tierFor, type RankTier } from "../rank/RankService";

export interface MatchRequest {
  player: string;
  rating: number;
  format: MatchFormat;
  tier: PowerTier;
  entry: number;
  team: CardPick[];
}

export interface MatchOpponent {
  trainer: Trainer;
  rating: number;
  tier: RankTier;
  wins: number;
  losses: number;
  team: CardPick[];
}

export interface MatchTicket {
  matchId: string;
  format: MatchFormat;
  entry: number;
  you: { name: string; rating: number; team: CardPick[] };
  opponent: MatchOpponent;
}

export interface MatchSearch {
  result: Promise<MatchTicket>;
  cancel(): void;
}

export interface MatchmakingService {
  /** Queues by format, then card power tier, rating band and entry amount. */
  find(request: MatchRequest): MatchSearch;
}

const TRAINERS: Trainer[] = [
  { id: "thar07", name: "thar07", avatar: "kai" },
  { id: "mossy_mo", name: "mossy_mo", avatar: "theo" },
  { id: "pyrefly", name: "pyrefly", avatar: "rook" },
];

/** TODO(matchmaking): replace with the Go API queue over WebSocket. */
export class MockMatchmakingService implements MatchmakingService {
  find(request: MatchRequest): MatchSearch {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reject: (e: Error) => void = () => {};
    const result = new Promise<MatchTicket>((resolve, rej) => {
      reject = rej;
      timer = setTimeout(() => {
        const trainer = TRAINERS[Math.floor(Math.random() * TRAINERS.length)];
        const cards = opponentAssets(trainer.id).map(resolveCard).flatMap((r) => (r.eligible ? [r.pick] : []));
        const sameTier = cards.filter((c) => c.tier === request.tier);
        const pool = sameTier.length ? sameTier : cards;
        const lead = pool[Math.floor(Math.random() * pool.length)];
        const rating = request.rating + Math.round((Math.random() - 0.5) * 120);
        resolve({
          matchId: `m-${Date.now().toString(36)}`,
          format: request.format,
          entry: request.entry,
          you: { name: request.player, rating: request.rating, team: request.team },
          opponent: {
            trainer,
            rating,
            tier: tierFor(rating),
            wins: 20 + Math.floor(Math.random() * 40),
            losses: 10 + Math.floor(Math.random() * 30),
            team: buildTeam(lead, cards.filter((c) => !request.team.some((t) => t.species === c.species)), request.format),
          },
        });
      }, 2200 + Math.random() * 1500);
    });
    return { result, cancel: () => { clearTimeout(timer); reject(new Error("cancelled")); } };
  }
}

export const matchmakingService: MatchmakingService = new MockMatchmakingService();

const TICKET_KEY = "pf:match:v1";

export function saveTicket(ticket: MatchTicket) {
  session.set(TICKET_KEY, JSON.stringify(ticket));
}

const isPick = (p: unknown): p is CardPick => !!p && typeof p === "object" && typeof (p as CardPick).species === "string" && typeof (p as CardPick).key === "string" && typeof (p as CardPick).level === "number";
const isTeam = (t: unknown) => Array.isArray(t) && t.length >= 1 && t.length <= 3 && t.every(isPick);

/** Rejects stale or hand-edited tickets so /battle never renders half a match. */
export function isTicket(t: unknown): t is MatchTicket {
  const x = t as MatchTicket;
  return !!x && typeof x.matchId === "string" && (x.format === "champion" || x.format === "squad") && typeof x.entry === "number" && x.entry >= 0
    && !!x.you && isTeam(x.you.team) && typeof x.you.rating === "number" && !!x.opponent && isTeam(x.opponent.team) && !!x.opponent.trainer?.name && typeof x.opponent.rating === "number";
}

export function loadTicket(): MatchTicket | null {
  try {
    const raw = session.get(TICKET_KEY);
    const ticket: unknown = raw ? JSON.parse(raw) : null;
    if (isTicket(ticket)) return ticket;
    if (raw) session.remove(TICKET_KEY);
    return null;
  } catch {
    return null;
  }
}
