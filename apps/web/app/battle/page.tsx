"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionBar } from "../../components/battle/ActionBar";
import { LogPanel, type BattleOptions } from "../../components/battle/LogPanel";
import { RoomPanel } from "../../components/battle/RoomPanel";
import { Sidebar } from "../../components/battle/Sidebar";
import { TopBar, type TabId } from "../../components/battle/TopBar";
import { Viewport } from "../../components/battle/Viewport";
import { SignInDialog } from "../../components/SignInDialog";
import { cueForEvent, useBattleAudio } from "../../lib/audio/useBattleAudio";
import { useBattleStream } from "../../lib/battle/BattleEngine";
import { MockBattleStream } from "../../lib/battle/MockBattleStream";
import type { BattleStreamSource, Trainer } from "../../lib/battle/types";
import { useLobby, type ChatRoom } from "../../lib/lobby/useLobby";
import { useOdds } from "../../lib/markets/useOdds";
import { useWallet } from "../../lib/wallet/WalletProvider";
import styles from "../../components/battle/battle.module.css";

const OPPONENTS: Trainer[] = [
  { id: "thar07", name: "thar07", avatar: "kai" },
  { id: "mossy_mo", name: "mossy_mo", avatar: "theo" },
  { id: "pyrefly", name: "pyrefly", avatar: "rook" },
];

export default function BattlePage() {
  const { ready, playerName: signedInName } = useWallet();
  const playerName = signedInName ?? "Guest";
  const [battleNo, setBattleNo] = useState(0);

  // TODO(realtime): construct the QuickNode Streams / Go API source here instead.
  const source = useMemo<BattleStreamSource | null>(() => {
    if (!ready) return null;
    return new MockBattleStream({ you: { id: playerName, name: playerName, avatar: "maya" }, opponent: OPPONENTS[battleNo % OPPONENTS.length] });
  }, [ready, playerName, battleNo]);

  const battle = useBattleStream(source);
  const { state } = battle;
  const odds = useOdds(state);
  const audio = useBattleAudio();
  const lobby = useLobby();

  const [options, setOptionsState] = useState<Omit<BattleOptions, "sound">>({ animations: true, showOdds: true });
  const [sidebar, setSidebar] = useState(true);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [tab, setTab] = useState<TabId>("battle");
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    if (window.innerWidth < 1180) setSidebar(false);
  }, []);

  const { play } = audio;
  useEffect(() => battle.subscribe((event, s) => {
    const cue = cueForEvent(event, s);
    if (cue) play(cue);
  }), [battle.subscribe, play]);

  const openRoom = useCallback((room: ChatRoom) => {
    setRooms((rs) => (rs.some((r) => r.id === room.id) ? rs : [...rs, room]));
    setTab(room.id);
  }, []);
  const closeRoom = useCallback((id: string) => {
    setRooms((rs) => rs.filter((r) => r.id !== id));
    setTab((t) => (t === id ? "battle" : t));
  }, []);
  const closeSignIn = useCallback(() => setSignIn(false), []);

  const setOptions = (o: BattleOptions) => {
    if (o.sound === audio.muted) audio.toggleMute();
    setOptionsState({ animations: o.animations, showOdds: o.showOdds });
  };

  const activeRoom = rooms.find((r) => r.id === tab);
  const subtitle = state ? `${state.sides.p2.trainer.name} vs. ${state.sides.p1.trainer.name}` : "Connecting…";

  return (
    <div className={styles.app} data-sidebar={sidebar || undefined} data-still={!options.animations || undefined}>
      <TopBar title="Random Battle" subtitle={subtitle} rooms={rooms} activeTab={tab} onSelect={setTab} onCloseRoom={closeRoom}
        onNewBattle={() => { setBattleNo((n) => n + 1); setTab("battle"); }} muted={audio.muted} onToggleMute={audio.toggleMute} onSignIn={() => setSignIn(true)} />

      <div className={styles.body}>
        <div className={styles.left}>
          {state ? (
            <>
              <Viewport state={state} odds={options.showOdds ? odds : null} />
              <ActionBar state={state} choose={battle.choose} cancel={battle.cancel} toggleTimer={battle.toggleTimer} rematch={battle.rematch} />
            </>
          ) : (
            <div className={styles.viewport}><div className={styles.field} /><div className={styles.connecting}>Connecting…</div></div>
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

      <SignInDialog open={signIn} onClose={closeSignIn} onSignedIn={closeSignIn} />
    </div>
  );
}
