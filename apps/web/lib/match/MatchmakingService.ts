import { session } from "../storage";
import type { Side, Trainer } from "../battle/types";
import type { CardPick, MatchFormat, PowerTier } from "../cards/mapping";
import type { RankTier } from "../rank/RankService";
import { ServerMatchmakingService } from "./ServerMatchmakingService";

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

/** Handle to a two-player battle created by the server's matchmaking queue. */
export interface LiveMatch {
  battleId: string;
  /** Authenticates our side; never shared with the opponent. */
  token: string;
  side: Side;
}

export interface MatchTicket {
  matchId: string;
  format: MatchFormat;
  entry: number;
  you: { name: string; rating: number; team: CardPick[] };
  opponent: MatchOpponent;
  /** Present for a real two-player match; absent when battling the AI. */
  live?: LiveMatch;
  /** Devnet SOL escrow attached by the paid queue after both deposits. */
  paidWager?: { id: string; token: string; wager: string; stakeLamports: number };
}

export interface MatchSearch {
  result: Promise<MatchTicket>;
  cancel(): void;
}

export interface MatchmakingService {
  /** Queues by format, then card power tier, rating band and entry amount. */
  find(request: MatchRequest): MatchSearch;
}

/** Real two-player matchmaking through the Go API. */
export const matchmakingService: MatchmakingService = new ServerMatchmakingService();

const TICKET_KEY = "pf:match:v1";

export function saveTicket(ticket: MatchTicket) {
  session.set(TICKET_KEY, JSON.stringify(ticket));
}

const isPick = (p: unknown): p is CardPick => !!p && typeof p === "object" && typeof (p as CardPick).species === "string" && typeof (p as CardPick).key === "string" && typeof (p as CardPick).level === "number";
const isTeam = (t: unknown) => Array.isArray(t) && t.length >= 1 && t.length <= 3 && t.every(isPick);

const isLive = (l: unknown) => {
  const x = l as LiveMatch;
  return !!x && typeof x.battleId === "string" && typeof x.token === "string" && (x.side === "p1" || x.side === "p2");
};

/** Rejects stale or hand-edited tickets so /battle never renders half a match. */
export function isTicket(t: unknown): t is MatchTicket {
  const x = t as MatchTicket;
  return !!x && typeof x.matchId === "string" && (x.format === "champion" || x.format === "squad") && typeof x.entry === "number" && x.entry >= 0
    && !!x.you && isTeam(x.you.team) && typeof x.you.rating === "number" && !!x.opponent && isTeam(x.opponent.team) && !!x.opponent.trainer?.name && typeof x.opponent.rating === "number"
    && (x.live === undefined || isLive(x.live))
    && (x.paidWager === undefined || !!x.live && typeof x.paidWager.id === "string" && typeof x.paidWager.token === "string"
      && typeof x.paidWager.wager === "string" && Number.isInteger(x.paidWager.stakeLamports) && x.paidWager.stakeLamports > 0);
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
