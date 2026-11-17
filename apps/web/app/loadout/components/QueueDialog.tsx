"use client";

import { useRef } from "react";
import { Emblem } from "../../../components/Emblem";
import { useCurrency } from "../../../lib/market/currency";
import { useFocusTrap } from "../../../lib/useFocusTrap";
import type { LoadoutQueue } from "../hooks/useLoadoutQueue";
import styles from "../loadout.module.css";

interface Props {
  queue: LoadoutQueue;
  entry: number;
  error: string | null;
  cancelling: boolean;
  onCancel: () => void;
  onRetry: () => void;
}

export function QueueDialog({ queue, entry, error, cancelling, onCancel, onRetry }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { formatUsd } = useCurrency();
  useFocusTrap(ref, queue.status !== "idle");
  if (queue.status === "idle") return null;
  const found = queue.status === "found";
  const amount = queue.status === "searching" && queue.ticket
    ? queue.ticket.entryCents / 100 : entry;

  return (
    <div ref={ref} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Matchmaking">
      <div className={`pf-panel ${styles.matchBox}`}>
        <div className={styles.radar}><Emblem size={56} /></div>
        <p className="pf-eyebrow">{found ? "Match found" : queue.status === "joining" ? "Entering queue" : "Finding a match"}</p>
        <h2>{found ? `Matched with ${queue.opponent}` : "Waiting for another player…"}</h2>
        <p className={styles.hint} role="status">
          {found ? "Opening the battle now." : <>
            {queue.format === "champion" ? "Champion 1v1" : "Squad of 3"} · {amount ? `${formatUsd(amount)} demo entry` : "Free match"}.
            {" "}Waiting for a player with the same format, power tier, and entry.
          </>}
        </p>
        {error && <>
          <p className={styles.warn} role="alert">{error}</p>
          <button className="pf-btn" onClick={onRetry} disabled={cancelling}>Retry queue status</button>
        </>}
        {queue.status === "searching" && <button className="pf-btn" data-variant="ghost"
          disabled={cancelling} onClick={onCancel}>{cancelling ? "Leaving queue…" : "Cancel search"}</button>}
      </div>
    </div>
  );
}
