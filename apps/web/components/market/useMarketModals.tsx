"use client";

import { useState } from "react";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { CardDetailModal } from "./CardDetailModal";
import { ListCardModal } from "./ListCardModal";
import { TradeModal } from "./TradeModal";

type Open = { kind: "detail"; mint: string } | { kind: "list"; mint: string } | { kind: "trade"; want?: string; give?: string } | null;

/** Shared modal stack for the marketplace pages. */
export function useMarketModals(market: Marketplace) {
  const { connected, signIn } = useWallet();
  const [open, setOpen] = useState<Open>(null);
  const needAccount = (next: Open) => (connected ? setOpen(next) : signIn({ onSignedIn: () => setOpen(next) }));
  const close = () => setOpen(null);

  const api = {
    detail: (mint: string) => setOpen({ kind: "detail", mint }),
    list: (mint: string) => needAccount({ kind: "list", mint }),
    trade: (opts: { want?: string; give?: string }) => needAccount({ kind: "trade", ...opts }),
  };

  const node = open?.kind === "detail" ? <CardDetailModal mint={open.mint} market={market} onClose={close} onTrade={(want) => api.trade({ want })} onTradeAway={(give) => api.trade({ give })} onList={api.list} />
    : open?.kind === "list" ? <ListCardModal mint={open.mint} market={market} onClose={close} />
    : open?.kind === "trade" ? <TradeModal market={market} wantMint={open.want} giveMint={open.give} onClose={close} />
    : null;

  return { ...api, node };
}
