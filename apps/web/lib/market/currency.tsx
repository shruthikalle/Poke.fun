"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { local } from "../storage";
import { useSolPrice } from "./useSolPrice";

export type Currency = "USD" | "SOL";

interface CurrencyValue {
  /** Display currency in effect: SOL whenever no SOL/USD quote is available. */
  currency: Currency;
  setCurrency(c: Currency): void;
  /** Null until a live quote arrives. */
  usdPerSol: number | null;
  /** Formats a SOL amount in the selected display currency. */
  format(priceSol: number, options?: { compact?: boolean }): string;
  /** Converts a display-currency amount (what the person typed) to SOL. */
  /** Formats a USD-denominated amount (match entries, winnings) in the selected display currency. */
  formatUsd(amountUsd: number): string;
  toSol(amount: number): number;
  fromSol(priceSol: number): number;
}

const KEY = "pf:currency";
const Ctx = createContext<CurrencyValue | null>(null);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [chosen, setState] = useState<Currency>("USD");
  const { usdPerSol } = useSolPrice();
  const currency: Currency = usdPerSol ? chosen : "SOL";
  useEffect(() => { if (local.get(KEY) === "SOL") setState("SOL"); }, []);
  const setCurrency = useCallback((c: Currency) => { setState(c); local.set(KEY, c); }, []);

  const value = useMemo<CurrencyValue>(() => ({
    currency,
    setCurrency,
    usdPerSol,
    format: (priceSol, options) => {
      if (currency === "SOL" || !usdPerSol) return `${priceSol.toLocaleString("en-US", { maximumFractionDigits: priceSol < 10 ? 3 : 2 })} SOL`;
      const amount = priceSol * usdPerSol;
      return (options?.compact && amount >= 1000 ? usdCompact : usd).format(amount);
    },
    formatUsd: (amountUsd) => {
      if (amountUsd === 0) return "Free";
      if (currency === "SOL" && usdPerSol) return `${(amountUsd / usdPerSol).toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`;
      return `$${amountUsd % 1 === 0 ? amountUsd : amountUsd.toFixed(2)}`;
    },
    toSol: (amount) => (currency === "SOL" || !usdPerSol ? amount : amount / usdPerSol),
    fromSol: (priceSol) => (currency === "SOL" || !usdPerSol ? priceSol : priceSol * usdPerSol),
  }), [currency, setCurrency, usdPerSol]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrency must be used inside <CurrencyProvider>");
  return ctx;
}

export function Price({ sol, compact, className }: { sol: number; compact?: boolean; className?: string }) {
  const { format } = useCurrency();
  return <span className={className}>{format(sol, { compact })}</span>;
}
