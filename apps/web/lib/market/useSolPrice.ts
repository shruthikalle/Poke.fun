"use client";

import { useEffect, useState } from "react";

/** Live SOL/USD quote; `usdPerSol` is null until one arrives (or while the source is down). */
export interface SolPrice { usdPerSol: number | null; change24h: number; updatedAt: number }

export interface SolPriceSource { current(): SolPrice; subscribe(listener: (p: SolPrice) => void): () => void }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const STALE_MS = 10 * 60_000;

/** SOL/USD from the Go API (cached CoinGecko quote). Drops to "unavailable" if no quote for 10 minutes. */
class ApiSolPriceSource implements SolPriceSource {
  private price: SolPrice = { usdPerSol: null, change24h: 0, updatedAt: 0 };
  private listeners = new Set<(p: SolPrice) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  current() { return this.price; }

  subscribe(listener: (p: SolPrice) => void) {
    this.listeners.add(listener);
    if (!this.timer) { void this.load(); this.timer = setInterval(() => void this.load(), 60_000); }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) { clearInterval(this.timer); this.timer = null; }
    };
  }

  private set(price: SolPrice) {
    this.price = price;
    this.listeners.forEach((l) => l(price));
  }

  private async load() {
    try {
      const response = await fetch(`${API_URL}/api/market/sol-price`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const quote = await response.json() as { usd: number; change24h: number; at: number };
      if (!(quote.usd > 0)) throw new Error("invalid quote");
      this.set({ usdPerSol: Math.round(quote.usd * 100) / 100, change24h: Math.round(quote.change24h * 100) / 100, updatedAt: quote.at });
    } catch {
      if (this.price.usdPerSol !== null && Date.now() - this.price.updatedAt > STALE_MS) this.set({ usdPerSol: null, change24h: 0, updatedAt: 0 });
    }
  }
}

export const solPriceSource: SolPriceSource = new ApiSolPriceSource();

export function useSolPrice(source: SolPriceSource = solPriceSource): SolPrice {
  const [price, setPrice] = useState(() => source.current());
  useEffect(() => source.subscribe(setPrice), [source]);
  return price;
}
