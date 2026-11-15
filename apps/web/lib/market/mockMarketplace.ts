import { CARD_CATALOG, type CatalogEntry } from "../cards/mapping";
import { local } from "../storage";
import { MARKET_FEE, type Card, type ImportSource, type Listing, type MarketplaceService, type MarketResult, type MarketState, type Offer, type OfferAnswer, type PricePoint, type Seller, type Trade } from "./types";

const STORE_KEY = "pf:market:v2";
const REF_USD_PER_SOL = 152;
const STARTER_BALANCE_SOL = 6;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(text: string) { let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function fakeAddress(seed: string) { const r = rng(hash(seed)); return Array.from({ length: 44 }, () => B58[Math.floor(r() * B58.length)]).join(""); }

const RARITY_USD: Record<string, number> = {
  "Rare Holo": 260, "Rare": 70, "Uncommon": 28, "Common": 18, "Illustration Rare": 120, "Special Illustration Rare": 340, "Double Rare": 45,
  "Ultra Rare": 90, "Hyper Rare": 210, "Trainer Gallery Rare Holo": 60, "Rare Holo V": 55, "Rare Holo VMAX": 110, "Rare Holo VSTAR": 75, "Rare Secret": 180,
};
const SET_MULT: Record<string, number> = { "Base Set": 2.4, Jungle: 1.3, Fossil: 1.4, "151": 1, "Crown Zenith Galarian Gallery": 1.1 };
export const GRADES: { grade: string; mult: number }[] = [
  { grade: "PSA 10", mult: 3.2 }, { grade: "PSA 9", mult: 1.5 }, { grade: "BGS 9.5", mult: 2.1 }, { grade: "CGC 9.5", mult: 1.7 }, { grade: "PSA 8", mult: 1 }, { grade: "CGC 9", mult: 1.2 },
];
const STAR_SPECIES = new Set(["charizard", "blastoise", "venusaur", "mewtwo", "mew", "pikachu", "gengar", "dragonite", "gyarados", "alakazam", "zapdos", "moltres", "articuno", "snorlax", "lapras", "eevee", "umbreon", "espeon"]);

const SELLERS: Seller[] = [
  ["VaultKeeper", 4.9, 412, "2023"], ["MintConditionMo", 4.8, 233, "2024"], ["HoloHunter", 4.7, 158, "2023"], ["GradedGwen", 5, 96, "2024"],
  ["SlabCity", 4.6, 301, "2022"], ["KantoCollects", 4.9, 77, "2025"], ["PSAPete", 4.8, 189, "2023"], ["ShinyShelf", 4.5, 54, "2025"],
].map(([name, rating, sales, since]) => ({ address: fakeAddress(`seller:${name}`), name: name as string, rating: rating as number, sales: sales as number, memberSince: since as string }));

export function makeCard(entry: CatalogEntry, grade: string, salt: string): Card {
  return {
    mint: fakeAddress(`mint:${entry.id}:${salt}`), name: entry.name, set: entry.setName, number: entry.number, rarity: entry.rarity ?? "Promo", grade,
    imageUri: entry.image, vaultBacked: true, origin: "Collector's Crypt",
  };
}

export function estimateSol(card: Card): number {
  const base = RARITY_USD[card.rarity] ?? 40;
  const grade = GRADES.find((g) => g.grade === card.grade)?.mult ?? 1;
  const star = STAR_SPECIES.has(card.name.toLowerCase().split(" ")[0]) ? 2.2 : 1;
  const usd = base * (SET_MULT[card.set] ?? 1) * grade * star;
  return Math.round((usd / REF_USD_PER_SOL) * 1000) / 1000;
}

function seed(): MarketState {
  const r = rng(1794);
  const entries = Object.values(CARD_CATALOG.entries);
  const notable = entries.filter((e) => e.rarity && !["Common", "Uncommon"].includes(e.rarity));
  const shuffle = <T>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const picks = shuffle(notable).slice(0, 54).concat(shuffle(entries.filter((e) => e.rarity === "Uncommon")).slice(0, 10));
  const state: MarketState = { cards: {}, owners: {}, listings: [], offers: [], trades: [], sellers: {}, balances: {}, imports: {} };
  SELLERS.forEach((s) => { state.sellers[s.address] = s; state.balances[s.address] = 200; });
  const now = Date.now();
  picks.forEach((entry, i) => {
    const grade = GRADES[Math.floor(r() * GRADES.length)].grade;
    const card = makeCard(entry, grade, String(i));
    const seller = SELLERS[Math.floor(r() * SELLERS.length)];
    state.cards[card.mint] = card;
    state.owners[card.mint] = seller.address;
    if (i % 9 === 8) return; // owned but not listed, still tradeable
    const ask = Math.round(estimateSol(card) * (0.9 + r() * 0.35) * 1000) / 1000;
    state.listings.push({ id: `l-${i}`, card, seller, priceSol: ask, status: "active", listedAt: now - Math.floor(r() * 21 * 86400_000) });
  });
  return state;
}

export class MockMarketplaceService implements MarketplaceService {
  private state: MarketState;
  private listeners = new Set<() => void>();

  private restored = false;

  constructor() { this.state = seed(); }

  /** Loads the saved demo state. Called after hydration so server and client first render the same seed. */
  restore() {
    if (this.restored) return;
    this.restored = true;
    try { const saved = local.get(STORE_KEY); if (saved) this.commit(JSON.parse(saved) as MarketState); } catch { /* keep seed */ }
  }

  snapshot() { return this.state; }
  reset() { local.remove(STORE_KEY); this.commit(seed()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private commit(next: MarketState) {
    this.state = next;
    local.set(STORE_KEY, JSON.stringify(next));
    this.listeners.forEach((l) => l());
  }
  private wait(ms = 500) { return new Promise((r) => setTimeout(r, ms)); }

  /** New accounts start with a welcome credit and no cards; they buy or bring in their own. */
  ensureAccount(address: string, name: string) {
    const existing = this.state.sellers[address];
    if (existing) {
      if (existing.name === "You" && name !== "You") this.commit({ ...this.state, sellers: { ...this.state.sellers, [address]: { ...existing, name } } });
      return;
    }
    this.commit({
      ...this.state,
      sellers: { ...this.state.sellers, [address]: { address, name, rating: 5, sales: 0, memberSince: String(new Date().getFullYear()) } },
      balances: { ...this.state.balances, [address]: STARTER_BALANCE_SOL },
    });
  }

  private isPerson(address: string) { return !SELLERS.some((s) => s.address === address); }

  /** Value used for trade/offer decisions: the active ask, else an estimate. */
  valueOf(mint: string): number {
    const listing = this.state.listings.find((l) => l.card.mint === mint && l.status === "active");
    const card = this.state.cards[mint];
    return listing?.priceSol ?? (card ? estimateSol(card) : 0);
  }

  priceHistory(mint: string, days = 90): PricePoint[] {
    const r = rng(hash(`history:${mint}`));
    const end = this.valueOf(mint);
    const points: PricePoint[] = [];
    let p = end * (0.7 + r() * 0.25);
    const now = Date.now();
    for (let d = days; d >= 0; d -= 3) {
      p = Math.max(0.05, p * (1 + (r() - 0.46) * 0.08));
      points.push({ t: now - d * 86400_000, priceSol: Math.round(p * 1000) / 1000 });
    }
    points[points.length - 1] = { t: now, priceSol: end };
    return points;
  }

  private transfer(state: MarketState, mint: string, from: string, to: string, priceSol: number) {
    state.owners = { ...state.owners, [mint]: to };
    state.balances = { ...state.balances, [to]: round((state.balances[to] ?? 0) - priceSol), [from]: round((state.balances[from] ?? 0) + priceSol * (1 - MARKET_FEE)) };
    const seller = state.sellers[from];
    if (seller) state.sellers = { ...state.sellers, [from]: { ...seller, sales: seller.sales + 1 } };
  }

  async addFunds(address: string, priceSol: number): Promise<MarketResult<number>> {
    await this.wait(600);
    if (!(priceSol > 0)) return { ok: false, error: "Enter an amount above zero." };
    const balance = round((this.state.balances[address] ?? 0) + priceSol);
    this.commit({ ...this.state, balances: { ...this.state.balances, [address]: balance } });
    return { ok: true, value: balance };
  }

  async buy(listingId: string, buyer: string): Promise<MarketResult<Listing>> {
    await this.wait(700);
    const listing = this.state.listings.find((l) => l.id === listingId);
    if (!listing || listing.status !== "active") return { ok: false, error: "This card was just sold." };
    if (listing.seller.address === buyer) return { ok: false, error: "This is your own listing." };
    if ((this.state.balances[buyer] ?? 0) < listing.priceSol) return { ok: false, error: "Not enough balance for this card." };
    const next = { ...this.state };
    this.transfer(next, listing.card.mint, listing.seller.address, buyer, listing.priceSol);
    const sold: Listing = { ...listing, status: "sold", soldPriceSol: listing.priceSol, buyer, soldAt: Date.now() };
    next.listings = next.listings.map((l) => (l.id === listingId ? sold : l));
    this.commit(next);
    return { ok: true, value: sold };
  }

  async list(mint: string, seller: string, priceSol: number): Promise<MarketResult<Listing>> {
    await this.wait();
    if (this.state.owners[mint] !== seller) return { ok: false, error: "You don't own this card." };
    if (!(priceSol > 0)) return { ok: false, error: "Set a price above zero." };
    if (this.state.listings.some((l) => l.card.mint === mint && l.status === "active")) return { ok: false, error: "This card is already listed." };
    const listing: Listing = { id: `l-${Date.now()}`, card: this.state.cards[mint], seller: this.state.sellers[seller], priceSol: round(priceSol), status: "active", listedAt: Date.now() };
    this.commit({ ...this.state, listings: [listing, ...this.state.listings] });
    // Demo buyer: someone makes an offer on a person's listing a few seconds later.
    if (this.isPerson(seller)) setTimeout(() => this.incomingOffer(listing.id), 4500);
    return { ok: true, value: listing };
  }

  private incomingOffer(listingId: string) {
    const listing = this.state.listings.find((l) => l.id === listingId);
    if (!listing || listing.status !== "active" || this.state.offers.some((o) => o.listingId === listingId)) return;
    const r = rng(hash(`offer:${listingId}`));
    const buyer = SELLERS[Math.floor(r() * SELLERS.length)];
    const offer: Offer = { id: `o-${Date.now()}`, listingId, from: buyer.address, priceSol: round(Math.round(listing.priceSol * (0.86 + r() * 0.06) * 1000) / 1000), status: "pending", createdAt: Date.now() };
    this.commit({ ...this.state, offers: [offer, ...this.state.offers] });
  }

  async updatePrice(listingId: string, by: string, priceSol: number): Promise<MarketResult<Listing>> {
    await this.wait(400);
    const listing = this.state.listings.find((l) => l.id === listingId);
    if (!listing || listing.status !== "active" || listing.seller.address !== by) return { ok: false, error: "Listing not found." };
    if (!(priceSol > 0)) return { ok: false, error: "Set a price above zero." };
    const updated: Listing = { ...listing, priceSol: round(priceSol) };
    this.commit({ ...this.state, listings: this.state.listings.map((l) => (l.id === listingId ? updated : l)) });
    return { ok: true, value: updated };
  }

  async respondOffer(offerId: string, by: string, answer: OfferAnswer): Promise<MarketResult<Offer>> {
    await this.wait(600);
    const offer = this.state.offers.find((o) => o.id === offerId);
    const listing = offer && this.state.listings.find((l) => l.id === offer.listingId);
    if (!offer || !listing || listing.seller.address !== by) return { ok: false, error: "Offer not found." };
    if (offer.status !== "pending") return { ok: false, error: "You already answered this offer." };
    if (listing.status !== "active") return { ok: false, error: "This card is no longer for sale." };
    const next = { ...this.state };
    let updated: Offer;
    if (answer.action === "accept") {
      this.transfer(next, listing.card.mint, by, offer.from, offer.priceSol);
      next.listings = next.listings.map((l) => (l.id === listing.id ? { ...l, status: "sold", soldPriceSol: offer.priceSol, buyer: offer.from, soldAt: Date.now() } : l));
      updated = { ...offer, status: "accepted" };
    } else if (answer.action === "decline") {
      updated = { ...offer, status: "declined" };
    } else {
      if (!(answer.priceSol > offer.priceSol)) return { ok: false, error: "A counter should be above their offer." };
      updated = { ...offer, status: "countered", counterSol: round(answer.priceSol) };
      // Demo buyer: takes counters up to 97% of the asking price.
      setTimeout(() => this.resolveCounter(offerId), 2500);
    }
    next.offers = next.offers.map((o) => (o.id === offerId ? updated : o));
    this.commit(next);
    return { ok: true, value: updated };
  }

  private resolveCounter(offerId: string) {
    const offer = this.state.offers.find((o) => o.id === offerId);
    const listing = offer && this.state.listings.find((l) => l.id === offer.listingId);
    if (!offer || offer.status !== "countered" || !offer.counterSol) return;
    const next = { ...this.state };
    const accept = !!listing && listing.status === "active" && offer.counterSol <= listing.priceSol * 0.97;
    if (accept && listing) {
      this.transfer(next, listing.card.mint, listing.seller.address, offer.from, offer.counterSol);
      next.listings = next.listings.map((l) => (l.id === listing.id ? { ...l, status: "sold", soldPriceSol: offer.counterSol, buyer: offer.from, soldAt: Date.now() } : l));
    }
    next.offers = next.offers.map((o) => (o.id === offerId ? { ...o, status: accept ? "accepted" : "declined" } : o));
    this.commit(next);
  }

  async cancelListing(listingId: string, by: string): Promise<MarketResult<void>> {
    await this.wait(300);
    const listing = this.state.listings.find((l) => l.id === listingId);
    if (!listing || listing.seller.address !== by) return { ok: false, error: "Listing not found." };
    this.commit({ ...this.state, listings: this.state.listings.map((l) => (l.id === listingId ? { ...l, status: "cancelled" } : l)) });
    return { ok: true, value: undefined };
  }

  async makeOffer(listingId: string, from: string, priceSol: number): Promise<MarketResult<Offer>> {
    await this.wait();
    const listing = this.state.listings.find((l) => l.id === listingId);
    if (!listing || listing.status !== "active") return { ok: false, error: "This listing is no longer available." };
    if ((this.state.balances[from] ?? 0) < priceSol) return { ok: false, error: "Not enough balance for this offer." };
    const offer: Offer = { id: `o-${Date.now()}`, listingId, from, priceSol: round(priceSol), status: "pending", createdAt: Date.now() };
    this.commit({ ...this.state, offers: [offer, ...this.state.offers] });
    // Demo seller: accepts offers within 10% of the ask after a short pause.
    setTimeout(() => this.resolveOffer(offer.id), 1800);
    return { ok: true, value: offer };
  }

  private resolveOffer(id: string) {
    const offer = this.state.offers.find((o) => o.id === id);
    const listing = offer && this.state.listings.find((l) => l.id === offer.listingId);
    if (!offer || offer.status !== "pending") return;
    const accept = !!listing && listing.status === "active" && offer.priceSol >= listing.priceSol * 0.9 && (this.state.balances[offer.from] ?? 0) >= offer.priceSol;
    const next = { ...this.state };
    if (accept && listing) {
      this.transfer(next, listing.card.mint, listing.seller.address, offer.from, offer.priceSol);
      next.listings = next.listings.map((l) => (l.id === listing.id ? { ...l, status: "sold", soldPriceSol: offer.priceSol, buyer: offer.from, soldAt: Date.now() } : l));
    }
    next.offers = next.offers.map((o) => (o.id === id ? { ...o, status: accept ? "accepted" : "declined" } : o));
    this.commit(next);
  }

  async proposeTrade(input: Omit<Trade, "id" | "status" | "createdAt">): Promise<MarketResult<Trade>> {
    await this.wait();
    if (!input.give.length && !input.addSol) return { ok: false, error: "Add at least one card or an amount." };
    if (!input.want.length) return { ok: false, error: "Pick a card you want." };
    if (input.give.some((m) => this.state.owners[m] !== input.from)) return { ok: false, error: "You can only trade cards you own." };
    if (input.want.some((m) => this.state.owners[m] !== input.to)) return { ok: false, error: "That card changed hands." };
    if ((this.state.balances[input.from] ?? 0) < input.addSol) return { ok: false, error: "Not enough balance to add that amount." };
    const trade: Trade = { ...input, addSol: round(input.addSol), id: `t-${Date.now()}`, status: "pending", createdAt: Date.now() };
    this.commit({ ...this.state, trades: [trade, ...this.state.trades] });
    // Demo counterparty: accepts if what's offered is worth at least 95% of what's asked.
    setTimeout(() => this.resolveTrade(trade.id), 2000);
    return { ok: true, value: trade };
  }

  private resolveTrade(id: string) {
    const trade = this.state.trades.find((t) => t.id === id);
    if (!trade || trade.status !== "pending") return;
    const offered = trade.give.reduce((s, m) => s + this.valueOf(m), 0) + trade.addSol;
    const asked = trade.want.reduce((s, m) => s + this.valueOf(m), 0);
    const stillOwned = trade.give.every((m) => this.state.owners[m] === trade.from) && trade.want.every((m) => this.state.owners[m] === trade.to);
    const accept = stillOwned && offered >= asked * 0.95 && (this.state.balances[trade.from] ?? 0) >= trade.addSol;
    if (accept) { this.settleTrade(trade); return; }
    this.commit({ ...this.state, trades: this.state.trades.map((t) => (t.id === id ? { ...t, status: "declined" } : t)) });
  }
  async respondTrade(tradeId: string, by: string, accept: boolean): Promise<MarketResult<Trade>> {
    await this.wait(600);
    const trade = this.state.trades.find((t) => t.id === tradeId);
    if (!trade || trade.to !== by) return { ok: false, error: "Trade not found." };
    if (trade.status !== "pending") return { ok: false, error: "You already answered this trade." };
    if (accept && !trade.want.every((m) => this.state.owners[m] === by)) return { ok: false, error: "You no longer own that card." };
    if (accept) return this.settleTrade(trade);
    const declined: Trade = { ...trade, status: "declined" };
    this.commit({ ...this.state, trades: this.state.trades.map((t) => (t.id === tradeId ? declined : t)) });
    return { ok: true, value: declined };
  }

  private settleTrade(trade: Trade): MarketResult<Trade> {
    const next = { ...this.state, owners: { ...this.state.owners } };
    trade.give.forEach((m) => { next.owners[m] = trade.to; });
    trade.want.forEach((m) => { next.owners[m] = trade.from; });
    next.balances = { ...next.balances, [trade.from]: round((next.balances[trade.from] ?? 0) - trade.addSol), [trade.to]: round((next.balances[trade.to] ?? 0) + trade.addSol) };
    const moved = new Set([...trade.give, ...trade.want]);
    next.listings = next.listings.map((l) => (moved.has(l.card.mint) && l.status === "active" ? { ...l, status: "cancelled" } : l));
    const done: Trade = { ...trade, status: "accepted" };
    next.trades = next.trades.map((t) => (t.id === trade.id ? done : t));
    this.commit(next);
    return { ok: true, value: done };
  }

  async importCards(owner: string, cards: Card[], source: ImportSource): Promise<MarketResult<Card[]>> {
    await this.wait(900);
    if (!this.state.sellers[owner]) return { ok: false, error: "Sign in first." };
    const fresh = cards.filter((c) => !this.state.cards[c.mint]);
    if (!fresh.length) return { ok: false, error: "These cards are already in your collection." };
    const next = { ...this.state, cards: { ...this.state.cards }, owners: { ...this.state.owners }, imports: { ...this.state.imports } };
    const at = Date.now();
    fresh.forEach((c) => { next.cards[c.mint] = c; next.owners[c.mint] = owner; next.imports[c.mint] = { source, at, by: owner }; });
    this.commit(next);
    // Demo collector: proposes a trade for one of the new cards a few seconds later.
    setTimeout(() => this.incomingTrade(owner, fresh.map((c) => c.mint)), 6000);
    return { ok: true, value: fresh };
  }

  private incomingTrade(owner: string, mints: string[]) {
    if (this.state.trades.some((t) => t.to === owner && t.status === "pending")) return;
    const mine = mints.filter((m) => this.state.owners[m] === owner).sort((a, b) => this.valueOf(b) - this.valueOf(a));
    const want = mine[0];
    if (!want) return;
    const target = this.valueOf(want);
    const theirs = Object.keys(this.state.owners)
      .filter((m) => !this.isPerson(this.state.owners[m]) && !this.state.listings.some((l) => l.card.mint === m && l.status === "active"))
      .map((m) => ({ m, v: this.valueOf(m) }))
      .filter((x) => x.v <= target * 1.05)
      .sort((a, b) => b.v - a.v)[0];
    if (!theirs) return;
    const from = this.state.owners[theirs.m];
    const addSol = round(Math.max(0, target * 1.04 - theirs.v));
    const trade: Trade = { id: `t-${Date.now()}`, from, to: owner, give: [theirs.m], want: [want], addSol, status: "pending", createdAt: Date.now() };
    this.commit({ ...this.state, trades: [trade, ...this.state.trades] });
  }
}

function round(n: number) { return Math.round(n * 1e6) / 1e6; }

export const marketplaceService = new MockMarketplaceService();
