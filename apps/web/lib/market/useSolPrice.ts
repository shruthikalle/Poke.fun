"use client";

import { useEffect, useState } from "react";

export interface SolPrice { usdPerSol: number; change24h: number; updatedAt: number }

/** Price feed seam. TODO(price-feed): replace with a real SOL/USD feed (e.g. Pyth or an exchange API). */
export interface SolPriceSource { current(): SolPrice; subscribe(listener: (p: SolPrice) => void): () => void }

class MockSolPriceSource implements SolPriceSource {
  private price: SolPrice = { usdPerSol: 152.4, change24h: 1.8, updatedAt: Date.now() };
  private listeners = new Set<(p: SolPrice) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  current() { return this.price; }

  subscribe(listener: (p: SolPrice) => void) {
    this.listeners.add(listener);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 15_000);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) { clearInterval(this.timer); this.timer = null; }
    };
  }

  private tick() {
    const drift = (Math.random() - 0.5) * 0.6;
    const usdPerSol = Math.round(Math.min(170, Math.max(135, this.price.usdPerSol + drift)) * 100) / 100;
    this.price = { usdPerSol, change24h: Math.round((this.price.change24h + drift / 4) * 100) / 100, updatedAt: Date.now() };
    this.listeners.forEach((l) => l(this.price));
  }
}

export const solPriceSource: SolPriceSource = new MockSolPriceSource();

export function useSolPrice(source: SolPriceSource = solPriceSource): SolPrice {
  const [price, setPrice] = useState(() => source.current());
  useEffect(() => source.subscribe(setPrice), [source]);
  return price;
}
