"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { chainMarketplaceService } from "./chainMarketplace";
import { useWalletSolBalance } from "./useWalletSolBalance";
import type { Listing, MarketplaceService, MarketResult, OfferAnswer, Trade } from "./types";

const SIGN_IN_FIRST = { ok: false as const, error: "Sign in to continue." };

/** Marketplace state and actions for the signed-in person: the devnet `pokefun_market` program via the Go index. */
export function useMarketplace(service: MarketplaceService = chainMarketplaceService) {
  const { address, connected, playerName, signIn, sendTransaction } = useWallet();
  useEffect(() => { service.setSender(sendTransaction); }, [service, sendTransaction]);
  const [state, setState] = useState(() => service.snapshot());

  useEffect(() => {
    const off = service.subscribe(() => setState(service.snapshot()));
    service.start();
    setState(service.snapshot());
    return off;
  }, [service]);

  const me = connected ? address : null;
  const walletBalanceSol = useWalletSolBalance(me);
  useEffect(() => { if (me && playerName) service.setDisplayName(me, playerName); }, [service, me, playerName]);

  const derived = useMemo(() => {
    const active = state.listings.filter((l) => l.status === "active");
    const myCards = me ? Object.values(state.cards).filter((c) => state.owners[c.mint] === me).sort((a, b) => a.name.localeCompare(b.name)) : [];
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
      pendingCount: incomingOffers.filter((o) => o.status === "pending" && state.listings.some((l) => l.id === o.listingId && l.status === "active")).length
        + incomingTrades.filter((t) => t.status === "pending").length
        + (me ? state.offers.filter((o) => o.from === me && o.status === "countered").length : 0),
      sales: me ? state.listings.filter((l) => l.status === "sold" && l.seller.address === me) : [],
      purchases: me ? state.listings.filter((l) => l.status === "sold" && l.buyer === me) : [],
      listingById: (id: string) => state.listings.find((l) => l.id === id),
      myTrades: me ? state.trades.filter((t) => t.from === me || t.to === me) : [],
      balanceSol: me ? walletBalanceSol ?? 0 : 0,
      listingFor: (mint: string): Listing | undefined => active.find((l) => l.card.mint === mint),
      ownerOf: (mint: string) => state.sellers[state.owners[mint]] ?? null,
    };
  }, [state, me, walletBalanceSol]);

  const guard = useCallback(<T,>(run: (me: string) => Promise<MarketResult<T>>): Promise<MarketResult<T>> => {
    if (!me) { signIn(); return Promise.resolve(SIGN_IN_FIRST); }
    return run(me);
  }, [me, signIn]);

  return {
    state,
    me,
    /** True when the connected wallet is ready to sign transactions. */
    canSign: !!sendTransaction,
    walletBalanceSol,
    ...derived,
    priceHistory: service.priceHistory.bind(service),
    valueOf: service.valueOf.bind(service),
    addFunds: (priceSol?: number) => guard((m) => service.addFunds(m, priceSol)),
    claimFreeCard: () => guard((m) => service.claimFreeCard(m)),
    buy: (listingId: string) => guard((m) => service.buy(listingId, m)),
    list: (mint: string, priceSol: number) => guard((m) => service.list(mint, m, priceSol)),
    updatePrice: (listingId: string, priceSol: number) => guard((m) => service.updatePrice(listingId, m, priceSol)),
    respondOffer: (offerId: string, answer: OfferAnswer) => guard((m) => service.respondOffer(offerId, m, answer)),
    respondTrade: (tradeId: string, accept: boolean) => guard((m) => service.respondTrade(tradeId, m, accept)),
    refresh: () => service.refresh(),
    cancelListing: (listingId: string) => guard((m) => service.cancelListing(listingId, m)),
    makeOffer: (listingId: string, priceSol: number) => guard((m) => service.makeOffer(listingId, m, priceSol)),
    acceptCounter: (offerId: string) => guard((m) => service.acceptCounter(offerId, m)),
    cancelOffer: (offerId: string) => guard((m) => service.cancelOffer(offerId, m)),
    cancelTrade: (tradeId: string) => guard((m) => service.cancelTrade(tradeId, m)),
    proposeTrade: (input: Omit<Trade, "id" | "status" | "createdAt" | "from">) => guard((m) => service.proposeTrade({ ...input, from: m })),
  };
}

export type Marketplace = ReturnType<typeof useMarketplace>;
