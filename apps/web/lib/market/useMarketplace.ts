"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { marketplaceService } from "./mockMarketplace";
import { useWalletSolBalance } from "./useWalletSolBalance";
import type { Card, ImportSource, Listing, MarketplaceService, MarketResult, OfferAnswer, Trade } from "./types";

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
  const walletBalanceSol = useWalletSolBalance(me);
  useEffect(() => { if (me) service.ensureAccount(me, playerName ?? "You"); }, [service, me, playerName]);

  const derived = useMemo(() => {
    const active = state.listings.filter((l) => l.status === "active");
    const myCards = me ? Object.values(state.cards).filter((c) => state.owners[c.mint] === me).sort((a, b) => (state.imports[b.mint]?.at ?? 0) - (state.imports[a.mint]?.at ?? 0)) : [];
    const myListingIds = new Set(me ? state.listings.filter((l) => l.seller.address === me).map((l) => l.id) : []);
    const incomingOffers = state.offers.filter((o) => myListingIds.has(o.listingId));
    const incomingTrades = me ? state.trades.filter((t) => t.to === me) : [];
    return {
      active,
      myCards,
      myListings: me ? active.filter((l) => l.seller.address === me) : [],
      myOffers: me ? state.offers.filter((o) => o.from === me) : [],
      incomingOffers,
      incomingTrades,
      pendingCount: incomingOffers.filter((o) => o.status === "pending").length + incomingTrades.filter((t) => t.status === "pending").length,
      sales: me ? state.listings.filter((l) => l.status === "sold" && l.seller.address === me) : [],
      purchases: me ? state.listings.filter((l) => l.status === "sold" && l.buyer === me) : [],
      importOf: (mint: string) => state.imports[mint] ?? null,
      listingById: (id: string) => state.listings.find((l) => l.id === id),
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
    walletBalanceSol,
    ...derived,
    priceHistory: service.priceHistory.bind(service),
    valueOf: service.valueOf.bind(service),
    addFunds: (priceSol: number) => guard((m) => service.addFunds(m, priceSol)),
    buy: (listingId: string) => guard((m) => service.buy(listingId, m)),
    list: (mint: string, priceSol: number) => guard((m) => service.list(mint, m, priceSol)),
    updatePrice: (listingId: string, priceSol: number) => guard((m) => service.updatePrice(listingId, m, priceSol)),
    respondOffer: (offerId: string, answer: OfferAnswer) => guard((m) => service.respondOffer(offerId, m, answer)),
    respondTrade: (tradeId: string, accept: boolean) => guard((m) => service.respondTrade(tradeId, m, accept)),
    importCards: (cards: Card[], source: ImportSource) => guard((m) => service.importCards(m, cards, source)),
    cancelListing: (listingId: string) => guard((m) => service.cancelListing(listingId, m)),
    makeOffer: (listingId: string, priceSol: number) => guard((m) => service.makeOffer(listingId, m, priceSol)),
    proposeTrade: (input: Omit<Trade, "id" | "status" | "createdAt" | "from">) => guard((m) => service.proposeTrade({ ...input, from: m })),
  };
}

export type Marketplace = ReturnType<typeof useMarketplace>;
