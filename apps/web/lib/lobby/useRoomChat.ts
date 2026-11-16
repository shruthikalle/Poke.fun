"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Unsubscribe } from "../battle/types";
import { useWallet } from "../wallet/WalletProvider";
import { communityRequest, heartbeat } from "./communityApi";

export interface RoomMessage { id: number; user: string; text: string; at: number }

export interface RoomChatService {
  join(roomId: string, onMessage: (m: RoomMessage) => void, player?: string | null, onError?: (error: string | null) => void, onUsers?: (users: number) => void): Unsubscribe;
  send(roomId: string, user: string, text: string): void | Promise<void>;
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

export class ApiRoomChatService implements RoomChatService {
  join(roomId: string, onMessage: (m: RoomMessage) => void, player?: string | null, onError?: (error: string | null) => void, onUsers?: (users: number) => void): Unsubscribe {
    let active = true;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (player) await heartbeat(player, roomId);
        const result = await communityRequest<{ messages: RoomMessage[]; cursor: number; users: number }>(`/api/community/rooms/${encodeURIComponent(roomId)}/messages?since=${cursor}`);
        if (active) {
          // A restarted server starts its ephemeral message sequence at zero.
          if (result.cursor < cursor) cursor = 0;
          else { result.messages.forEach(onMessage); cursor = result.cursor; }
          onError?.(null);
          onUsers?.(result.users);
        }
      } catch { if (active) onError?.("Room chat unavailable. Retrying…"); }
      if (active) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }

  async send(roomId: string, user: string, text: string) {
    const token = await heartbeat(user, roomId);
    await communityRequest(`/api/community/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST", body: JSON.stringify({ text }),
    }, token);
  }
}

const defaultChat = new ApiRoomChatService();

export function useRoomChat(roomId: string | null, service: RoomChatService = defaultChat) {
  const { playerName } = useWallet();
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<number | null>(null);
  const room = useRef(roomId);
  room.current = roomId;

  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    setError(null);
    setUsers(null);
    return service.join(roomId, (m) => setMessages((prev) => [...prev.filter((old) => old.id !== m.id), m].slice(-200)), playerName, setError, setUsers);
  }, [roomId, service, playerName]);

  const send = useCallback((user: string, text: string) => {
    const t = text.trim();
    if (room.current && t) {
      void Promise.resolve(service.send(room.current, user, Array.from(t).slice(0, 300).join("")))
        .catch(() => setError("Message was not sent. Please try again."));
    }
  }, [service]);

  return { messages, send, error, users };
}
