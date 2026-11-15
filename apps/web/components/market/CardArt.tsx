import type { Card } from "../../lib/market/types";
import styles from "./market.module.css";

export function hiRes(uri: string) { return uri.replace(/\.png$/, "_hires.png"); }

/** Glow tier for the slab frame, from the printed rarity. */
export function rarityTier(rarity: string): "base" | "holo" | "ultra" | "secret" {
  if (/secret|hyper|special illustration|gold|rainbow/i.test(rarity)) return "secret";
  if (/ultra|illustration|vmax|vstar|ex\b|gx|double rare|radiant|amazing|shiny/i.test(rarity)) return "ultra";
  if (/holo|rare/i.test(rarity)) return "holo";
  return "base";
}

/** Graded-slab style frame around the card scan. */
export function CardArt({ card, size = "md" }: { card: Card; size?: "sm" | "md" | "lg" }) {
  return (
    <figure className={styles.slab} data-size={size} data-tier={rarityTier(card.rarity)}>
      <figcaption className={styles.slabLabel}>
        <span>{card.grade.split(" ")[0]}</span>
        <b>{card.grade.split(" ")[1]}</b>
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={size === "lg" ? hiRes(card.imageUri) : card.imageUri} alt={`${card.name}, ${card.set} #${card.number}`} loading="lazy" />
    </figure>
  );
}
