"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { marketplaceService } from "./mockMarketplace";
import type { Listing, MarketplaceService, MarketResult, Trade } from "./types";

const SIGN_IN_FIRST = { ok: false as const, error: "Sign in to continue." };

/** Marketplace state and actions for the signed-in person. Backed by `MarketplaceService` (mock today). */
export function useMarketplace(service: MarketplaceService = marketplaceService) {
  const { address, connected, playerName, signIn } = useWallet();
  const [state, setState] = useState(() => service.snapshot());

  useEffect(() => {
    const off = service.subscribe(() => setState(service.snapshot()));
    service.restore();
    setState(service.snapshot());
    return off;
  }, [service]);

  const me = connected ? address : null;
  useEffect(() => { if (me) service.ensureAccount(me, playerName ?? "You"); }, [service, me, playerName]);

  const derived = useMemo(() => {
    const active = state.listings.filter((l) => l.status === "active");
    const myCards = me ? Object.values(state.cards).filter((c) => state.owners[c.mint] === me) : [];
    return {
      active,
      myCards,
      myListings: me ? active.filter((l) => l.seller.address === me) : [],
      myOffers: me ? state.offers.filter((o) => o.from === me) : [],
      myTrades: me ? state.trades.filter((t) => t.from === me || t.to === me) : [],
      balanceSol: me ? state.balances[me] ?? 0 : 0,
      listingFor: (mint: string): Listing | undefined => active.find((l) => l.card.mint === mint),
      ownerOf: (mint: string) => state.sellers[state.owners[mint]] ?? null,
    };
  }, [state, me]);

  const guard = useCallback(<T,>(run: (me: string) => Promise<MarketResult<T>>): Promise<MarketResult<T>> => {
    if (!me) { signIn(); return Promise.resolve(SIGN_IN_FIRST); }
    return run(me);
  }, [me, signIn]);

  return {
    state,
    me,
    ...derived,
    priceHistory: service.priceHistory.bind(service),
    valueOf: service.valueOf.bind(service),
    addFunds: (priceSol: number) => guard((m) => service.addFunds(m, priceSol)),
    buy: (listingId: string) => guard((m) => service.buy(listingId, m)),
    list: (mint: string, priceSol: number) => guard((m) => service.list(mint, m, priceSol)),
    cancelListing: (listingId: string) => guard((m) => service.cancelListing(listingId, m)),
    makeOffer: (listingId: string, priceSol: number) => guard((m) => service.makeOffer(listingId, m, priceSol)),
    proposeTrade: (input: Omit<Trade, "id" | "status" | "createdAt" | "from">) => guard((m) => service.proposeTrade({ ...input, from: m })),
  };
}

export type Marketplace = ReturnType<typeof useMarketplace>;
