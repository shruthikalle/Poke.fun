"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Unsubscribe } from "../battle/types";

export interface RoomMessage { id: number; user: string; text: string; at: number }

export interface RoomChatService {
  join(roomId: string, onMessage: (m: RoomMessage) => void): Unsubscribe;
  send(roomId: string, user: string, text: string): void;
}

const CHATTER = [
  ["pyrefly", "anyone up for a one-card bo3?"],
  ["ottergirl", "Tidecub into Emberfox is so satisfying"],
  ["kiwi.k", "how do I check my rating?"],
  ["drillbit", "ladder is stacked tonight"],
  ["mossy_mo", "gg to whoever just swept me with Lumoth lol"],
  ["thar07", "Bouldillo walls everything, change my mind"],
  ["~Ref", "Reminder: be kind in chat. Have fun!"],
] as const;

let seq = 0;

export class MockRoomChatService implements RoomChatService {
  private rooms = new Map<string, Set<(m: RoomMessage) => void>>();

  join(roomId: string, onMessage: (m: RoomMessage) => void): Unsubscribe {
    const set = this.rooms.get(roomId) ?? new Set();
    set.add(onMessage);
    this.rooms.set(roomId, set);
    const say = () => {
      const [user, text] = CHATTER[Math.floor(Math.random() * CHATTER.length)];
      onMessage({ id: ++seq, user, text, at: Date.now() });
    };
    say();
    const id = setInterval(say, 4500 + Math.random() * 3000);
    return () => {
      clearInterval(id);
      set.delete(onMessage);
    };
  }

  send(roomId: string, user: string, text: string) {
    const message = { id: ++seq, user, text, at: Date.now() };
    this.rooms.get(roomId)?.forEach((l) => l(message));
  }
}

const defaultChat = new MockRoomChatService();

/** TODO(api): replace MockRoomChatService with the real room chat socket. */
export function useRoomChat(roomId: string | null, service: RoomChatService = defaultChat) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const room = useRef(roomId);
  room.current = roomId;

  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    return service.join(roomId, (m) => setMessages((prev) => [...prev.slice(-200), m]));
  }, [roomId, service]);

  const send = useCallback((user: string, text: string) => {
    const t = text.trim();
    if (room.current && t) service.send(room.current, user, t.slice(0, 300));
  }, [service]);

  return { messages, send };
}
