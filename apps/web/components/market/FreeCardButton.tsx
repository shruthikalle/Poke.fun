"use client";

import { useState } from "react";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { useShell } from "./MarketShell";

/** Mints a free devnet test card into the signed-in wallet. Hidden when the server doesn't offer minting. */
export function FreeCardButton({ market, primary = true, label = "Get a free card" }: { market: Marketplace; primary?: boolean; label?: string }) {
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  if (!market.state.onboarding?.mint) return null;
  const claim = async () => {
    setBusy(true);
    const r = await market.claimFreeCard();
    setBusy(false);
    if (r.ok) shell.toast(`You got ${r.value.name}! It will appear in My Cards shortly, ready to battle, list or trade.`);
    else if (market.me) shell.toast(r.error);
  };
  return (
    <button className="pf-btn" data-variant={primary ? "primary" : undefined} disabled={busy} onClick={() => void claim()}
      title={`Mints a devnet test card into your wallet (${market.state.onboarding.mintsPerDay} per day)`}>
      {busy ? "Minting…" : label}
    </button>
  );
}
