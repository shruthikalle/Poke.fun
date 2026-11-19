"use client";

import { address, type Address, type Instruction } from "@solana/kit";
import { findCatalogEntry } from "../cards/mapping";
import {
  approvedPda, authorityPda, computeLimitIx, configPda, coreAccounts, CORE_PROGRAM, listingPda, marketIx, offerPda, rpc,
  sendAndConfirm, SYSTEM_PROGRAM, toLamports, toSolNumber, tradePda, type TransactionSender,
} from "./program";
import { BALANCE_EVENT } from "./useWalletSolBalance";
import type { Card, Listing, MarketplaceService, MarketResult, MarketState, Offer, OfferAnswer, PricePoint, Seller, Trade } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const POLL_MS = 5_000;

// ----------------------------------------------------------- index wire types

interface IndexedCard { mint: string; owner: string; collection: string; name: string; image?: string; attributes: { trait_type: string; value: string }[] | null }
interface IndexedListing { id: string; mint: string; seller: string; price: number; status: Listing["status"]; listedAt: number; soldPrice?: number; buyer?: string; soldAt?: number }
interface IndexedOffer { id: string; listingId: string; mint: string; buyer: string; amount: number; counter?: number; status: Offer["status"]; createdAt: number }
interface IndexedTrade { id: string; proposer: string; counterparty: string; give: string[]; want: string[]; addLamports: number; status: Trade["status"]; createdAt: number }
interface IndexedSale { mint: string; seller: string; buyer: string; price: number; at: number }
export interface Onboarding { mint: boolean; faucet: boolean; faucetLamports?: number; collection?: string; mintsPerDay?: number }
export interface MarketIndex {
  ready: boolean; warning?: string; programId: string; onboarding?: Onboarding;
  config: { admin: string; treasury: string; feeBps: number; paused: boolean } | null;
  collections: string[]; cards: IndexedCard[]; listings: IndexedListing[]; offers: IndexedOffer[]; trades: IndexedTrade[]; sales: IndexedSale[];
}

const EMPTY: MarketState = { cards: {}, owners: {}, listings: [], offers: [], trades: [], sellers: {}, ready: false };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const attr = (c: IndexedCard, name: string) => c.attributes?.find((a) => a.trait_type === name)?.value;

function toCard(c: IndexedCard): Card {
  const set = attr(c, "Set") ?? "Unknown set";
  const number = attr(c, "Card Number") ?? "";
  const entry = findCatalogEntry(set, number);
  const name = attr(c, "Card Name") ?? entry?.name ?? c.name;
  return {
    mint: c.mint, name, set: entry?.setName ?? set, number, rarity: entry?.rarity ?? "Promo",
    grade: attr(c, "Grade") ?? "Ungraded", imageUri: c.image || entry?.image || "", origin: "Poke.fun devnet test collection",
  };
}

/** Converts the Go index into the UI's `MarketState`. Lamports become SOL numbers for display only. */
export function toMarketState(index: MarketIndex, names: Record<string, string>): MarketState {
  const cards: Record<string, Card> = {};
  const owners: Record<string, string> = {};
  const collectionOf: Record<string, string> = {};
  index.cards.forEach((c) => { cards[c.mint] = toCard(c); owners[c.mint] = c.owner; collectionOf[c.mint] = c.collection; });

  const sales = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const see = (a: string, at: number) => { if (a && (!firstSeen.has(a) || at < firstSeen.get(a)!)) firstSeen.set(a, at); };
  index.sales.forEach((s) => { sales.set(s.seller, (sales.get(s.seller) ?? 0) + 1); see(s.seller, s.at); see(s.buyer, s.at); });
  index.listings.forEach((l) => see(l.seller, l.listedAt));
  const sellers: Record<string, Seller> = {};
  const seller = (a: string): Seller => (sellers[a] ??= {
    address: a, name: names[a] ?? short(a), sales: sales.get(a) ?? 0,
    memberSince: String(new Date(firstSeen.get(a) ?? Date.now()).getFullYear()),
  });
  Object.values(owners).forEach(seller);

  const listings: Listing[] = index.listings.filter((l) => cards[l.mint]).map((l) => ({
    id: l.id, card: cards[l.mint], seller: seller(l.seller), priceSol: toSolNumber(l.price), status: l.status, listedAt: l.listedAt,
    soldPriceSol: l.soldPrice ? toSolNumber(l.soldPrice) : undefined, buyer: l.buyer, soldAt: l.soldAt,
  }));
  const offers: Offer[] = index.offers.map((o) => {
    seller(o.buyer);
    return { id: o.id, listingId: o.listingId, from: o.buyer, priceSol: toSolNumber(o.amount), status: o.status, counterSol: o.counter ? toSolNumber(o.counter) : undefined, createdAt: o.createdAt };
  });
  const trades: Trade[] = index.trades.map((t) => {
    seller(t.proposer); seller(t.counterparty);
    return { id: t.id, from: t.proposer, to: t.counterparty, give: t.give, want: t.want, addSol: toSolNumber(t.addLamports), status: t.status, createdAt: t.createdAt };
  });
  return {
    cards, owners, listings, offers, trades, sellers, ready: index.ready, warning: index.warning,
    onboarding: { mint: !!index.onboarding?.mint, faucet: !!index.onboarding?.faucet, faucetSol: toSolNumber(index.onboarding?.faucetLamports ?? 0), mintsPerDay: index.onboarding?.mintsPerDay ?? 0 },
  };
}

