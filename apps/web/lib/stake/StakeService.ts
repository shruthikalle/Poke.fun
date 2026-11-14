export interface StakeQuote { entry: number; winnerTakes: number }
export interface StakeReceipt { matchId: string; entry: number; status: "held" | "free" }
export interface Settlement { matchId: string; result: "win" | "loss" | "draw"; payout: number }

export interface StakeService {
  quote(entry: number): StakeQuote;
  deposit(matchId: string, entry: number): Promise<StakeReceipt>;
  settle(matchId: string, entry: number, result: "win" | "loss" | "draw"): Promise<Settlement>;
}

export const ENTRY_PRESETS = [0, 1, 5, 10, 25] as const;
export const MAX_ENTRY = 100;

export const formatDollars = (n: number) => (n === 0 ? "Free" : `$${n % 1 === 0 ? n : n.toFixed(2)}`);

/** TODO(escrow): replace with the devnet USDC escrow program. Real-money play needs legal review first. */
export class MockStakeService implements StakeService {
  quote(entry: number): StakeQuote {
    return { entry, winnerTakes: entry * 2 };
  }

  async deposit(matchId: string, entry: number): Promise<StakeReceipt> {
    await new Promise((r) => setTimeout(r, 200));
    return { matchId, entry, status: entry > 0 ? "held" : "free" };
  }

  async settle(matchId: string, entry: number, result: "win" | "loss" | "draw"): Promise<Settlement> {
    return { matchId, result, payout: result === "win" ? entry * 2 : result === "draw" ? entry : 0 };
  }
}

export const stakeService: StakeService = new MockStakeService();
