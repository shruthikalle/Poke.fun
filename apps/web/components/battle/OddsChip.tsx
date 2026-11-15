import type { MarketOdds } from "../../lib/markets/useOdds";
import type { Side } from "../../lib/battle/types";
import styles from "./battle.module.css";

export function OddsChip({ odds, side }: { odds: MarketOdds | null; side: Side }) {
  if (!odds) return null;
  const pct = Math.round(odds.probability[side] * 100);
  const delta = odds.delta[side];
  const trend = Math.abs(delta) < 0.005 ? "" : delta > 0 ? "▲" : "▼";
  return (
    <span className={styles.odds} data-trend={delta > 0 ? "up" : delta < 0 ? "down" : undefined} title="Spectators' predicted chance to win">
      {pct}% win{trend && <i>{trend}</i>}
    </span>
  );
}