const fail = (error: unknown, fallback = "Something went wrong. Try again."): { ok: false; error: string } => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/reject|denied|cancel/i.test(message)) return { ok: false, error: "You cancelled the transaction." };
  return { ok: false, error: message || fallback };
};

/**
 * Devnet marketplace backed by the `pokefun_market` program. Reads come from the Go
 * index (`/api/market`); every write is a wallet-signed transaction. No balances are
 * held here: purchases and offers pay from the wallet's real devnet SOL.
 */
export class ChainMarketplaceService implements MarketplaceService {
  private index: MarketIndex | null = null;
  private state: MarketState = EMPTY;
  private listeners = new Set<() => void>();
  private names: Record<string, string> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private sender: TransactionSender | null = null;

  /** Wallet signer for the signed-in account; null signs nothing. */
  setSender(sender: TransactionSender | null) { this.sender = sender; }

  snapshot() { return this.state; }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  start() {
    if (this.timer) return;
    void this.load();
    this.timer = setInterval(() => { if (this.listeners.size && document.visibilityState !== "hidden") void this.load(); }, POLL_MS);
  }

  private apply(index: MarketIndex) {
    this.index = index;
    this.state = toMarketState(index, this.names);
    this.listeners.forEach((l) => l());
  }
  private async load(method: "GET" | "POST" = "GET") {
    try {
      const response = await fetch(`${API_URL}/api/market${method === "POST" ? "/refresh" : ""}`, { method, cache: "no-store" });
      if (!response.ok) throw new Error(`Market index returned ${response.status}`);
      this.apply(await response.json() as MarketIndex);
    } catch (error) {
      if (!this.index) {
        this.state = { ...EMPTY, warning: error instanceof Error ? error.message : "Market index unavailable" };
        this.listeners.forEach((l) => l());
      }
    }
  }

  async refresh() { await this.load("POST"); }

  setDisplayName(address: string, name: string) {
    if (name && name !== "You" && this.names[address] !== name) {
      this.names[address] = name;
      if (this.index) this.apply(this.index);
    }
  }

  valueOf(mint: string): number {
    const active = this.state.listings.find((l) => l.card.mint === mint && l.status === "active");
    if (active) return active.priceSol;
    const sale = this.index?.sales.filter((s) => s.mint === mint).at(-1);
    return sale ? toSolNumber(sale.price) : 0;
  }

  /** Real sales only, oldest first. */
  priceHistory(mint: string, days = 90): PricePoint[] {
    const since = Date.now() - days * 86_400_000;
    return (this.index?.sales ?? []).filter((s) => s.mint === mint && s.at >= since).map((s) => ({ t: s.at, priceSol: toSolNumber(s.price) }));
  }

  // ------------------------------------------------------------ helpers

