/** A physical-backed collectible held in vault storage (e.g. bought on Collector's Crypt). Devnet mint address. */
export interface Card {
  mint: string;
  name: string;
  set: string;
  number: string;
  rarity: string;
  /** Grader + grade, e.g. "PSA 10". */
  grade: string;
  imageUri: string;
  vaultBacked: true;
  /** Where the owner originally bought it. */
  origin: string;
}

export interface Seller {
  address: string;
  name: string;
  rating: number;
  sales: number;
  memberSince: string;
}

export type ListingStatus = "active" | "sold" | "cancelled";

export interface Listing {
  id: string;
  card: Card;
  seller: Seller;
  /** Stored in SOL (devnet); shown in USD by default. */
  priceSol: number;
  status: ListingStatus;
  listedAt: number;
  /** Set once sold. */
  soldPriceSol?: number;
  buyer?: string;
  soldAt?: number;
}

export type OfferStatus = "pending" | "countered" | "accepted" | "declined";

export interface Offer {
  id: string;
  listingId: string;
  from: string;
  priceSol: number;
  status: OfferStatus;
  /** Seller's counter price, when countered. */
  counterSol?: number;
  createdAt: number;
}

export type TradeStatus = "pending" | "accepted" | "declined";

export interface Trade {
  id: string;
  from: string;
  to: string;
  /** Cards the proposer gives. */
  give: string[];
  /** Cards the proposer wants. */
  want: string[];
  /** Extra currency the proposer adds, in SOL. */
  addSol: number;
  status: TradeStatus;
  createdAt: number;
}

/** Where an imported card came from. */
export type ImportSource = "collectors-crypt" | "phantom";

export interface ImportRecord { source: ImportSource; at: number }

export interface PricePoint { t: number; priceSol: number }

export interface MarketState {
  cards: Record<string, Card>;
  owners: Record<string, string>;
  listings: Listing[];
  offers: Offer[];
  trades: Trade[];
  sellers: Record<string, Seller>;
  balances: Record<string, number>;
  /** Cards people brought in from outside accounts, by item id. */
  imports: Record<string, ImportRecord>;
}

/** Share of the sale price the marketplace keeps. */
export const MARKET_FEE = 0.025;

export type OfferAnswer = { action: "accept" } | { action: "decline" } | { action: "counter"; priceSol: number };

export type MarketResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Marketplace seam. `MockMarketplaceService` runs in memory; swap in the devnet marketplace program client here.
 * TODO(marketplace-program): back these calls with the on-chain marketplace program on devnet.
 */
export interface MarketplaceService {
  snapshot(): MarketState;
  restore(): void;
  valueOf(mint: string): number;
  subscribe(listener: () => void): () => void;
  /** Makes sure an account exists (starter balance + cards in the demo). */
  ensureAccount(address: string, name: string): void;
  priceHistory(mint: string, days?: number): PricePoint[];
  /** Tops up an account balance. TODO(payments): card checkout / on-ramp. */
  addFunds(address: string, priceSol: number): Promise<MarketResult<number>>;
  buy(listingId: string, buyer: string): Promise<MarketResult<Listing>>;
  list(mint: string, seller: string, priceSol: number): Promise<MarketResult<Listing>>;
  updatePrice(listingId: string, by: string, priceSol: number): Promise<MarketResult<Listing>>;
  cancelListing(listingId: string, by: string): Promise<MarketResult<void>>;
  makeOffer(listingId: string, from: string, priceSol: number): Promise<MarketResult<Offer>>;
  /** Seller's answer to an offer on their listing. */
  respondOffer(offerId: string, by: string, answer: OfferAnswer): Promise<MarketResult<Offer>>;
  proposeTrade(input: Omit<Trade, "id" | "status" | "createdAt">): Promise<MarketResult<Trade>>;
  /** Answer to a trade someone proposed to you. */
  respondTrade(tradeId: string, by: string, accept: boolean): Promise<MarketResult<Trade>>;
  /** Adds cards found by a `CardImportService` to the owner's collection. */
  importCards(owner: string, cards: Card[], source: ImportSource): Promise<MarketResult<Card[]>>;
}
