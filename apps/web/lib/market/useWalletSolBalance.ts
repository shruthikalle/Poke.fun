"use client";

import { useEffect, useState } from "react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/** The wallet's actual Devnet SOL, separate from marketplace demo credit. */
export function useWalletSolBalance(address: string | null): number | null {
  const [balance, setBalance] = useState<{ address: string; sol: number } | null>(null);

  useEffect(() => {
    if (!address) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
        });
        if (!response.ok) throw new Error(`RPC ${response.status}`);
        const data = await response.json() as { result?: { value?: number }; error?: unknown };
        if (data.error || typeof data.result?.value !== "number") throw new Error("Invalid balance response");
        if (active) setBalance({ address, sol: data.result.value / 1_000_000_000 });
      } catch {
        if (active) setBalance(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [address]);

  return address && balance?.address === address ? balance.sol : null;
}