  private card(mint: string) {
    const card = this.index?.cards.find((c) => c.mint === mint);
    if (!card) throw new Error("This card isn't in an approved collection.");
    return card;
  }
  private rawListing(id: string) {
    const listing = this.index?.listings.find((l) => l.id === id);
    if (!listing || listing.status !== "active") throw new Error("This listing is no longer available.");
    return listing;
  }
  private rawOffer(id: string) {
    const offer = this.index?.offers.find((o) => o.id === id);
    if (!offer) throw new Error("Offer not found.");
    return offer;
  }
  private rawTrade(id: string) {
    const trade = this.index?.trades.find((t) => t.id === id);
    if (!trade || trade.status !== "pending") throw new Error("This trade is no longer open.");
    return trade;
  }
  private treasury(): Address {
    const treasury = this.index?.config?.treasury;
    if (!treasury) throw new Error("The marketplace isn't initialized on this network yet.");
    return address(treasury);
  }
  private activeListingOf(mint: string) {
    return this.index?.listings.find((l) => l.mint === mint && l.status === "active");
  }

  private async cancelListingIx(mint: string, seller: string): Promise<Instruction> {
    const c = this.card(mint);
    return marketIx("cancel_listing", { seller: address(seller), listing: await listingPda(mint), ...(await coreAccounts(mint, c.collection)) });
  }

  /** Signs, sends, confirms, then asks the index to catch up. */
  private async run(signer: string, ixs: Instruction[]) {
    if (!this.sender) throw new Error("Sign in with Phantom or a Privy wallet to sign devnet transactions.");
    const signature = await sendAndConfirm(signer, ixs, this.sender);
    window.dispatchEvent(new Event(BALANCE_EVENT));
    await this.load("POST");
    return signature;
  }

  // ------------------------------------------------------------ actions

