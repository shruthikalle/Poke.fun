"use client";

import { useEffect, useRef } from "react";
import type { ChatRoom } from "../../lib/lobby/useLobby";
import { useRoomChat } from "../../lib/lobby/useRoomChat";
import { ChatInput } from "./LogPanel";
import { nameColor } from "./format";
import styles from "./battle.module.css";

export function RoomPanel({ room, playerName }: { room: ChatRoom; playerName: string }) {
  const { messages, send } = useRoomChat(room.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);
  return (
    <section className={styles.logPanel} aria-label={`${room.name} chat`}>
      <div className={styles.logHead}>
        <span className={styles.usersTab}>{room.users} users</span>
        <strong className={styles.roomTitle}>{room.name}</strong>
      </div>
      <div ref={ref} className={styles.log} role="log" aria-live="polite">
        <div className={styles.formatBlock}><em>{room.description}</em></div>
        {messages.map((m) => (
          <div key={m.id} className={styles.logChat}>
            <small className={styles.time}>[{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}]</small>{" "}
            <strong style={{ color: nameColor(m.user) }}>{m.user}:</strong> {m.text}
          </div>
        ))}
      </div>
      <ChatInput name={playerName} onSend={(t) => send(playerName, t)} />
    </section>
  );
}
