"use client";

import { useState } from "react";
import type { ChatRoom, LobbySnapshot } from "../../lib/lobby/useLobby";
import styles from "./battle.module.css";

type Filter = "all" | "official" | "community";

function RoomItem({ room, onOpen }: { room: ChatRoom; onOpen: (room: ChatRoom) => void }) {
  return (
    <div className={styles.room}>
      <button className={styles.roomButton} onClick={() => onOpen(room)}>
        <span className={styles.roomTop}>
          <span className={styles.bubble} aria-hidden="true" />
          <strong>{room.name}</strong>
          <small>({room.users} users)</small>
        </span>
        <span className={styles.roomDesc}>{room.description}</span>
      </button>
      {room.subrooms && (
        <div className={styles.subrooms}>
          ↳ Subrooms:{" "}
          {room.subrooms.map((s) => (
            <button key={s} className={styles.subroom} onClick={() => onOpen({ ...room, id: `${room.id}-${s}`, name: s, users: Math.max(3, Math.round(room.users / 6)), subrooms: undefined })}>
              <span className={styles.bubble} aria-hidden="true" />{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

      <select className={styles.filter} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter rooms">
        <option value="all">(All rooms)</option>
        <option value="official">Official</option>
        <option value="community">Community</option>
      </select>

      {show("official") && (
        <>
          <h2 className={styles.sideHeading}>Official chat rooms</h2>
          {rooms.filter((r) => r.section === "official").map((r) => <RoomItem key={r.id} room={r} onOpen={onOpenRoom} />)}
        </>
      )}
      {show("community") && (
        <>
          <h2 className={styles.sideHeading}>Community rooms</h2>
          {rooms.filter((r) => r.section === "community").map((r) => <RoomItem key={r.id} room={r} onOpen={onOpenRoom} />)}
        </>
      )}
    </aside>
  );
}