  /** POSTs to an onboarding endpoint; errors carry the server's message (e.g. a daily limit). */
  private async onboard<T>(path: "mint" | "faucet", owner: string): Promise<T> {
    const response = await fetch(`${API_URL}/api/market/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner }) });
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
  }

  /** Devnet SOL from the server's faucet wallet (the public RPC faucet is closed). Returns the new balance. */
  async addFunds(owner: string, _priceSol?: number): Promise<MarketResult<number>> {
    try {
      await this.onboard<{ lamports: number; signature: string }>("faucet", owner);
      window.dispatchEvent(new Event(BALANCE_EVENT));
      const { value } = await rpc.getBalance(address(owner), { commitment: "confirmed" }).send();
      return { ok: true, value: toSolNumber(value) };
    } catch (e) {
      return fail(e, "The devnet faucet is unavailable. Get test SOL at faucet.solana.com.");
    }
  }

  /** Mints a free devnet test card into the wallet (a few per day). */
  async claimFreeCard(owner: string): Promise<MarketResult<import("./types").MintedCard>> {
    try {
      const minted = await this.onboard<import("./types").MintedCard>("mint", owner);
      // Minting has already confirmed. A lagging index must not turn a successful
      // mint into an error that encourages the person to mint again.
      await this.load("POST").catch(() => {});
      return { ok: true, value: minted };
    } catch (e) { return fail(e, "Couldn't mint a card right now."); }
  }

  async buy(listingId: string, buyer: string): Promise<MarketResult<Listing>> {
    try {
      const l = this.rawListing(listingId);
      if (l.seller === buyer) return { ok: false, error: "This is your own listing." };
      const c = this.card(l.mint);
      await this.run(buyer, [marketIx("buy", {
        buyer: address(buyer), seller: address(l.seller), treasury: this.treasury(), listing: await listingPda(l.mint), ...(await coreAccounts(l.mint, c.collection)),
      }, { expected_price: BigInt(l.price) })]);
      const sold = this.state.listings.find((x) => x.id === listingId);
      return { ok: true, value: sold ?? { ...this.state.listings[0], status: "sold" } };
    } catch (e) { return fail(e); }
  }

  async list(mint: string, seller: string, priceSol: number): Promise<MarketResult<Listing>> {
    try {
      if (!(priceSol > 0)) return { ok: false, error: "Set a price above zero." };
      const c = this.card(mint);
      if (c.owner !== seller) return { ok: false, error: "You don't own this card." };
      await this.run(seller, [marketIx("list", {
        seller: address(seller), approved: await approvedPda(c.collection), listing: await listingPda(mint), ...(await coreAccounts(mint, c.collection)),
      }, { price: toLamports(priceSol) })]);
      const listing = this.state.listings.find((l) => l.card.mint === mint && l.status === "active");
      return listing ? { ok: true, value: listing } : { ok: false, error: "Listed. It will appear in a few seconds." };
    } catch (e) { return fail(e); }
  }

  async updatePrice(listingId: string, by: string, priceSol: number): Promise<MarketResult<Listing>> {
    try {
      if (!(priceSol > 0)) return { ok: false, error: "Set a price above zero." };
      const l = this.rawListing(listingId);
      await this.run(by, [marketIx("update_price", { seller: address(by), listing: await listingPda(l.mint) }, { price: toLamports(priceSol) })]);
      const updated = this.state.listings.find((x) => x.card.mint === l.mint && x.status === "active");
      return updated ? { ok: true, value: updated } : { ok: false, error: "Listing not found." };
    } catch (e) { return fail(e); }
  }

  async cancelListing(listingId: string, by: string): Promise<MarketResult<void>> {
    try {
      const l = this.rawListing(listingId);
      await this.run(by, [await this.cancelListingIx(l.mint, by)]);
      return { ok: true, value: undefined };
    } catch (e) { return fail(e); }
  }

  async makeOffer(listingId: string, from: string, priceSol: number): Promise<MarketResult<Offer>> {
    try {
      if (!(priceSol > 0)) return { ok: false, error: "Enter an amount above zero." };
      const l = this.rawListing(listingId);
      await this.run(from, [marketIx("make_offer", {
        buyer: address(from), config: await configPda(), listing: await listingPda(l.mint), offer: await offerPda(l.mint, from), system_program: SYSTEM_PROGRAM,
      }, { amount: toLamports(priceSol) })]);
      const offer = this.state.offers.find((o) => o.from === from && o.listingId === listingId && (o.status === "pending" || o.status === "countered"));
      return offer ? { ok: true, value: offer } : { ok: false, error: "Offer sent. It will appear in a few seconds." };
    } catch (e) { return fail(e); }
  }

  async respondOffer(offerId: string, by: string, answer: OfferAnswer): Promise<MarketResult<Offer>> {
    try {
      const o = this.rawOffer(offerId);
      const l = this.activeListingOf(o.mint);
      if (!l || l.seller !== by) return { ok: false, error: "This card is no longer for sale." };
      const listing = await listingPda(o.mint);
      const offer = await offerPda(o.mint, o.buyer);
      let ix: Instruction;
      if (answer.action === "accept") {
        ix = marketIx("accept_offer", { seller: address(by), buyer: address(o.buyer), treasury: this.treasury(), listing, offer, ...(await coreAccounts(o.mint, this.card(o.mint).collection)) });
      } else if (answer.action === "decline") {
        ix = marketIx("decline_offer", { seller: address(by), listing, buyer: address(o.buyer), offer });
      } else {
        if (!(answer.priceSol > toSolNumber(o.amount))) return { ok: false, error: "A counter should be above their offer." };
        ix = marketIx("counter_offer", { seller: address(by), listing, offer }, { counter: toLamports(answer.priceSol) });
      }
      await this.run(by, [ix]);
      const status: Offer["status"] = answer.action === "accept" ? "accepted" : answer.action === "decline" ? "declined" : "countered";
      return { ok: true, value: this.state.offers.find((x) => x.id === offerId) ?? { ...this.toOffer(o), status } };
    } catch (e) { return fail(e); }
  }

  async acceptCounter(offerId: string, by: string): Promise<MarketResult<Offer>> {
    try {
      const o = this.rawOffer(offerId);
      if (!o.counter || o.buyer !== by) return { ok: false, error: "There's no counter to accept." };
      const l = this.activeListingOf(o.mint);
      if (!l) return { ok: false, error: "This card is no longer for sale." };
      await this.run(by, [marketIx("accept_counter", {
        buyer: address(by), seller: address(l.seller), treasury: this.treasury(), listing: await listingPda(o.mint), offer: await offerPda(o.mint, by),
        ...(await coreAccounts(o.mint, this.card(o.mint).collection)),
      }, { expected_counter: BigInt(o.counter) })]);
      return { ok: true, value: { ...this.toOffer(o), status: "accepted" } };
    } catch (e) { return fail(e); }
  }

  async cancelOffer(offerId: string, by: string): Promise<MarketResult<void>> {
    try {
      const o = this.rawOffer(offerId);
      await this.run(by, [marketIx("cancel_offer", { buyer: address(by), offer: await offerPda(o.mint, by) })]);
      return { ok: true, value: undefined };
    } catch (e) { return fail(e); }
  }

  private toOffer(o: IndexedOffer): Offer {
    return { id: o.id, listingId: o.listingId, from: o.buyer, priceSol: toSolNumber(o.amount), status: o.status, counterSol: o.counter ? toSolNumber(o.counter) : undefined, createdAt: o.createdAt };
  }

  /** Listed give cards are delisted in the same transaction, so the trade can freeze them. */
  async proposeTrade(input: Omit<Trade, "id" | "status" | "createdAt">): Promise<MarketResult<Trade>> {
    try {
      if (!input.give.length && !input.addSol) return { ok: false, error: "Add at least one card or an amount." };
      if (!input.want.length) return { ok: false, error: "Pick a card you want." };
      if (input.give.length > 3 || input.want.length > 3) return { ok: false, error: "Trades can include up to 3 cards on each side." };
      const cards = [...input.give, ...input.want].map((m) => this.card(m));
      const collection = cards[0].collection;
      if (cards.some((c) => c.collection !== collection)) return { ok: false, error: "All cards in a trade must be from the same collection." };
      if (input.give.some((m) => this.card(m).owner !== input.from)) return { ok: false, error: "You can only trade cards you own." };
      if (input.want.some((m) => this.card(m).owner !== input.to)) return { ok: false, error: "That card changed hands." };

      const nonce = BigInt(Date.now());
      const trade = await tradePda(input.from, nonce);
      const delist = await Promise.all(input.give.filter((m) => this.activeListingOf(m)?.seller === input.from).map((m) => this.cancelListingIx(m, input.from)));
      await this.run(input.from, [computeLimitIx(800_000), ...delist, marketIx("propose_trade", {
        proposer: address(input.from), counterparty: address(input.to), config: await configPda(), approved: await approvedPda(collection), collection: address(collection),
        trade, authority: await authorityPda(), core_program: CORE_PROGRAM, system_program: SYSTEM_PROGRAM,
      }, { nonce, give_count: input.give.length, add_lamports: toLamports(input.addSol) }, [...input.give, ...input.want].map((m) => address(m)))]);
      return { ok: true, value: this.state.trades.find((t) => t.id === trade) ?? { ...input, id: trade, status: "pending", createdAt: Date.now() } };
    } catch (e) { return fail(e); }
  }

  private async closeTradeAccounts(t: IndexedTrade, caller: string) {
    const collection = this.card(t.want[0] ?? t.give[0]).collection;
    return {
      caller: address(caller), proposer: address(t.proposer), config: await configPda(), trade: address(t.id), collection: address(collection),
      authority: await authorityPda(), core_program: CORE_PROGRAM, system_program: SYSTEM_PROGRAM,
    };
  }

  async respondTrade(tradeId: string, by: string, accept: boolean): Promise<MarketResult<Trade>> {
    try {
      const t = this.rawTrade(tradeId);
      if (t.counterparty !== by) return { ok: false, error: "Trade not found." };
      const accounts = await this.closeTradeAccounts(t, by);
      if (accept) {
        if (t.want.some((m) => this.card(m).owner !== by)) return { ok: false, error: "You no longer own that card." };
        const delist = await Promise.all(t.want.filter((m) => this.activeListingOf(m)?.seller === by).map((m) => this.cancelListingIx(m, by)));
        const { caller: _caller, ...rest } = accounts;
        await this.run(by, [computeLimitIx(800_000), ...delist, marketIx("accept_trade", { ...rest, counterparty: address(by) }, {}, [...t.give, ...t.want].map((m) => address(m)))]);
      } else {
        await this.run(by, [computeLimitIx(600_000), marketIx("decline_trade", accounts, {}, t.give.map((m) => address(m)))]);
      }
      const done = this.state.trades.find((x) => x.id === tradeId);
      return { ok: true, value: done ?? { id: t.id, from: t.proposer, to: t.counterparty, give: t.give, want: t.want, addSol: toSolNumber(t.addLamports), status: accept ? "accepted" : "declined", createdAt: t.createdAt } };
    } catch (e) { return fail(e); }
  }

  async cancelTrade(tradeId: string, by: string): Promise<MarketResult<void>> {
    try {
      const t = this.rawTrade(tradeId);
      if (t.proposer !== by) return { ok: false, error: "Trade not found." };
      await this.run(by, [computeLimitIx(600_000), marketIx("cancel_trade", await this.closeTradeAccounts(t, by), {}, t.give.map((m) => address(m)))]);
      return { ok: true, value: undefined };
    } catch (e) { return fail(e); }
  }
}

export const chainMarketplaceService = new ChainMarketplaceService();
