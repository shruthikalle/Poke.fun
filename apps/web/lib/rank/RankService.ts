import { local } from "../storage";
import { communityRequest } from "../lobby/communityApi";
export type RankTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Master";

export interface RankInfo {
  rating: number;
  tier: RankTier;
  wins: number;
  losses: number;
  history: { at: number; opponent: string; result: "win" | "loss" | "draw"; delta: number; matchId?: string }[];
}

export interface LeaderboardEntry extends RankInfo { name: string; draws: number }
export interface Leaderboard { entries: LeaderboardEntry[]; namespace: string }

export interface RankService {
  getRank(player: string): Promise<RankInfo>;
  /** Rating change for a win and a loss against `opponentRating`. */
  preview(rating: number, opponentRating: number): { win: number; loss: number };
  recordResult(player: string, opponent: string, opponentRating: number, result: "win" | "loss" | "draw"): Promise<{ before: RankInfo; after: RankInfo; delta: number }>;
}

export function tierFor(rating: number): RankTier {
  if (rating >= 1800) return "Master";
  if (rating >= 1650) return "Platinum";
  if (rating >= 1500) return "Gold";
  if (rating >= 1350) return "Silver";
  return "Bronze";
}

const K = 32;
const expected = (r: number, o: number) => 1 / (1 + 10 ** ((o - r) / 400));
const delta = (r: number, o: number, score: number) => Math.round(K * (score - expected(r, o)));
const keyFor = (player: string) => `pf:rank:v1:${player}`;

/** Browser-local ranks, kept for explicit offline demos only; the default is ApiRankService. */
export class MockRankService implements RankService {
  async getRank(player: string): Promise<RankInfo> {
    try {
      const raw = local.get(keyFor(player));
      if (raw) return JSON.parse(raw) as RankInfo;
    } catch { /* fall through to a fresh rank */ }
    return { rating: 1480, tier: tierFor(1480), wins: 12, losses: 9, history: [] };
  }

  preview(rating: number, opponentRating: number) {
    return { win: delta(rating, opponentRating, 1), loss: delta(rating, opponentRating, 0) };
  }

  async recordResult(player: string, opponent: string, opponentRating: number, result: "win" | "loss" | "draw") {
    const before = await this.getRank(player);
    const d = delta(before.rating, opponentRating, result === "win" ? 1 : result === "draw" ? 0.5 : 0);
    const rating = before.rating + d;
    const after: RankInfo = {
      rating,
      tier: tierFor(rating),
      wins: before.wins + (result === "win" ? 1 : 0),
      losses: before.losses + (result === "loss" ? 1 : 0),
      history: [{ at: Date.now(), opponent, result, delta: d }, ...before.history].slice(0, 20),
    };
    local.set(keyFor(player), JSON.stringify(after));
    return { before, after, delta: d };
  }
}

export class ApiRankService implements RankService {
  getRank(player: string): Promise<RankInfo> {
    return communityRequest(`/api/ranks?player=${encodeURIComponent(player)}`);
  }

  preview(rating: number, opponentRating: number) {
    return { win: delta(rating, opponentRating, 1), loss: delta(rating, opponentRating, 0) };
  }

  /** Compatibility for older battle views: only the server can record a win. */
  async recordResult(player: string, _opponent: string, _opponentRating: number, _result: "win" | "loss" | "draw") {
    const rank = await this.getRank(player);
    return { before: rank, after: rank, delta: 0 };
  }
}

export const getLeaderboard = () => communityRequest<Leaderboard>("/api/leaderboard");
export const rankService: RankService = new ApiRankService();
