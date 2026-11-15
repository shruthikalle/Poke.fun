"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { ActionBar } from "../../components/battle/ActionBar";
import { LogPanel, type BattleOptions } from "../../components/battle/LogPanel";
import { RoomPanel } from "../../components/battle/RoomPanel";
import { Sidebar } from "../../components/battle/Sidebar";
import { TopBar, type TabId } from "../../components/battle/TopBar";
import { Viewport } from "../../components/battle/Viewport";
import { cueForEvent, useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useBattleStream } from "../../lib/battle/BattleEngine";
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
import { stakeService } from "../../lib/stake/StakeService";
import { useCurrency } from "../../lib/market/currency";
import { useMotionPreference } from "../../lib/motion";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "../../components/battle/battle.module.css";

type Load =
  | { status: "loading" }
  | { status: "error"; fatal: boolean }
  | { status: "ready"; ticket: MatchTicket; teams: Record<Side, Creature[]> };

interface MatchResult { outcome: "win" | "loss" | "draw"; payout: number; before: RankInfo; after: RankInfo; delta: number }

async function toCreatures(picks: CardPick[], side: Side): Promise<Creature[]> {
  const species = await Promise.all(picks.map((p) => speciesService.getSpecies(p.species)));
  return species.map((s, i) => createCreature(s, picks[i].level, `${side}-${i}-${picks[i].key}`, picks[i].image));
}

function ResultSummary({ result, entry }: { result: MatchResult; entry: number }) {
  const { formatUsd: formatDollars } = useCurrency();
  const money = result.outcome === "win" ? `+${formatDollars(result.payout)}` : result.outcome === "draw" ? `${formatDollars(result.payout)} back` : entry ? `−${formatDollars(entry)}` : "$0";
  return (
    <div className={styles.result}>
      <div>
        <span>{entry ? "Winnings" : "Free match"}</span>
        <strong data-tone={result.outcome === "win" && entry ? "up" : result.outcome === "loss" && entry ? "down" : undefined}>{entry ? money : "No entry"}</strong>
        <small>{entry ? `Entry ${formatDollars(entry)} · demo, no real money` : "Nothing was at stake"}</small>
      </div>
      <div>
        <span>Rank</span>
        <strong data-tone={result.delta > 0 ? "up" : result.delta < 0 ? "down" : undefined}>{result.before.rating} → {result.after.rating} ({result.delta >= 0 ? "+" : ""}{result.delta})</strong>
        <small>{result.after.tier} · {result.after.wins}–{result.after.losses}</small>
      </div>
    </div>
  );
}

export default function BattlePage() {
  const router = useRouter();
  const { ready, playerName: signedInName, signIn } = useWallet();
  const { formatUsd: formatDollars } = useCurrency();
  const formatRef = useRef(formatDollars);
  formatRef.current = formatDollars;
  const playerName = signedInName ?? "Guest";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    const ticket = loadTicket();
    if (!ticket) {
      router.replace("/loadout");
      return;
    }
    let live = true;
    setLoad({ status: "loading" });
    Promise.all([toCreatures(ticket.you.team, "p1"), toCreatures(ticket.opponent.team, "p2")])
      .then(([p1, p2]) => live && setLoad({ status: "ready", ticket, teams: { p1, p2 } }))
      .catch((e: unknown) => live && setLoad({ status: "error", fatal: /→ 404/.test(String(e)) }));
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
      { name: "Entry", description: t.entry ? `${formatDollars(t.entry)} each, winner takes ${formatDollars(winnerTakes)} (demo, no real money)` : "Free match" },
      { name: "Ranks", description: `${playerName} ${t.you.rating} vs. ${t.opponent.trainer.name} ${t.opponent.rating} (${t.opponent.tier})` },
    ]);
    const config = { you: { id: playerName, name: playerName, avatar: "maya" }, opponent: t.opponent.trainer, teams: load.teams, format };
    // The Go server is the referee. Set NEXT_PUBLIC_LIVE_BATTLE=0 to fall back
    // to the offline client-side simulation.
    return process.env.NEXT_PUBLIC_LIVE_BATTLE === "0"
      ? new MockBattleStream(config)
      : new ServerBattleStream(config);
  }, [ready, load, playerName]);

  const battle = useBattleStream(source);
  const { state } = battle;
  const odds = useOdds(state);
  const audio = useBattleAudio();
  const lobby = useLobby();
  const motion = useMotionPreference();

  const [options, setOptionsState] = useState<Omit<BattleOptions, "sound">>({ animations: true, showOdds: true });
  const [sidebar, setSidebar] = useState(true);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [tab, setTab] = useState<TabId>("battle");

  useEffect(() => {
    if (window.innerWidth < 1180) setSidebar(false);
  }, []);

  const { play } = audio;
  useEffect(() => battle.subscribe((event, s) => {
    const cue = cueForEvent(event, s);
    if (cue) play(cue);
    if (!ticket) return;
    if (event.type === "init") {
      setResult(null);
      void stakeService.deposit(ticket.matchId, ticket.entry);
    }
    if (event.type === "win") {
      const outcome = event.winner === "draw" ? "draw" : event.winner === (s?.you ?? "p1") ? "win" : "loss";
      void Promise.all([
        rankService.recordResult(playerName, ticket.opponent.trainer.name, ticket.opponent.rating, outcome),
        stakeService.settle(ticket.matchId, ticket.entry, outcome),
      ]).then(([rank, settlement]) => setResult({ outcome, payout: settlement.payout, ...rank }));
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
  const badge = ticket && (ticket.entry
    ? <>Entry <b>{formatDollars(ticket.entry)}</b> · Winner takes <b>{formatDollars(stakeService.quote(ticket.entry).winnerTakes)}</b> · Demo</>
    : <>Free match · Ranked</>);

  return (
    <div className={styles.app} data-sidebar={sidebar || undefined} data-still={!options.animations || undefined}>
      <div className={styles.backdrop} aria-hidden="true" />
      <TopBar title={title} subtitle={subtitle} rooms={rooms} activeTab={tab} onSelect={setTab} onCloseRoom={closeRoom}
        onNewBattle={() => router.push("/loadout")} muted={audio.muted} onToggleMute={audio.toggleMute} onSignIn={() => signIn()} />

      <div className={styles.body}>
        <div className={styles.left}>
          {state && ticket ? (
            <>
              <Viewport state={state} odds={options.showOdds ? odds : null} badge={badge} summon={options.animations && !motion.reduced} />
              <ActionBar state={state} choose={battle.choose} cancel={battle.cancel} toggleTimer={battle.toggleTimer} rematch={battle.rematch}
                summary={result ? <ResultSummary result={result} entry={ticket.entry} /> : null} />
            </>
          ) : (
            <div className={styles.viewport}>
              <div className={styles.field} />
              {load.status === "error" ? (
                <div className={styles.loadError}>
                  {load.fatal ? "This match uses a creature we can't load. Pick your cards again." : "Couldn't load creature data. Check your connection and try again."}
                  {load.fatal
                    ? <button className={styles.button} onClick={() => router.push("/loadout")}>Back to loadout</button>
                    : <button className={styles.button} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
                </div>
              ) : <div className={styles.connecting}>Connecting…</div>}
            </div>
          )}
        </div>

        <div className={styles.center}>
          {activeRoom ? (
            <RoomPanel key={activeRoom.id} room={activeRoom} playerName={playerName} />
          ) : state ? (
            <LogPanel state={state} playerName={playerName} sendChat={battle.sendChat} options={{ ...options, sound: !audio.muted }} setOptions={setOptions} />
          ) : null}
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
