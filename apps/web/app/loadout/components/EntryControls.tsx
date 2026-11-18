"use client";

import { useState } from "react";
import type { MatchFormat } from "../../../lib/cards/mapping";
import styles from "../loadout.module.css";

interface Props {
  format: MatchFormat;
  entry: number;
  error: string | null;
  onEntry: (amount: number) => void;
  onError: (message: string | null) => void;
}

const PRESETS = [0, 0.01, 0.05, 0.1, 0.25] as const;
const label = (amount: number) => amount === 0 ? "Free" : `${amount} SOL`;

export function EntryControls({ format, entry, error, onEntry, onError }: Props) {
  const [custom, setCustom] = useState("");

  const setCustomEntry = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    const value = rest.length ? `${whole}.${rest.join("").slice(0, 3)}` : whole;
    setCustom(value);
    if (!value) { onError(null); onEntry(0); return; }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0.001) { onError("Minimum entry is 0.001 Devnet SOL"); return; }
    if (amount > 1) { onError("Maximum entry is 1 Devnet SOL"); return; }
    onError(null);
    onEntry(Math.round(amount * 1000) / 1000);
  };

  return <>
    <p className={styles.label}>Entry</p>
    {<>
      <div className={styles.chips}>
        {PRESETS.map((amount) => <button key={amount} className="pf-chip"
          data-on={entry === amount && !custom || undefined}
          onClick={() => { setCustom(""); onError(null); onEntry(amount); }}>{label(amount)}</button>)}
        <label className={`pf-input ${styles.custom}`} data-on={!!custom || undefined}>
          <span>SOL</span>
          <input inputMode="decimal" placeholder="0.000" value={custom}
            aria-label="Custom entry in Devnet SOL" aria-invalid={!!error || undefined}
            aria-describedby={error ? "entry-error" : undefined}
            onChange={(event) => setCustomEntry(event.target.value)} />
        </label>
      </div>
      {error && <p id="entry-error" className={styles.warn} role="alert">{error}</p>}
      <div className={styles.pot} hidden={!!error}>
        <span>{entry ? <><strong>{label(entry)}</strong> per player · {label(entry * 2)} pot</> : "Free live match"}</span>
        <em>{entry ? "Devnet test SOL · Phantom approval required" : "Free match · no transfers"}</em>
      </div>
    </>}
  </>;
}
