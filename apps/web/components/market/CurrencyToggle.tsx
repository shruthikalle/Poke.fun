"use client";

import { useCurrency, type Currency } from "../../lib/market/currency";
import styles from "./market.module.css";

/** Global display-currency switch. Prices are stored in SOL and shown in USD when a live SOL/USD quote is available. */
export function CurrencyToggle() {
  const { currency, setCurrency, usdPerSol } = useCurrency();
  return (
    <div className={styles.currency} role="radiogroup" aria-label="Show prices in">
      {(["USD", "SOL"] as Currency[]).map((c) => (
        <button key={c} className="pf-chip" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)}
          disabled={c === "USD" && !usdPerSol} title={c === "USD" && !usdPerSol ? "SOL price unavailable; showing SOL" : undefined}>{c}</button>
      ))}
    </div>
  );
}
