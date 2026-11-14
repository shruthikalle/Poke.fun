"use client";

import { useCurrency, type Currency } from "../../lib/market/currency";
import styles from "./market.module.css";

/** Global display-currency switch. Prices are stored in SOL and shown in USD by default. */
export function CurrencyToggle() {
  const { currency, setCurrency } = useCurrency();
  return (
    <div className={styles.currency} role="radiogroup" aria-label="Show prices in">
      {(["USD", "SOL"] as Currency[]).map((c) => (
        <button key={c} role="radio" aria-checked={currency === c} data-on={currency === c || undefined} onClick={() => setCurrency(c)}>{c}</button>
      ))}
    </div>
  );
}
