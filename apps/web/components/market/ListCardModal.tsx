"use client";

import { useState } from "react";
import { useCurrency } from "../../lib/market/currency";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { CardArt } from "./CardArt";
import { Modal } from "./Modal";
import styles from "./market.module.css";

const FEE = 0.025;

export function ListCardModal({ mint, market, onClose }: { mint: string; market: Marketplace; onClose: () => void }) {
  const { format, toSol, fromSol, currency } = useCurrency();
  const card = market.state.cards[mint];
  const estimate = market.valueOf(mint);
  const [price, setPrice] = useState(() => (currency === "SOL" ? fromSol(estimate).toFixed(2) : String(Math.round(fromSol(estimate)))));
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!card) return null;

  const amount = Number(price);
  const sol = amount > 0 ? toSol(amount) : 0;

  const confirm = async () => {
    setBusy(true); setError(null);
    const r = await market.list(mint, sol);
    setBusy(false);
    if (r.ok) setStep("done"); else setError(r.error);
  };

  return (
    <Modal title="List for sale" onClose={onClose}>
      <div className={styles.listLayout}>
        <CardArt card={card} size="sm" />
        <div className={styles.listForm}>
          <h3>{card.name}</h3>
          <p className={styles.mutedNote}>{card.set} · #{card.number} · {card.grade}</p>
          {step === "done" ? (
            <>
              <p className={styles.notice} data-tone="good" role="status">Listed for {format(sol)}. Buyers can find it in the Marketplace now.</p>
              <div className={styles.actionsRow}><button className="pf-btn" data-variant="primary" onClick={onClose}>Done</button></div>
            </>
          ) : step === "confirm" ? (
            <>
              <table className={styles.summary}><tbody>
                <tr><td>Price</td><td>{format(sol)}</td></tr>
                <tr><td>Marketplace fee (2.5%)</td><td>−{format(sol * FEE)}</td></tr>
                <tr><th>You receive</th><th>{format(sol * (1 - FEE))}</th></tr>
              </tbody></table>
              <p className={styles.mutedNote}>The card stays in the vault until it sells. You can remove the listing anytime.</p>
              {error && <p className={styles.notice} data-tone="bad" role="alert">{error}</p>}
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={busy} onClick={confirm}>{busy ? "Listing…" : "Confirm listing"}</button>
                <button className="pf-btn" disabled={busy} onClick={() => setStep("edit")}>Back</button>
              </div>
            </>
          ) : (
            <>
              <label className={styles.fieldLabel}>Price ({currency})
                <input className="pf-input" type="number" min="0" step={currency === "SOL" ? "0.01" : "1"} value={price} autoFocus onChange={(e) => setPrice(e.target.value)} />
              </label>
              <p className={styles.mutedNote}>Similar cards sell for about {format(estimate)}.</p>
              {sol > 0 && sol < estimate * 0.5 && <p className={styles.notice} data-tone="bad" role="alert">That&apos;s less than half what similar cards sell for. Double-check the price.</p>}
              {error && <p className={styles.notice} data-tone="bad" role="alert">{error}</p>}
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={!(amount > 0)} onClick={() => setStep("confirm")}>Review listing</button>
                <button className="pf-btn" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
