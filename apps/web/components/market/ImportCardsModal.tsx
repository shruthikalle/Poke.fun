"use client";

import { useState } from "react";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { FreeCardButton } from "./FreeCardButton";
import { Modal } from "./Modal";
import styles from "./market.module.css";

/** "Add your cards": wallet cards in approved collections appear on their own, so this re-checks the wallet. */
export function ImportCardsModal({ market, onClose }: { market: Marketplace; onClose: () => void }) {
  const [checking, setChecking] = useState(false);
  const count = market.myCards.length;
  const where = market.me ? `${market.me.slice(0, 4)}…${market.me.slice(-4)}` : "your wallet";
  return (
    <Modal title="Add your cards" onClose={onClose}>
      <div className={styles.listForm}>
        <h3>Your wallet is your collection</h3>
        <p className={styles.mutedNote}>Cards in approved devnet collections that your signed-in wallet holds show up in My Cards on their own. Buying or trading moves them straight into your wallet.</p>
        <p className={styles.mutedNote}>{count ? `${count} ${count === 1 ? "card" : "cards"} found in ${where}.` : `No approved cards in ${where} yet. Claim a free one below or buy one in the Marketplace.`}</p>
        <div className={styles.actionsRow}>
          <FreeCardButton market={market} />
          <button className="pf-btn" disabled={checking} onClick={async () => { setChecking(true); await market.refresh(); setChecking(false); }}>{checking ? "Checking…" : "Check my wallet again"}</button>
          <button className="pf-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
