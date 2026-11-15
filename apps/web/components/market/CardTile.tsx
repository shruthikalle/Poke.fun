"use client";

import { useCurrency } from "../../lib/market/currency";
import type { Card } from "../../lib/market/types";
import { CardArt, rarityTier } from "./CardArt";
import styles from "./market.module.css";

export interface TileBadge { text: string; tone?: "gold" | "good" | "violet" }

export function CardTile({ card, priceSol, note, badges, listed, onOpen, children }: {
  card: Card; priceSol: number | null; note?: string; badges?: TileBadge[]; listed?: boolean; onOpen: () => void; children?: React.ReactNode;
}) {
  const { format } = useCurrency();
  return (
    <article className={`pf-frame ${styles.tile}`} data-tier={rarityTier(card.rarity)} data-listed={listed || undefined}>
      {!!badges?.length && <div className={styles.badges}>{badges.map((b) => <span key={b.text} className={styles.badge} data-tone={b.tone}>{b.text}</span>)}</div>}
      <button className={styles.tileMain} onClick={onOpen} aria-label={`${card.name}, ${card.grade}${priceSol != null ? `, ${format(priceSol)}` : ""}`}>
        <CardArt card={card} size="md" />
        <span className={styles.tileName}>{card.name}</span>
        <span className={styles.tileMeta}>{card.set} · {card.grade}</span>
        {priceSol != null ? <span className={styles.tilePrice}>{format(priceSol)}</span> : <span className={styles.tilePrice} data-muted>{note ?? "Not listed"}</span>}
      </button>
      {children && <div className={styles.tileActions}>{children}</div>}
    </article>
  );
}
