"use client";

import { useState } from "react";
import type { ChatRoom, LiveBattle, LobbySnapshot } from "../../lib/lobby/useLobby";
import styles from "./battle.module.css";

type Filter = "all" | "official" | "community";

function RoomItem({ room, onOpen }: { room: ChatRoom; onOpen: (room: ChatRoom) => void }) {
  return (
    <div className={styles.room}>
      <button className={styles.roomButton} onClick={() => onOpen(room)}>
        <span className={styles.roomTop}>
          <span className={styles.bubble} aria-hidden="true" />
          <strong>{room.name}</strong>
          <small>{room.users} online</small>
        </span>
        <span className={styles.roomDesc}>{room.description}</span>
      </button>
      {room.subrooms && (
        <div className={styles.subrooms}>
          Subrooms
          {room.subrooms.map((s) => (
            <button key={s} className={styles.subroom} onClick={() => onOpen({ ...room, id: `${room.id}-${s}`, name: s, users: 0, subrooms: undefined })}>
              <span className={styles.bubble} aria-hidden="true" />{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveBattleRow({ battle, onOpen }: { battle: LiveBattle; onOpen: () => void }) {
  const [a, b] = battle.trainers;
  return (
    <li>
      <button className={styles.live} onClick={onOpen} title={`Open discussion: ${a.name} vs ${b.name}`}>
        <img src={`/trainers/${a.avatar}.png`} alt="" width={28} height={28} />
        <span className={styles.liveNames}><strong>{a.name}</strong><i>vs</i><strong>{b.name}</strong></span>
        <img src={`/trainers/${b.avatar}.png`} alt="" width={28} height={28} />
        <small>{battle.format} · {battle.kind === "arena" ? `${battle.turn}s elapsed` : `Turn ${battle.turn}`} · Chat</small>
      </button>
    </li>
  );
}

const FILTERS: [Filter, string][] = [["all", "All rooms"], ["official", "Official"], ["community", "Community"]];

export function Sidebar({ lobby, onOpenRoom, onHide }: { lobby: LobbySnapshot | null; onOpenRoom: (room: ChatRoom) => void; onHide: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rooms = lobby?.rooms ?? [];
  const show = (section: ChatRoom["section"]) => filter === "all" || filter === section;
  return (
    <aside className={styles.sidebar} aria-label="Lobby">
      <button className={styles.hide} onClick={onHide}>▸ Hide</button>
      <div className={styles.stats}>
        <img className={styles.statTrainer} src="/trainers/maya.png" alt="" width={56} height={56} />
        <div className={styles.statBox}><strong>{lobby?.usersOnline ?? "—"}</strong><span>users online</span></div>
        <div className={styles.statBox}><strong>{lobby?.activeBattles ?? "—"}</strong><span>active battles</span></div>
        <img className={styles.statTrainer} src="/trainers/rook.png" alt="" width={56} height={56} />
      </div>

      <h2 className={styles.sideHeading}>Live battles</h2>
      {!lobby ? <p role="status">Lobby unavailable. Reconnecting…</p> : lobby.liveBattles.length === 0 ? <p>No active battles.</p> : null}
      <ul className={styles.lives}>
        {(lobby?.liveBattles ?? []).map((b) => <LiveBattleRow
            key={b.id}
            battle={b}
            onOpen={() =>
              onOpenRoom(rooms.find((r) => r.id === b.roomId) ?? {
                id: b.roomId ?? `live-${b.id}`,
                name: `${b.trainers[0].name} vs ${b.trainers[1].name}`,
                users: 0,
                description: `${b.format} discussion (chat only).`,
                section: "community",
              })
            }
          />)}
      </ul>

      <div className={styles.filter} role="radiogroup" aria-label="Filter rooms">
        {FILTERS.map(([f, label]) => (
          <button key={f} className="pf-chip" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>

      {show("official") && (
        <>
          <h2 className={styles.sideHeading}>Official chat rooms</h2>
          {rooms.filter((r) => r.section === "official").map((r) => <RoomItem key={r.id} room={r} onOpen={onOpenRoom} />)}
        </>
      )}
      {show("community") && (
        <>
          <h2 className={styles.sideHeading}>Community rooms</h2>
          {lobby && rooms.every((r) => r.section !== "community") && <p>No community rooms.</p>}
          {rooms.filter((r) => r.section === "community").map((r) => <RoomItem key={r.id} room={r} onOpen={onOpenRoom} />)}
        </>
      )}
    </aside>
  );
}
