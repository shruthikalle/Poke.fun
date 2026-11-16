"use client";

import { useState } from "react";
import { useCurrency } from "../../../lib/market/currency";
import { ENTRY_PRESETS, MAX_ENTRY } from "../../../lib/stake/StakeService";
import styles from "../loadout.module.css";

interface Props {
  entry: number;
  error: string | null;
  onEntry: (amount: number) => void;
  onError: (message: string | null) => void;
}

/** Existing demo stake choices; no transfer or external wager integration. */
export function EntryControls({ entry, error, onEntry, onError }: Props) {
  const { formatUsd } = useCurrency();
  const [custom, setCustom] = useState("");

  const setCustomEntry = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    const value = rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
    setCustom(value);
    if (!value) {
      onError(null);
      onEntry(0);
      return;
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 1) {
      onError("Minimum demo entry is $1");
      return;
    }
    if (amount > MAX_ENTRY) {
      onError(`Maximum demo entry is $${MAX_ENTRY}`);
      return;
    }
    onError(null);
    onEntry(Math.round(amount * 100) / 100);
  };

  return (
    <>
      <p className={styles.label}>Entry</p>
      <div className={styles.chips}>
        {ENTRY_PRESETS.map((amount) => (
          <button key={amount} className="pf-chip" data-on={entry === amount && !custom || undefined}
            onClick={() => { setCustom(""); onError(null); onEntry(amount); }}>
            {formatUsd(amount)}
          </button>
        ))}
        <label className={`pf-input ${styles.custom}`} data-on={!!custom || undefined}>
          <span>$</span>
          <input inputMode="decimal" placeholder="0.00" value={custom}
            aria-label="Custom demo entry in dollars" aria-invalid={!!error || undefined}
            aria-describedby={error ? "entry-error" : undefined}
            onChange={(event) => setCustomEntry(event.target.value)} />
        </label>
      </div>
      {error && <p id="entry-error" className={styles.warn} role="alert">{error}</p>}
      <div className={styles.pot} hidden={!!error}>
        <span>{entry ? <>Demo entry <strong>{formatUsd(entry)}</strong> per player</> : "Free live match"}</span>
        <em>Demo only · no money or NFT transfers</em>
      </div>
    </>
  );
}
