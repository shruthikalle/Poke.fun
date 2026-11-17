"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PaidTicket } from "../../../lib/sol/paidQueue";
import { cancelSolWager, joinSolWager, openSolWager, paidQueueApi, recoverExpiredWager } from "../../../lib/sol/wagerClient";
import { ARENA_SESSION_STORAGE_KEY } from "../../../lib/arena";
import { session as storage } from "../../../lib/storage";
import { errorMessage } from "./useLoadoutResource";

const PAID_QUEUE_KEY = "pokefun-paid-sol-queue";
type StoredTicket = PaidTicket & { player: string };
export type PaidQueueState = { status: "idle" } | { status: "searching"; ticket: PaidTicket; stale: boolean } | { status: "found"; ticket: PaidTicket };

export function usePaidLoadoutQueue(player: string | null, authToken: string | null, address: string | null) {
  const router = useRouter();
  const [queue, setQueue] = useState<PaidQueueState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryTx, setRecoveryTx] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const accept = useCallback((ticket: PaidTicket, owner: string) => {
    if (ticket.status === "cancelled") {
      storage.remove(PAID_QUEUE_KEY);
      setQueue({ status: "idle" });
      return;
    }
    storage.set(PAID_QUEUE_KEY, JSON.stringify({ ...ticket, player: owner }));
    if (ticket.status === "matched" && ticket.arena) {
      storage.set(ARENA_SESSION_STORAGE_KEY, JSON.stringify({ ...ticket.arena, player: owner, paidQueue: { id: ticket.id, token: ticket.token } }));
      storage.remove(PAID_QUEUE_KEY);
      setQueue({ status: "found", ticket });
    } else setQueue({ status: "searching", ticket, stale: false });
  }, []);

  useEffect(() => {
    if (!player) return;
    const raw = storage.get(PAID_QUEUE_KEY);
    if (!raw) return;
    try {
      const ticket = JSON.parse(raw) as StoredTicket;
      if (ticket.player !== player || !ticket.id || !ticket.token || !ticket.stakeLamports) throw new Error("Invalid saved queue");
      accept(ticket, player);
    } catch { storage.remove(PAID_QUEUE_KEY); }
  }, [player, accept]);

  useEffect(() => {
    if (queue.status !== "searching" || queue.stale || !authToken || !player) return;
    let active = true;
    const check = async () => {
      try {
        const ticket = await paidQueueApi.status(authToken, queue.ticket);
        if (active) accept(ticket, player);
      } catch (cause) {
        if (!active) return;
        const message = errorMessage(cause);
        setError(message.includes("ticket not found") ? "Match server lost this queue. Cancel your deposit with Phantom or recover it after the escrow deadline." : message);
        setQueue((current) => current.status === "searching" ? { ...current, stale: true } : current);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 900);
    return () => { active = false; clearInterval(timer); };
  }, [queue.status === "searching" ? queue.ticket.id : "", queue.status === "searching" ? queue.stale : false, authToken, player, retry, accept]);

  useEffect(() => {
    if (queue.status !== "found") return;
    const timer = setTimeout(() => router.push("/arena"), 750);
    return () => clearTimeout(timer);
  }, [queue, router]);

  const start = async (input: { name: string; cardId: string; assetId: string; rating: number; stakeLamports: number }) => {
    if (!authToken || !player || !address || queue.status !== "idle" || busy) return;
    setBusy(true); setError(null);
    try { accept(await paidQueueApi.enqueue(authToken, input), player); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (queue.status !== "searching" || !address || !authToken || !player || busy) return;
    const ticket = queue.ticket;
    setBusy(true); setError(null);
    try {
      if (ticket.status === "open_required") {
        const key = `pf:wager-open:${ticket.id}`;
        const pending = storage.get(key);
        const opened = pending ? JSON.parse(pending) as { wager: string; signature: string }
          : await openSolWager(address, ticket.stakeLamports);
        storage.set(key, JSON.stringify(opened));
        accept(await paidQueueApi.action(authToken, ticket, { action: "open", ...opened }), player);
        storage.remove(key);
      } else if (ticket.status === "join_required" && ticket.wager) {
        const key = `pf:wager-join:${ticket.id}`;
        const signature = storage.get(key) ?? await joinSolWager(address, ticket.wager);
        storage.set(key, signature);
        accept(await paidQueueApi.action(authToken, ticket, { action: "join", signature }), player);
        storage.remove(key);
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (queue.status !== "searching" || !address || !authToken || busy) return;
    const ticket = queue.ticket;
    setBusy(true); setError(null);
    try {
      const pendingJoin = storage.get(`pf:wager-join:${ticket.id}`);
      if (pendingJoin) {
        if (queue.stale) throw new Error("Your second deposit may already be on-chain. Recover it after the escrow deadline.");
        accept(await paidQueueApi.action(authToken, ticket, { action: "join", signature: pendingJoin }), player!);
        storage.remove(`pf:wager-join:${ticket.id}`);
        return;
      }
      const pendingKey = `pf:wager-open:${ticket.id}`;
      const pending = storage.get(pendingKey);
      const wager = ticket.wager ?? (pending ? (JSON.parse(pending) as { wager: string }).wager : null);
      if (wager && ["awaiting_join", "cancel_required", "open_required"].includes(ticket.status)) {
        await cancelSolWager(address, wager);
        if (ticket.wager) await paidQueueApi.action(authToken, ticket, { action: "cancel_onchain" }).catch(() => null);
        else await paidQueueApi.cancel(authToken, ticket).catch(() => null);
        storage.remove(pendingKey);
      } else if (!queue.stale) await paidQueueApi.cancel(authToken, ticket);
      storage.remove(PAID_QUEUE_KEY);
      setQueue({ status: "idle" });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const recover = async () => {
    if (queue.status !== "searching" || !queue.ticket.wager || !address || busy) return;
    setBusy(true); setError(null);
    try {
      const signature = await recoverExpiredWager(address, queue.ticket.wager);
      setRecoveryTx(signature);
      storage.remove(`pf:wager-join:${queue.ticket.id}`);
      storage.remove(PAID_QUEUE_KEY);
      setQueue({ status: "idle" });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  return { queue, error, busy, recoveryTx, start, approve, cancel, recover, retry: () => { setError(null); setQueue((current) => current.status === "searching" ? { ...current, stale: false } : current); setRetry((value) => value + 1); } };
}
