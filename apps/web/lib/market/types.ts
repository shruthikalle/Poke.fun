/** A Metaplex Core card NFT in an approved collection. */
export interface Card {
  mint: string;
  name: string;
  set: string;
  number: string;
  rarity: string;
  /** Grader + grade from metadata, e.g. "PSA 10"; "Ungraded" when absent. */
  grade: string;
  imageUri: string;
  /** Collection the card was minted in. */
  origin: string;
}

export interface Seller {
  address: string;
  name: string;
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

export type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "cancelled" | "expired";

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

export type TradeStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

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

export interface PricePoint { t: number; priceSol: number }

export interface MarketState {
  cards: Record<string, Card>;
  owners: Record<string, string>;
  listings: Listing[];
  offers: Offer[];
  trades: Trade[];
  sellers: Record<string, Seller>;
  /** False until the index has loaded once. */
  ready: boolean;
  /** Index problem worth showing (e.g. API or RPC unavailable). */
  warning?: string;
}

/** Share of the sale price the marketplace keeps. */
export const MARKET_FEE = 0.025;

export type OfferAnswer = { action: "accept" } | { action: "decline" } | { action: "counter"; priceSol: number };

export type MarketResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Marketplace seam, implemented by `ChainMarketplaceService`: reads the Go index of the
 * `pokefun_market` program and signs devnet transactions with the person's wallet.
 */
export interface MarketplaceService {
  /** Wallet signer: signs and submits a serialized transaction, returning its signature. */
  setSender(sender: ((wireTransaction: Uint8Array) => Promise<string>) | null): void;
  snapshot(): MarketState;
  /** Starts loading and polling the index. */
  start(): void;
  /** Re-reads the index now (e.g. to pick up cards that just arrived in the wallet). */
  refresh(): Promise<void>;
  /** Active ask, else last sale; 0 when the card has never traded. */
  valueOf(mint: string): number;
  subscribe(listener: () => void): () => void;
  /** Display name for an address (the signed-in person's own name). */
  setDisplayName(address: string, name: string): void;
  /** Real sales only. */
  priceHistory(mint: string, days?: number): PricePoint[];
  /** Devnet faucet airdrop to the wallet; returns the new balance. */
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
  /** Buyer takes the seller's counter. */
  acceptCounter(offerId: string, by: string): Promise<MarketResult<Offer>>;
  /** Buyer withdraws an offer and gets the escrowed amount back. */
  cancelOffer(offerId: string, by: string): Promise<MarketResult<void>>;
  /** Proposer withdraws a trade; offered cards are released. */
  cancelTrade(tradeId: string, by: string): Promise<MarketResult<void>>;
}
