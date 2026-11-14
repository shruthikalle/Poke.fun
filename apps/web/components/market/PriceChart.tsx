"use client";

import { useMemo } from "react";
import { useCurrency } from "../../lib/market/currency";
import type { PricePoint } from "../../lib/market/types";
import styles from "./market.module.css";

export function PriceChart({ points }: { points: PricePoint[] }) {
  const { format } = useCurrency();
  const W = 360, H = 110, P = 6;
  const { path, area, min, max, change } = useMemo(() => {
    const vals = points.map((p) => p.priceSol);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const xy = points.map((p, i) => [P + (i / (points.length - 1)) * (W - 2 * P), H - P - ((p.priceSol - min) / span) * (H - 2 * P)] as const);
    const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${path}L${W - P},${H - P}L${P},${H - P}Z`;
    return { path, area, min, max, change: (vals[vals.length - 1] - vals[0]) / vals[0] };
  }, [points]);
  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <span>Price history · 90 days</span>
        <b data-tone={change >= 0 ? "up" : "down"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(1)}%</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Price ranged from ${format(min)} to ${format(max)}`}>
        <path d={area} fill="rgba(52, 99, 168, .12)" />
        <path d={path} fill="none" stroke="#3463a8" strokeWidth="1.6" />
      </svg>
      <div className={styles.chartFoot}><span>Low {format(min)}</span><span>High {format(max)}</span></div>
    </div>
  );
}
