"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/battle/battleApi";
import { applyBattleEvent } from "../../../lib/battle/BattleEngine";
import type { BattleEvent } from "../../../lib/battle/types";
import { verifyOutcomeProof, type OutcomeProof } from "../../../lib/results";

interface ReplayEnvelope extends OutcomeProof { replay: unknown }
interface ArenaFrame { tick: number; fighters: [ArenaFighter, ArenaFighter]; winner?: string }
interface ArenaFighter { x: number; y: number; hp: number; energy: number; attack?: string; attackHit?: boolean }
interface DuelTurn { number: number; attacks: [string, string]; damage: [number, number]; hp: [number, number] }
interface DuelReplay { history: DuelTurn[]; players: [{ card: { maxHp: number } }, { card: { maxHp: number } }] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

async function replayMatchesHash(replay: unknown, expected: string): Promise<boolean> {
  const json = JSON.stringify(canonical(replay)).replace(/[<>&\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" };
    return escapes[character];
  });
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") === expected;
}

export default function ReplayPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [record, setRecord] = useState<ReplayEnvelope | null>(null);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<boolean | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<ReplayEnvelope>("GET", `/api/replays/${encodeURIComponent(id)}`)
      .then(async (data) => {
        const hash = await replayMatchesHash(data.replay, data.result.stateHash);
        const signature = await verifyOutcomeProof(data);
        if (active) { setRecord(data); setVerified(hash && signature !== false ? signature : false); setError(""); setPosition(0); }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load replay."); });
    return () => { active = false; };
  }, [id]);

  const mode = record?.result.mode;
  const length = !record ? 0 : mode === "team" || mode === "arena" ? (record.replay as unknown[]).length : (record.replay as DuelReplay).history.length + 1;
  useEffect(() => {
    if (!playing || position >= length - 1) return;
    const timer = window.setTimeout(() => setPosition((current) => current + 1), mode === "arena" ? 50 : 650);
    return () => window.clearTimeout(timer);
  }, [playing, position, length, mode]);

  const teamState = useMemo(() => mode === "team" && record
    ? (record.replay as BattleEvent[]).slice(0, position + 1).reduce(applyBattleEvent, null)
    : null, [mode, record, position]);

  return <main style={{ maxWidth: 900, margin: "3rem auto", padding: "0 1rem", color: "white" }}>
    <Link href="/history">← Match history</Link>
    <h1>Match replay</h1>
    {error && <p role="alert">{error}</p>}
    {record && verified !== false && <>
      <p>{record.result.players[0].name} vs {record.result.players[1].name} · {mode} · {new Date(record.result.endedAt).toLocaleString()}</p>
      <p role="status">{verified === true ? "Signed result and replay verified" : verified === false ? "Replay verification failed" : "Replay hash verified; signature verification unavailable in this browser"}</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "1.5rem 0" }}>
        <button onClick={() => { if (position >= length - 1) setPosition(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
        <input type="range" aria-label="Replay position" min={0} max={Math.max(0, length - 1)} value={position} onChange={(event) => { setPlaying(false); setPosition(Number(event.target.value)); }} style={{ flex: 1 }} />
        <span>{position + 1} / {length}</span>
      </div>
      {mode === "team" && teamState && <section>
        <h2>Turn {teamState.turn} · {teamState.weather || "clear weather"}</h2>
        {(["p1", "p2"] as const).map((side) => {
          const fighter = teamState.sides[side].team[teamState.sides[side].activeIndex];
          return <p key={side}><strong>{teamState.sides[side].trainer.name}: {fighter.species}</strong> · {fighter.hp}/{fighter.maxHp} HP · {fighter.status || "healthy"}</p>;
        })}
        <ol>{teamState.log.slice(-12).map((item) => <li key={item.id}>{item.text.replaceAll("**", "")}</li>)}</ol>
      </section>}
      {mode === "duel" && (() => {
        const replay = record.replay as DuelReplay;
        const turn = replay.history[position - 1];
        const hp = turn?.hp ?? replay.players.map((player) => player.card.maxHp);
        return <section><h2>{turn ? `Turn ${turn.number}` : "Opening state"}</h2>
          <p>{record.result.players[0].name}: {hp[0]} HP · {record.result.players[1].name}: {hp[1]} HP</p>
          {turn && <p>{turn.attacks[0]} dealt {turn.damage[0]} · {turn.attacks[1]} dealt {turn.damage[1]}</p>}
        </section>;
      })()}
      {mode === "arena" && (() => {
        const frame = (record.replay as ArenaFrame[])[position];
        return <section><h2>Tick {frame.tick}</h2>
          <svg viewBox="0 0 960 540" role="img" aria-label="Arena fighter positions" style={{ width: "100%", background: "#202b36", borderRadius: 12 }}>
            {frame.fighters.map((fighter, index) => <g key={index}><circle cx={fighter.x} cy={fighter.y} r="25" fill={index === 0 ? "#47bbff" : "#ff6680"} /><text x={fighter.x} y={fighter.y - 35} textAnchor="middle" fill="white">{record.result.players[index].name} {fighter.hp} HP</text></g>)}
          </svg>
          <p>{frame.fighters.map((fighter, index) => `${record.result.players[index].name}: ${fighter.hp} HP${fighter.attack ? ` · ${fighter.attack}${fighter.attackHit ? " hit" : " missed"}` : ""}`).join(" | ")}</p>
        </section>;
      })()}
      <p>Winner: {record.result.winner === "draw" ? "Draw" : record.result.players[record.result.winner === "p1" ? 0 : 1].name} · {record.result.reason}</p>
    </>}
  </main>;
}
