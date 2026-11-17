"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ActionBar } from "../../components/battle/ActionBar";
import { LogPanel, type BattleOptions } from "../../components/battle/LogPanel";
import { RoomPanel } from "../../components/battle/RoomPanel";
import { OutcomeReceipt } from "../../components/battle/OutcomeReceipt";
import { Sidebar } from "../../components/battle/Sidebar";
import { TopBar, type TabId } from "../../components/battle/TopBar";
import { Viewport, ViewportFrame } from "../../components/battle/Viewport";
import { cueForEvent, useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useBattleStream } from "../../lib/battle/BattleEngine";
import { ApiError, apiRequest } from "../../lib/battle/battleApi";
import { MockBattleStream } from "../../lib/battle/MockBattleStream";
import { ServerBattleStream } from "../../lib/battle/ServerBattleStream";
import { createCreature, makeFormat } from "../../lib/battle/roster";
import type { BattleStreamSource, Creature, Side } from "../../lib/battle/types";
import { FORMAT_LABEL, type CardPick } from "../../lib/cards/mapping";
import { useLobby, type ChatRoom } from "../../lib/lobby/useLobby";
import { useOdds } from "../../lib/markets/useOdds";
import { loadTicket, type MatchTicket } from "../../lib/match/MatchmakingService";
import { speciesService } from "../../lib/pokemon/SpeciesService";
import { rankService, type RankInfo } from "../../lib/rank/RankService";
import { getOutcomeProof } from "../../lib/results";
import { stakeService } from "../../lib/stake/StakeService";
import { useCurrency } from "../../lib/market/currency";
import { useMotionPreference } from "../../lib/motion";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { explorerTx, paidQueueApi } from "../../lib/sol/wagerClient";
import styles from "../../components/battle/battle.module.css";

type Load =
  | { status: "loading" }
  | { status: "error"; fatal: boolean }
  | { status: "ready"; ticket: MatchTicket; teams: Record<Side, Creature[]> };

interface MatchResult { outcome: "win" | "loss" | "draw"; payout: number; practice: boolean; before: RankInfo; after: RankInfo; delta: number }

async function toCreatures(picks: CardPick[], side: Side): Promise<Creature[]> {
  const species = await Promise.all(picks.map((p) => speciesService.getSpecies(p.species)));
  return species.map((s, i) => createCreature(s, picks[i].level, `${side}-${i}-${picks[i].key}`, picks[i].image));
}

function ResultSummary({ result, entry, paidWager }: { result: MatchResult; entry: number; paidWager?: MatchTicket["paidWager"] }) {
  const { formatUsd: formatDollars } = useCurrency();
  const money = result.outcome === "win" ? `+${formatDollars(result.payout)}` : result.outcome === "draw" ? `${formatDollars(result.payout)} back` : entry ? `−${formatDollars(entry)}` : "$0";
  return (
    <div className={styles.result}>
      <div>
        <span>{result.practice ? "Offline practice" : "Game complete"}</span>
        <strong>{paidWager ? "Devnet SOL match" : result.practice && entry ? money : "No payout issued"}</strong>
        <small>{paidWager ? `${paidWager.stakeLamports / 1_000_000_000} Devnet SOL each · ${paidWager.stakeLamports * 2 / 1_000_000_000} SOL pot` : entry ? `Selected demo entry ${formatDollars(entry)} · settlement deferred` : "No funds were at stake"}</small>
      </div>
      <div>
        <span>Rank</span>
        <strong data-tone={result.delta > 0 ? "up" : result.delta < 0 ? "down" : undefined}>{result.before.rating} → {result.after.rating} ({result.delta >= 0 ? "+" : ""}{result.delta})</strong>
        <small>{result.after.tier} · {result.after.wins}–{result.after.losses}</small>
      </div>
    </div>
  );
}

