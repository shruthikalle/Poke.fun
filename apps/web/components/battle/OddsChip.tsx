import type { MarketOdds } from "../../lib/markets/useOdds";
import type { Side } from "../../lib/battle/types";
import styles from "./battle.module.css";

export function OddsChip({ odds, side }: { odds: MarketOdds | null; side: Side }) {
  if (!odds) return null;
  const pct = Math.round(odds.probability[side] * 100);
  const hp = odds.source === "hp-heuristic";
  const label = hp ? "HP share" : odds.source === "mock" ? "demo estimate" : "market implied";
  const title = hp ? "Share of both teams' current normalized HP. HP heuristic only; not a win probability or market price." : odds.source === "mock" ? "Offline demo estimate from battle progress; no market data." : "Implied probability from the configured market provider.";
  return (
    <span className={styles.odds} title={title}>
      {pct}% {label}
    </span>
  );
}
