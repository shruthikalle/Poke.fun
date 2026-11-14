"use client";

import { useEffect, useState } from "react";
import type { BattleState, Side, Unsubscribe } from "../battle/types";

export interface MarketOdds {
  matchId: string;
  /** Win probability per side, 0–1, summing to 1. */
  probability: Record<Side, number>;
  /** Change since the previous update, in probability points. */
  delta: Record<Side, number>;
  updatedAt: number;
  source: "mock" | "gemini";
}

export interface OddsSnapshot {
  hpFraction: Record<Side, number>;
  remaining: Record<Side, number>;
  winner: Side | "draw" | null;
}

export interface OddsProvider {
  subscribe(matchId: string, onOdds: (odds: MarketOdds) => void): Unsubscribe;
  /** Only the mock needs battle context; a real market ignores it. */
  reportSnapshot?(matchId: string, snapshot: OddsSnapshot): void;
}

export function snapshotFromState(state: BattleState): OddsSnapshot {
  const side = (s: Side) => {
    const team = state.sides[s].team;
    return {
      hp: team.reduce((sum, c) => sum + c.hp / c.maxHp, 0) / team.length,
      remaining: team.filter((c) => !c.fainted).length,
    };
  };
  const p1 = side("p1");
  const p2 = side("p2");
  return { hpFraction: { p1: p1.hp, p2: p2.hp }, remaining: { p1: p1.remaining, p2: p2.remaining }, winner: state.winner };
}

/** Derives plausible odds from battle progress. */
export class MockOddsProvider implements OddsProvider {
  private listeners = new Map<string, Set<(odds: MarketOdds) => void>>();
  private last = new Map<string, MarketOdds>();

  subscribe(matchId: string, onOdds: (odds: MarketOdds) => void): Unsubscribe {
    const set = this.listeners.get(matchId) ?? new Set();
    set.add(onOdds);
    this.listeners.set(matchId, set);
    const cached = this.last.get(matchId);
    if (cached) onOdds(cached);
    return () => { set.delete(onOdds); };
  }

  reportSnapshot(matchId: string, snapshot: OddsSnapshot) {
    let p1: number;
    if (snapshot.winner) p1 = snapshot.winner === "p1" ? 1 : snapshot.winner === "p2" ? 0 : 0.5;
    else {
      const edge = (snapshot.hpFraction.p1 - snapshot.hpFraction.p2) * 3 + (snapshot.remaining.p1 - snapshot.remaining.p2) * 0.15;
      p1 = Math.min(0.97, Math.max(0.03, 1 / (1 + Math.exp(-edge))));
    }
    const prev = this.last.get(matchId);
    const odds: MarketOdds = {
      matchId,
      probability: { p1, p2: 1 - p1 },
      delta: { p1: prev ? p1 - prev.probability.p1 : 0, p2: prev ? prev.probability.p1 - p1 : 0 },
      updatedAt: Date.now(),
      source: "mock",
    };
    if (prev && Math.abs(prev.probability.p1 - p1) < 0.001) return;
    this.last.set(matchId, odds);
    this.listeners.get(matchId)?.forEach((l) => l(odds));
  }
}

export const defaultOddsProvider: OddsProvider = new MockOddsProvider();

/**
 * Live win-probability for a match.
 * TODO(markets): back this with a Gemini prediction-markets OddsProvider
 * (subscribe to the market for matchId). Components don't change.
 */
export function useOdds(state: BattleState | null, provider: OddsProvider = defaultOddsProvider): MarketOdds | null {
  const [odds, setOdds] = useState<MarketOdds | null>(null);
  const matchId = state?.id ?? null;

  useEffect(() => {
    if (!matchId) return;
    setOdds(null);
    return provider.subscribe(matchId, setOdds);
  }, [matchId, provider]);

  useEffect(() => {
    if (state && provider.reportSnapshot) provider.reportSnapshot(state.id, snapshotFromState(state));
  }, [state, provider]);

  return odds;
}
