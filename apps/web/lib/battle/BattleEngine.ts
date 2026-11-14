"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { BattleChoice, BattleEvent, BattleState, BattleStreamSource, LogEntry, Side, Unsubscribe } from "./types";

export * from "./types";

type Action = { type: "event"; event: BattleEvent };

let logId = 0;
const entry = (kind: LogEntry["kind"], text: string, user?: string): LogEntry => ({ id: ++logId, kind, text, user });

const nameOf = (state: BattleState, side: Side) => {
  const s = state.sides[side];
  return s.team[s.activeIndex]?.species ?? "?";
};
const ownerPrefix = (state: BattleState, side: Side) => (side === state.you ? "" : "The opposing ");

export function applyBattleEvent(state: BattleState | null, event: BattleEvent): BattleState | null {
  if (event.type === "init") {
    return { ...event.state, phase: "connecting", log: [], animation: null };
  }
  if (!state) return state;
  const seq = (state.animation?.seq ?? 0) + 1;
  const push = (...entries: LogEntry[]) => [...state.log, ...entries].slice(-400);

  switch (event.type) {
    case "join":
      return { ...state, users: state.users.includes(event.name) ? state.users : [...state.users, event.name], log: push(entry("join", `${event.name} joined`)) };
    case "leave":
      return { ...state, users: state.users.filter((u) => u !== event.name), log: push(entry("leave", `${event.name} left`)) };
    case "start":
      return { ...state, log: push(entry("start", `Battle started between ${state.sides.p2.trainer.name} and ${state.sides.p1.trainer.name}!`)) };
    case "turn":
      return { ...state, turn: event.turn, log: push(entry("turn", `Turn ${event.turn}`)) };
    case "request":
      return { ...state, phase: event.phase, pendingChoice: null };
    case "choice-accepted":
      return { ...state, phase: "waiting", pendingChoice: event.choice };
    case "choice-cancelled":
      return { ...state, phase: "choosing", pendingChoice: null };
    case "resolving":
      return { ...state, phase: "resolving" };
    case "switch": {
      const side = state.sides[event.side];
      const next = { ...state, sides: { ...state.sides, [event.side]: { ...side, activeIndex: event.teamIndex } } };
      const species = side.team[event.teamIndex].species;
      const text = event.side === state.you ? `Go! **${species}**!` : `${side.trainer.name} sent out **${species}**!`;
      return { ...next, log: push(entry("switch", text)), animation: { kind: "switch-in", side: event.side, seq } };
    }
    case "move": {
      const side = state.sides[event.side];
      const team = side.team.map((c, i) => i !== side.activeIndex ? c : { ...c, moves: c.moves.map((m, j) => (j === event.moveIndex ? { ...m, pp: event.ppLeft } : m)) });
      const moveName = side.team[side.activeIndex].moves[event.moveIndex].name;
      return {
        ...state,
        sides: { ...state.sides, [event.side]: { ...side, team } },
        log: push(entry("move", `${ownerPrefix(state, event.side)}${nameOf(state, event.side)} used **${moveName}**!`)),
        animation: { kind: "attack", side: event.side, seq },
      };
    }
    case "damage": {
      const side = state.sides[event.side];
      const target = side.team[side.activeIndex];
      const lost = Math.round(((target.hp - event.hp) / target.maxHp) * 100);
      const team = side.team.map((c, i) => (i === side.activeIndex ? { ...c, hp: event.hp } : c));
      const lines: LogEntry[] = [];
      if (event.crit) lines.push(entry("effect", "A critical hit!"));
      if (event.effectiveness === "super") lines.push(entry("effect", "It's super effective!"));
      if (event.effectiveness === "resisted") lines.push(entry("effect", "It's not very effective..."));
      if (event.effectiveness === "immune") lines.push(entry("effect", `It doesn't affect ${ownerPrefix(state, event.side).toLowerCase()}${target.species}...`));
      else lines.push(entry("damage", `(${ownerPrefix(state, event.side)}${target.species} lost ${lost}% of its health!)`));
      return { ...state, sides: { ...state.sides, [event.side]: { ...side, team } }, log: push(...lines), animation: { kind: "hit", side: event.side, seq } };
    }
    case "miss":
      return { ...state, log: push(entry("miss", `${ownerPrefix(state, event.side)}${nameOf(state, event.side)} avoided the attack!`)) };
    case "faint": {
      const side = state.sides[event.side];
      const team = side.team.map((c, i) => (i === side.activeIndex ? { ...c, hp: 0, fainted: true } : c));
      return {
        ...state,
        sides: { ...state.sides, [event.side]: { ...side, team } },
        log: push(entry("faint", `${ownerPrefix(state, event.side)}${nameOf(state, event.side)} fainted!`)),
        animation: { kind: "faint", side: event.side, seq },
      };
    }
    case "chat":
      return { ...state, log: push(entry(event.user ? "chat" : "info", event.text, event.user || undefined)) };
    case "timer":
      return { ...state, timer: { ...state.timer, enabled: event.enabled, secondsLeft: event.secondsLeft } };
    case "win": {
      const text = event.winner === "draw" ? "Tie between both players!" : `${state.sides[event.winner].trainer.name} won the battle!`;
      return { ...state, phase: "ended", winner: event.winner, pendingChoice: null, log: push(entry("win", text)) };
    }
  }
}

function reducer(state: BattleState | null, action: Action) {
  return applyBattleEvent(state, action.event);
}

export interface BattleStream {
  state: BattleState | null;
  choose: (choice: BattleChoice) => void;
  cancel: () => void;
  toggleTimer: () => void;
  sendChat: (text: string) => void;
  rematch: () => void;
  /** Observe raw events (audio cues, analytics) without re-rendering. */
  subscribe: (listener: (event: BattleEvent, state: BattleState | null) => void) => Unsubscribe;
}

/**
 * Subscribes to a battle source and folds its events into BattleState.
 * TODO(realtime): pass a QuickNode Streams-backed BattleStreamSource
 * (or the Go API's match feed) instead of MockBattleStream; the UI is unchanged.
 */
export function useBattleStream(source: BattleStreamSource | null): BattleStream {
  const [state, dispatch] = useReducer(reducer, null);
  const stateRef = useRef<BattleState | null>(null);
  const listeners = useRef(new Set<(event: BattleEvent, state: BattleState | null) => void>());

  useEffect(() => {
    if (!source) return;
    return source.connect((event) => {
      stateRef.current = applyBattleEvent(stateRef.current, event);
      dispatch({ type: "event", event });
      listeners.current.forEach((l) => l(event, stateRef.current));
    });
  }, [source]);

  const subscribe = useCallback((listener: (event: BattleEvent, state: BattleState | null) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  return {
    state,
    choose: useCallback((choice: BattleChoice) => source?.choose(choice), [source]),
    cancel: useCallback(() => source?.cancel(), [source]),
    toggleTimer: useCallback(() => source?.setTimer(!stateRef.current?.timer.enabled), [source]),
    sendChat: useCallback((text: string) => source?.sendChat(text), [source]),
    rematch: useCallback(() => source?.rematch(), [source]),
    subscribe,
  };
}
