"use client";

import { useRef } from "react";
import { Emblem } from "../../../components/Emblem";
import { explorerTx } from "../../../lib/sol/wagerClient";
import { useFocusTrap } from "../../../lib/useFocusTrap";
import type { PaidQueueState } from "../hooks/usePaidLoadoutQueue";
import styles from "../loadout.module.css";

interface Props {
  queue: PaidQueueState;
  error: string | null;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onRecover: () => void;
  onRetry: () => void;
}

export function PaidQueueDialog({ queue, error, busy, onApprove, onCancel, onRecover, onRetry }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, queue.status !== "idle");
  if (queue.status === "idle") return null;
  const ticket = queue.ticket;
  const found = queue.status === "found";
  const stage = ticket.status;
  const amount = ticket.stakeLamports / 1_000_000_000;
  return <div ref={ref} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Devnet SOL matchmaking">
    <div className={`pf-panel ${styles.matchBox}`}>
      <div className={styles.radar}><Emblem size={56} /></div>
      <p className="pf-eyebrow">{found ? "Match funded" : "Devnet SOL match"}</p>
      <h2>{found ? `Matched with ${ticket.opponent ?? "another player"}`
        : stage === "open_required" ? "Opponent found · deposit your SOL"
        : stage === "join_required" ? "Join the funded match"
        : stage === "cancel_required" ? "Opponent left · refund your deposit"
        : stage === "awaiting_open" || stage === "awaiting_join" ? "Waiting for the other deposit…"
        : "Waiting for an equal-tier opponent…"}</h2>
      <p className={styles.hint} role="status">{amount} Devnet SOL per player · {amount * 2} SOL pot. Battle starts after both deposits are confirmed.</p>
      {!found && ["open_required", "join_required"].includes(stage) && <button className="pf-btn" data-variant="primary" disabled={busy}
        onClick={onApprove}>{busy ? "Confirming on Solana…" : `Approve ${amount} SOL in Phantom`}</button>}
      {ticket.openTx && <a href={explorerTx(ticket.openTx)} target="_blank" rel="noopener noreferrer">View first deposit on Solana ↗</a>}
      {ticket.joinTx && <a href={explorerTx(ticket.joinTx)} target="_blank" rel="noopener noreferrer">View second deposit on Solana ↗</a>}
      {error && <p className={styles.warn} role="alert">{error}</p>}
      {queue.status === "searching" && queue.stale && <button className="pf-btn" onClick={onRetry} disabled={busy}>Retry queue status</button>}
      {queue.status === "searching" && ticket.wager && <button className="pf-btn" data-variant="ghost" onClick={onRecover} disabled={busy}>Recover after escrow deadline</button>}
      {queue.status === "searching" && <button className="pf-btn" data-variant="ghost" onClick={onCancel} disabled={busy}>{ticket.wager ? "Cancel and refund" : "Cancel search"}</button>}
    </div>
  </div>;
}