function PaidSettlement({ wager, authToken, outcome }: { wager: NonNullable<MatchTicket["paidWager"]>; authToken: string | null; outcome: "win" | "loss" | "draw" }) {
  const [settlementTx, setSettlementTx] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!authToken) return;
    let active = true;
    const check = async () => {
      try {
        const status = await paidQueueApi.status(authToken, wager);
        if (active) { setSettlementTx(status.settlementTx ?? null); setNote(null); }
      } catch (error) {
        if (active) setNote(error instanceof Error ? error.message : "Could not check SOL settlement.");
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authToken, wager]);
  const stake = wager.stakeLamports / 1_000_000_000;
  const amount = outcome === "win" ? stake * 2 : outcome === "draw" ? stake : 0;
  const label = outcome === "win" ? settlementTx ? "Won" : "Payout pending:" : outcome === "draw" ? settlementTx ? "Refunded" : "Refund pending:" : "Payout";
  return <p className={styles.paidOutcome} role="status">
    <strong>{label} {amount} Devnet SOL</strong>
    {outcome === "win" && <span>Gross payout · {stake} SOL net gain before network fees</span>}
    {settlementTx
      ? <a href={explorerTx(settlementTx)} target="_blank" rel="noopener noreferrer">View settlement on Solana ↗</a>
      : <a href={`https://explorer.solana.com/address/${wager.wager}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View funded escrow on Solana ↗</a>}
    {note && <span>{note}</span>}
    {!authToken && <span>Sign in to check settlement status.</span>}
  </p>;
}

export default function BattlePage() {
  const router = useRouter();
  const { ready, playerName: signedInName, walletAuthToken, signIn } = useWallet();
  const { formatUsd: formatDollars } = useCurrency();
  const formatRef = useRef(formatDollars);
  formatRef.current = formatDollars;
  const playerName = signedInName ?? "Guest";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [connectNote, setConnectNote] = useState<string | null>(null);

  useEffect(() => {
    const ticket = loadTicket();
    if (!ticket) {
      router.replace("/loadout");
      return;
    }
    let live = true;
    setLoad({ status: "loading" });
    // In a two-player match we may be side p2; creature ids carry the real side.
    const mySide = ticket.live?.side ?? "p1";
    const theirSide = mySide === "p1" ? "p2" : "p1";
    Promise.all([toCreatures(ticket.you.team, mySide), toCreatures(ticket.opponent.team, theirSide)])
      .then(([p1, p2]) => live && setLoad({ status: "ready", ticket, teams: { p1, p2 } }))
      .catch((e: unknown) => live && setLoad({ status: "error", fatal: e instanceof ApiError ? e.status === 404 : /→ 404/.test(String(e)) }));
    return () => { live = false; };
  }, [router, attempt]);

  const ticket = load.status === "ready" ? load.ticket : null;

  const source = useMemo<BattleStreamSource | null>(() => {
    if (!ready || load.status !== "ready") return null;
    const t = load.ticket;
    const { winnerTakes } = stakeService.quote(t.entry);
    const formatDollars = formatRef.current;
    const format = makeFormat("[Gen 9] Random Battle", [
      { name: "Match", description: FORMAT_LABEL[t.format] },
      { name: "Entry", description: t.paidWager ? `${t.paidWager.stakeLamports / 1_000_000_000} Devnet SOL deposited by each player` : t.entry ? `${formatDollars(t.entry)} each, winner takes ${formatDollars(winnerTakes)} (demo, no real money)` : "Free match" },
      { name: "Ranks", description: `${playerName} ${t.you.rating} vs. ${t.opponent.trainer.name} ${t.opponent.rating} (${t.opponent.tier})` },
    ]);
    // `teams.p1` is always our own team here, whichever side we play.
    const config = { you: { id: playerName, name: playerName, avatar: "maya" }, opponent: t.opponent.trainer, teams: load.teams, format };
    // The Go server is the referee: a matched human rival (t.live) or the
    // server AI. NEXT_PUBLIC_LIVE_BATTLE=0 forces the offline simulation.
    if (process.env.NEXT_PUBLIC_LIVE_BATTLE === "0" && !t.paidWager) return new MockBattleStream({ ...config, onStatus: setConnectNote });
    if (t.live) {
      const { battleId, token, side } = t.live;
      return new ServerBattleStream({ mode: "pvp", battleId, token, side, team: load.teams.p1, format, onStatus: setConnectNote });
    }
    return new ServerBattleStream({ mode: "ai", ...config, onStatus: setConnectNote });
  }, [ready, load, playerName]);

  const battle = useBattleStream(source);
  const { state } = battle;
  const odds = useOdds(state);
  const audio = useBattleAudio();
  const lobby = useLobby();
  const motion = useMotionPreference();

  const [options, setOptionsState] = useState<Omit<BattleOptions, "sound">>({ animations: true, showOdds: true });
  const [sidebar, setSidebar] = useState(false);
  const [split, setSplit] = useState(50);
  const splitValue = useRef(50);
  const workspace = useRef<HTMLDivElement>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [tab, setTab] = useState<TabId>("battle");

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("pf:battle-split"));
    if (Number.isFinite(saved) && saved >= 10 && saved <= 90) { splitValue.current = saved; setSplit(saved); }
  }, []);

  const updateSplit = (clientX: number) => {
    const bounds = workspace.current?.getBoundingClientRect();
    if (!bounds) return;
    const min = Math.min(45, 360 / bounds.width * 100);
    const value = Math.round(Math.min(100 - min, Math.max(min, (clientX - bounds.left) / bounds.width * 100)));
    splitValue.current = value;
    setSplit(value);
  };
  const onDividerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplit(event.clientX);
  };
  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSplit(event.clientX);
  };
  const saveSplit = () => window.localStorage.setItem("pf:battle-split", String(splitValue.current));

  const { play } = audio;
  useEffect(() => battle.subscribe((event, s) => {
    const cue = cueForEvent(event, s);
    if (cue) play(cue);
    if (!ticket) return;
    if (event.type === "init") {
      setResult(null);
      if (process.env.NEXT_PUBLIC_LIVE_BATTLE === "0") void stakeService.deposit(ticket.matchId, ticket.entry);
    }
    if (event.type === "win") {
      const outcome = event.winner === "draw" ? "draw" : event.winner === (s?.you ?? "p1") ? "win" : "loss";
      void Promise.all([
        ticket.live && process.env.NEXT_PUBLIC_LIVE_BATTLE !== "0"
          ? Promise.all([
              apiRequest<RankInfo>("GET", `/api/ranks?player=${encodeURIComponent(ticket.you.name)}`),
              getOutcomeProof("battles", ticket.live.battleId, ticket.live.token),
            ]).then(([after, proof]) => {
              const delta = after.history.find((history) => history.matchId === proof.result.id)?.delta ?? 0;
              return { before: { ...after, rating: after.rating - delta }, after, delta };
            })
          : rankService.recordResult(playerName, ticket.opponent.trainer.name, ticket.opponent.rating, outcome),
        process.env.NEXT_PUBLIC_LIVE_BATTLE === "0"
          ? stakeService.settle(ticket.matchId, ticket.entry, outcome)
          : Promise.resolve({ payout: 0 }),
      ]).then(([rank, settlement]) => setResult({ outcome, payout: settlement.payout, practice: process.env.NEXT_PUBLIC_LIVE_BATTLE === "0", ...rank }))
        .catch((error: unknown) => setConnectNote(error instanceof Error ? error.message : "Could not load the battle result. Your server result is saved."));
    }
  }), [battle.subscribe, play, ticket, playerName]);

  const openRoom = useCallback((room: ChatRoom) => {
    setRooms((rs) => (rs.some((r) => r.id === room.id) ? rs : [...rs, room]));
    setTab(room.id);
  }, []);
  const closeRoom = useCallback((id: string) => {
    setRooms((rs) => rs.filter((r) => r.id !== id));
    setTab((t) => (t === id ? "battle" : t));
  }, []);

  const setOptions = (o: BattleOptions) => {
    if (o.sound === audio.muted) audio.toggleMute();
    setOptionsState({ animations: o.animations, showOdds: o.showOdds });
  };

  const activeRoom = rooms.find((r) => r.id === tab);
  const title = ticket ? FORMAT_LABEL[ticket.format] : "Battle";
  const subtitle = state ? `${state.sides.p2.trainer.name} vs. ${state.sides.p1.trainer.name}` : "Connecting…";
  const badge = ticket && (ticket.paidWager
    ? <>{ticket.paidWager.stakeLamports / 1_000_000_000} Devnet SOL each · Escrow funded</>
    : ticket.entry
    ? <>Entry <b>{formatDollars(ticket.entry)}</b> · Winner takes <b>{formatDollars(stakeService.quote(ticket.entry).winnerTakes)}</b> · Demo</>
    : <>Free match · Ranked</>);

  return (
    <div className={styles.app} data-sidebar={sidebar || undefined} data-still={!options.animations || undefined}>
      <div className={styles.backdrop} aria-hidden="true" />
      <TopBar title={title} subtitle={subtitle} rooms={rooms} activeTab={tab} onSelect={setTab} onCloseRoom={closeRoom}
        onNewBattle={() => router.push("/loadout")} muted={audio.muted} onToggleMute={audio.toggleMute} onSignIn={() => signIn()} />

      <div className={styles.body}>
        <div ref={workspace} className={styles.workspace} style={{ "--battle-width": `${split}%` } as CSSProperties}>
        <div className={styles.left}>
          {state && connectNote ? <p role="status">{connectNote}</p> : null}
          {state && ticket ? (
            <>
              <Viewport state={state} odds={options.showOdds ? odds : null} badge={badge} summon={options.animations && !motion.reduced} />
              {ticket.live && state.phase !== "ended" && <button type="button" onClick={() => {
                const live = ticket.live;
                if (!live) return;
                void apiRequest("POST", `/api/battles/${live.battleId}/forfeit`, {}, live.token)
                  .catch((cause: unknown) => setConnectNote(cause instanceof Error ? cause.message : "Could not forfeit the match."));
              }}>Forfeit match</button>}
              <ActionBar state={state} choose={battle.choose} cancel={battle.cancel} toggleTimer={battle.toggleTimer} rematch={ticket.paidWager ? undefined : battle.rematch}
                outcomeDetail={ticket.paidWager && state.phase === "ended" ? <PaidSettlement wager={ticket.paidWager} authToken={walletAuthToken} outcome={state.winner === "draw" ? "draw" : state.winner === state.you ? "win" : "loss"} /> : null}
                summary={result ? <><ResultSummary result={result} entry={ticket.entry} paidWager={ticket.paidWager} />
                  {ticket.live && !ticket.paidWager && process.env.NEXT_PUBLIC_LIVE_BATTLE !== "0" && <OutcomeReceipt mode="battles" id={ticket.live.battleId} token={ticket.live.token} />}
                </> : null} />
            </>
          ) : (
            <ViewportFrame><div className={styles.viewport}>
              <div className={styles.field} />
              {load.status === "error" ? (
                <div className={styles.loadError}>
                  {load.fatal ? "This match uses a creature we can't load. Pick your cards again." : "Couldn't load creature data. Check your connection and try again."}
                  {load.fatal
                    ? <button className={styles.button} onClick={() => router.push("/loadout")}>Back to loadout</button>
                    : <button className={styles.button} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
                </div>
              ) : <div className={styles.connecting}>{connectNote ?? "Connecting…"}</div>}
            </div></ViewportFrame>
          )}
        </div>

        <div className={styles.divider} role="separator" aria-label="Resize battle and chat" aria-orientation="vertical"
          aria-valuemin={10} aria-valuemax={90} aria-valuenow={split} tabIndex={0} title="Drag to resize battle and chat"
          onPointerDown={onDividerDown} onPointerMove={onDividerMove} onPointerUp={saveSplit} onLostPointerCapture={saveSplit}
          onKeyDown={(event) => {
            const next = event.key === "ArrowLeft" ? split - 5 : event.key === "ArrowRight" ? split + 5 : event.key === "Home" ? 50 : null;
            if (next === null) return;
            event.preventDefault();
            const value = Math.min(90, Math.max(10, next));
            splitValue.current = value;
            setSplit(value);
            window.localStorage.setItem("pf:battle-split", String(value));
          }}><span /></div>

        <div className={styles.center}>
          {activeRoom ? (
            <RoomPanel key={activeRoom.id} room={activeRoom} playerName={playerName} />
          ) : state ? (
            <LogPanel state={state} playerName={playerName} sendChat={battle.sendChat} options={{ ...options, sound: !audio.muted }} setOptions={setOptions} />
          ) : null}
        </div>
        </div>

        {sidebar ? (
          <div className={styles.right}><Sidebar lobby={lobby} onOpenRoom={openRoom} onHide={() => setSidebar(false)} /></div>
        ) : (
          <button className={styles.showSidebar} onClick={() => setSidebar(true)}>◂ Rooms</button>
        )}
      </div>

    </div>
  );
}
