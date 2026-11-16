"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CardSummon } from "../summon/CardSummon";
import type { BattleState, Creature, Side, SideState } from "../../lib/battle/types";
import type { MarketOdds } from "../../lib/markets/useOdds";
import { hpPercent } from "./format";
import { OddsChip } from "./OddsChip";
import styles from "./battle.module.css";

function HpBar({ creature, role }: { creature: Creature; role: "foe" | "me" }) {
  const pct = hpPercent(creature.hp, creature.maxHp);
  const tone = pct > 50 ? "good" : pct > 20 ? "warn" : "bad";
  return (
    <div className={styles.statbar} data-role={role}>
      <div className={styles.statName}>
        <strong>{creature.species}</strong>
        {creature.gender && <span className={creature.gender === "M" ? styles.male : styles.female}>{creature.gender === "M" ? "♂" : "♀"}</span>}
        <small>L{creature.level}</small>
        {creature.status && <small title="Status condition">{creature.status.toUpperCase()}</small>}
        {!!creature.confused && <small title="Confused">CONFUSED</small>}
      </div>
      <div className={styles.hpRow}>
        <span className={styles.hpText}>{pct}%</span>
        <div className={styles.hpOuter} role="meter" aria-label={`${creature.species} health`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.hpLag} style={{ width: `${pct}%` }} />
          <div className={styles.hpFill} data-tone={tone} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function TeamBalls({ side, you }: { side: SideState; you: boolean }) {
  return (
    <div className={styles.balls}>
      {Array.from({ length: Math.max(1, side.team.length) }, (_, i) => {
        const c = side.team[i];
        const state = !c ? "empty" : c.fainted ? "fainted" : i === side.activeIndex ? "active" : "healthy";
        const label = !c ? "Empty slot" : you || c.fainted || i === side.activeIndex ? `${c.species} (${hpPercent(c.hp, c.maxHp)}%)` : "Not revealed yet";
        return <span key={i} className={styles.ball} data-state={state} title={label} aria-label={label} />;
      })}
    </div>
  );
}

function TrainerStrip({ side, you, odds, position }: { side: SideState; you: boolean; odds: MarketOdds | null; position: "left" | "right" }) {
  return (
    <div className={styles.strip} data-position={position}>
      <div className={styles.trainerName}>{side.trainer.name}</div>
      <OddsChip odds={odds} side={side.side} />
      <img className={styles.trainerSprite} src={`/trainers/${side.trainer.avatar}.png`} alt="" width={80} height={80} />
      <TeamBalls side={side} you={you} />
    </div>
  );
}

function Sprite({ state, side, summon, summoning, onLanded }: { state: BattleState; side: Side; summon: boolean; summoning: boolean; onLanded: () => void }) {
  const s = state.sides[side];
  const creature = s.team[s.activeIndex];
  const anim = state.animation?.side === side ? state.animation : null;
  const facing = side === state.you ? "back" : "front";
  const hidden = state.phase === "connecting" && state.turn === 1 && !state.log.some((l) => l.kind === "switch");
  if (!creature || hidden) return null;
  if (summoning) {
    return (
      <div className={styles.spriteSlot} data-role={facing}>
        <CardSummon mode="mini" card={{ image: creature.cardArt ?? null, label: creature.species, grade: null }}
          species={{ name: creature.species, types: creature.types, sprites: creature.sprites }}
          from={facing === "back" ? "left" : "right"} facing={facing} spriteScale={facing === "back" ? 1.6 : 1.35} onDone={onLanded} />
        <div className={styles.shadow} />
      </div>
    );
  }
  const kind = summon && anim?.kind === "switch-in" ? undefined : anim?.kind;
  return (
    <div className={styles.spriteSlot} data-role={facing}>
      <div key={anim ? `${anim.kind}-${anim.seq}` : "idle"} className={styles.spriteAction} data-anim={kind} data-fainted={creature.fainted || undefined}>
        <img key={creature.id} className={styles.sprite} src={facing === "back" ? creature.sprites.back : creature.sprites.front} alt={creature.species} draggable={false}
          onError={(e) => { const fallback = facing === "back" ? creature.sprites.backStatic : creature.sprites.frontStatic; if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback; }} />
      </div>
      <div className={styles.shadow} />
    </div>
  );
}

export function Viewport({ state, odds, badge, summon = false }: { state: BattleState; odds: MarketOdds | null; badge?: ReactNode; summon?: boolean }) {
  const [summoning, setSummoning] = useState<Record<Side, number | null>>({ p1: null, p2: null });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const anim = state.animation;
  useEffect(() => {
    if (!summon || !anim || anim.kind !== "switch-in") return;
    const { side, seq } = anim;
    setSummoning((s) => ({ ...s, [side]: seq }));
    // Safety net: never leave a sprite hidden if the summon can't finish.
    timers.current.push(setTimeout(() => setSummoning((s) => (s[side] === seq ? { ...s, [side]: null } : s)), 2500));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summon, anim?.seq]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const landed = (side: Side) => () => setSummoning((s) => ({ ...s, [side]: null }));
  const me = state.you;
  const foe = me === "p1" ? "p2" : "p1";
  const myActive = state.sides[me].team[state.sides[me].activeIndex];
  const foeActive = state.sides[foe].team[state.sides[foe].activeIndex];
  const started = state.log.some((l) => l.kind === "switch");
  return (
    <div className={styles.viewport}>
      <div className={styles.field} />
      {started && <div className={styles.turnBadge}>Turn {state.turn}</div>}
      {!started && (
        <div className={styles.intro} aria-live="polite">
          <div className={styles.introSide}><img src={`/trainers/${state.sides[me].trainer.avatar}.png`} alt="" width={72} height={72} /><strong>{state.sides[me].trainer.name}</strong></div>
          <div className={styles.introVs}><span>{state.format.name.replace(/^\[[^\]]*\]\s*/, "")}</span><b>VS</b><small>Get ready…</small></div>
          <div className={styles.introSide}><img src={`/trainers/${state.sides[foe].trainer.avatar}.png`} alt="" width={72} height={72} /><strong>{state.sides[foe].trainer.name}</strong></div>
        </div>
      )}
      {badge && <div className={styles.stakeBadge}>{badge}</div>}
      {started && foeActive && !foeActive.fainted && summoning[foe] === null && <HpBar creature={foeActive} role="foe" />}
      {started && myActive && !myActive.fainted && summoning[me] === null && <HpBar creature={myActive} role="me" />}
      <Sprite state={state} side={foe} summon={summon} summoning={summoning[foe] !== null} onLanded={landed(foe)} />
      <Sprite state={state} side={me} summon={summon} summoning={summoning[me] !== null} onLanded={landed(me)} />
      <TrainerStrip side={state.sides[foe]} you={false} odds={odds} position="right" />
      <TrainerStrip side={state.sides[me]} you odds={odds} position="left" />
      {state.phase === "ended" && (
        <div className={styles.banner}>{state.winner === "draw" ? "Draw!" : state.winner === me ? "You won!" : `${state.sides[foe].trainer.name} won!`}</div>
      )}
    </div>
  );
}
