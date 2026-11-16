"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { arenaApi, arenaSessionExpired, ARENA_QUEUE_STORAGE_KEY, ARENA_SESSION_STORAGE_KEY, type ArenaQueueTicket } from "../../../lib/arena";
import { apiRequest } from "../../../lib/battle/battleApi";
import type { CardPick, MatchFormat, PowerTier } from "../../../lib/cards/mapping";
import { loadTicket, matchmakingService, saveTicket, type MatchSearch } from "../../../lib/match/MatchmakingService";
import { session as storage } from "../../../lib/storage";
import { errorMessage } from "./useLoadoutResource";

export type LoadoutQueue =
  | { status: "idle" }
  | { status: "joining"; format: MatchFormat }
  | { status: "searching"; format: "champion"; ticket: ArenaQueueTicket }
  | { status: "searching"; format: "squad" }
  | { status: "found"; format: MatchFormat; opponent: string };

interface QueueRequest {
  format: MatchFormat;
  team: CardPick[];
  rating: number;
  entry: number;
  walletAddress: string | null;
}

function validateArenaTicket(ticket: ArenaQueueTicket) {
  if (!ticket.id || !ticket.token || !["waiting", "matched"].includes(ticket.status)
    || (ticket.status === "matched" && (!ticket.arena?.id || !ticket.arena.token))) {
    throw new Error("The arena returned an incomplete queue ticket. Please retry.");
  }
}

async function refreshArenaTicket(ticket: ArenaQueueTicket): Promise<ArenaQueueTicket> {
  // GET intentionally omits the queue credential; only POST returns it.
  const latest = await arenaApi.queueStatus(ticket);
  return { ...ticket, ...latest, token: ticket.token };
}

function expiredArenaTicket(cause: unknown): boolean {
  return arenaSessionExpired(cause);
}

