"use client";

import { useEffect, useState } from "react";
import type { Unsubscribe } from "../battle/types";

export interface ChatRoom {
  id: string;
  name: string;
  users: number;
  description: string;
  section: "official" | "community";
  subrooms?: string[];
}

export interface LobbySnapshot {
  usersOnline: number;
  activeBattles: number;
  rooms: ChatRoom[];
}

export interface LobbyService {
  subscribe(onUpdate: (snapshot: LobbySnapshot) => void): Unsubscribe;
}

const ROOMS: ChatRoom[] = [
  { id: "lobby", name: "Lobby", users: 513, description: "Hang out between battles.", section: "official" },
  { id: "tournaments", name: "Tournaments", users: 221, description: "Brackets every hour.", section: "official", subrooms: ["Tours Plaza", "Tours Minigames"] },
  { id: "help", name: "Help", users: 203, description: "Ask other trainers.", section: "official" },
  { id: "one-card", name: "One-Card Arena", users: 61, description: "One card decides it.", section: "community", subrooms: ["Arena Clinic"] },
  { id: "collectors", name: "Collectors", users: 48, description: "Show off your pulls.", section: "community" },
  { id: "random", name: "Random Battles", users: 132, description: "Random creatures, one winner.", section: "community" },
];

export class MockLobbyService implements LobbyService {
  subscribe(onUpdate: (snapshot: LobbySnapshot) => void): Unsubscribe {
    let snapshot: LobbySnapshot = { usersOnline: 8576, activeBattles: 962, rooms: ROOMS };
    onUpdate(snapshot);
    const id = setInterval(() => {
      const jitter = (n: number, spread: number) => Math.max(0, n + Math.round((Math.random() - 0.5) * spread));
      snapshot = {
        usersOnline: jitter(snapshot.usersOnline, 24),
        activeBattles: jitter(snapshot.activeBattles, 8),
        rooms: snapshot.rooms.map((r) => ({ ...r, users: jitter(r.users, 4) })),
      };
      onUpdate(snapshot);
    }, 5000);
    return () => clearInterval(id);
  }
}

const defaultLobby = new MockLobbyService();

/** TODO(api): replace MockLobbyService with the real presence/rooms feed. */
export function useLobby(service: LobbyService = defaultLobby): LobbySnapshot | null {
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  useEffect(() => service.subscribe(setSnapshot), [service]);
  return snapshot;
}
