"use client";

import { useCurrency } from "../../lib/market/currency";
import type { Card } from "../../lib/market/types";
import { CardArt } from "./CardArt";
import styles from "./market.module.css";

export function CardTile({ card, priceSol, note, onOpen, children }: { card: Card; priceSol: number | null; note?: string; onOpen: () => void; children?: React.ReactNode }) {
  const { format } = useCurrency();
  return (
    <article className={styles.tile}>
      <button className={styles.tileMain} onClick={onOpen} aria-label={`${card.name}, ${card.grade}${priceSol != null ? `, ${format(priceSol)}` : ""}`}>
        <CardArt card={card} size="md" />
        <span className={styles.tileName}>{card.name}</span>
        <span className={styles.tileMeta}>{card.set} · {card.grade}</span>
        <span className={styles.tilePrice}>{priceSol != null ? format(priceSol) : <i>{note ?? "Not listed"}</i>}</span>
      </button>
      {children && <div className={styles.tileActions}>{children}</div>}
    </article>
  );
}