export function useLoadoutQueue(player: string | null) {
  const router = useRouter();
  const [queue, setQueue] = useState<LoadoutQueue>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [resume, setResume] = useState<{ path?: string; checking?: boolean; error?: string } | null>({ checking: true });
  const busy = useRef(false);
  const mounted = useRef(false);
  const search = useRef<MatchSearch | null>(null);
  const identity = useRef(player);
  identity.current = player;

  const acceptArena = useCallback((ticket: ArenaQueueTicket, owner: string) => {
    validateArenaTicket(ticket);
    storage.set(ARENA_QUEUE_STORAGE_KEY, JSON.stringify({ ...ticket, player: owner }));
    if (ticket.status === "matched" && ticket.arena) {
      storage.set(ARENA_SESSION_STORAGE_KEY, JSON.stringify({ ...ticket.arena, player: owner }));
      storage.remove(ARENA_QUEUE_STORAGE_KEY);
      setQueue({ status: "found", format: "champion", opponent: ticket.opponent ?? "another player" });
    } else {
      setQueue({ status: "searching", format: "champion", ticket });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      search.current?.cancel();
    };
  }, []);

  const existingSession = useCallback(async (owner: string) => {
    const raw = storage.get(ARENA_SESSION_STORAGE_KEY);
    if (raw) {
      let saved;
      try { saved = JSON.parse(raw); } catch { storage.remove(ARENA_SESSION_STORAGE_KEY); }
      if (saved?.id && saved.token && (!saved.player || saved.player === owner)) {
        try {
          const view = await arenaApi.view(saved);
          if (view.status !== "finished") return "/battle/live";
          storage.remove(ARENA_SESSION_STORAGE_KEY);
        } catch (cause) {
          if (!arenaSessionExpired(cause)) throw cause;
          storage.remove(ARENA_SESSION_STORAGE_KEY);
        }
      }
    }
    const ticket = loadTicket();
    if (ticket?.live && ticket.you.name === owner) {
      try {
        const feed = await apiRequest("GET", `/api/battles/${encodeURIComponent(ticket.live.battleId)}/events?since=0`, undefined, ticket.live.token);
        const events = feed.events as { type: string }[];
        const lastInit = events.map((event) => event.type).lastIndexOf("init");
        if (!events.slice(Math.max(0, lastInit)).some((event) => event.type === "win")) return "/battle";
      } catch (cause) { if (!arenaSessionExpired(cause)) throw cause; }
    }
    return null;
  }, []);

  useEffect(() => {
    let active = true;
    setResume(player ? { checking: true } : null);
    if (player) void existingSession(player).then((path) => {
      if (active) setResume(path ? { path } : null);
    }).catch((cause) => { if (active) setResume({ error: errorMessage(cause) }); });
    return () => { active = false; };
  }, [player, pollAttempt, existingSession]);

  useEffect(() => {
    search.current?.cancel();
    search.current = null;
    busy.current = false;
    setQueue({ status: "idle" });
    setError(null);
    setPollError(null);
    setCancelling(false);
    if (!player) return;
    const raw = storage.get(ARENA_QUEUE_STORAGE_KEY);
    if (!raw) return;
    try {
      const ticket = JSON.parse(raw) as ArenaQueueTicket & { player?: string };
      validateArenaTicket(ticket);
      if (ticket.player && ticket.player !== player) {
        if (ticket.status === "waiting") void arenaApi.cancelQueue(ticket).catch(() => {});
        storage.remove(ARENA_QUEUE_STORAGE_KEY);
        return;
      }
      acceptArena(ticket, player);
    } catch {
      storage.remove(ARENA_QUEUE_STORAGE_KEY);
      setError("Your saved search could not be restored. Please find a match again.");
    }
  }, [player, acceptArena]);

  useEffect(() => {
    if (queue.status !== "searching" || queue.format !== "champion" || pollError || !player) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const latest = await refreshArenaTicket(queue.ticket);
        validateArenaTicket(latest);
        if (!active) return;
        if (latest.status === "matched") acceptArena(latest, player);
        else timer = setTimeout(() => void check(), 900);
      } catch (cause) {
        if (!active) return;
        if (expiredArenaTicket(cause)) {
          storage.remove(ARENA_QUEUE_STORAGE_KEY);
          setQueue({ status: "idle" });
          setError("Your arena search expired. Please find a match again.");
        } else setPollError(errorMessage(cause));
      }
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [queue, player, pollError, pollAttempt, acceptArena]);

  useEffect(() => {
    if (queue.status !== "found") return;
    const timer = setTimeout(() => router.push(queue.format === "champion" ? "/battle/live" : "/battle"), 750);
    return () => clearTimeout(timer);
  }, [queue, router]);

  const start = async ({ format, team, rating, entry, walletAddress }: QueueRequest) => {
    if (!player || busy.current || queue.status !== "idle" || !team.length) return;
    if (format === "squad" && team.length !== 3) {
      setError("Choose three different creatures for your squad.");
      return;
    }
    const owner = player;
    busy.current = true;
    setError(null);
    setPollError(null);
    setQueue({ status: "joining", format });
    try {
      const path = await existingSession(owner);
      if (path) { setResume({ path }); setQueue({ status: "idle" }); router.push(path); return; }
      if (format === "champion") {
        const lead = team[0];
        const ownedAsset = walletAddress && !lead.rental
          ? { assetId: lead.key, walletAddress } : undefined;
        const ticket = await arenaApi.enqueue(owner, lead.species, rating, Math.round(entry * 100), ownedAsset);
        if (!mounted.current || identity.current !== owner) {
          if (ticket.status === "waiting") await arenaApi.cancelQueue(ticket);
          return;
        }
        storage.remove(ARENA_SESSION_STORAGE_KEY);
        acceptArena(ticket, owner);
      } else {
        const pending = matchmakingService.find({
          player: owner, rating, format, entry, team: team.map((pick) => !pick.rental && walletAddress ? { ...pick, assetId: pick.key, walletAddress } : pick),
          tier: Math.max(...team.map((pick) => pick.tier)) as PowerTier,
        });
        search.current = pending;
        setQueue({ status: "searching", format });
        const ticket = await pending.result;
        if (!mounted.current || identity.current !== owner) return;
        if (!ticket.live?.battleId || !ticket.live.token || ticket.format !== "squad"
          || ticket.you.team.length !== 3 || ticket.opponent.team.length !== 3) {
          throw new Error("No live squad match was returned. Please try the server queue again.");
        }
        saveTicket(ticket);
        setQueue({ status: "found", format, opponent: ticket.opponent.trainer.name });
      }
    } catch (cause) {
      if (!mounted.current || identity.current !== owner) return;
      setQueue({ status: "idle" });
      if (errorMessage(cause).toLowerCase() !== "cancelled") setError(errorMessage(cause));
    } finally {
      if (identity.current === owner) {
        busy.current = false;
        search.current = null;
        if (mounted.current) setCancelling(false);
      }
    }
  };

  const cancel = async () => {
    if (queue.status !== "searching" || cancelling) return;
    setCancelling(true);
    if (queue.format === "squad") {
      // Keep the dialog until the service confirms cancellation or a match.
      search.current?.cancel();
      return;
    }
    try {
      await arenaApi.cancelQueue(queue.ticket);
      // Deletion may race with a match; collect that match before leaving.
      const latest = await refreshArenaTicket(queue.ticket).catch(() => null);
      if (latest?.status === "matched" && player) acceptArena(latest, player);
      else {
        storage.remove(ARENA_QUEUE_STORAGE_KEY);
        setQueue({ status: "idle" });
        setPollError(null);
      }
    } catch (cause) {
      const latest = await refreshArenaTicket(queue.ticket).catch(() => null);
      if (latest?.status === "matched" && player) acceptArena(latest, player);
      else if (expiredArenaTicket(cause)) {
        storage.remove(ARENA_QUEUE_STORAGE_KEY);
        setQueue({ status: "idle" });
        setPollError(null);
        setError("Your arena search has already ended. You can find a match again.");
      } else setPollError(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  };

  return {
    queue, error, pollError, cancelling, resume, start, cancel,
    rejoin: () => { if (resume?.path) router.push(resume.path); },
    retryPoll: () => { setPollError(null); setPollAttempt((value) => value + 1); },
  };
}
