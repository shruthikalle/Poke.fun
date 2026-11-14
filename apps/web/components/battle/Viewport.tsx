"use client";

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
      {Array.from({ length: 6 }, (_, i) => {
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

function Sprite({ state, side }: { state: BattleState; side: Side }) {
  const s = state.sides[side];
  const creature = s.team[s.activeIndex];
  const anim = state.animation?.side === side ? state.animation : null;
  const facing = side === state.you ? "back" : "front";
  const hidden = state.phase === "connecting" && state.turn === 1 && !state.log.some((l) => l.kind === "switch");
  if (!creature || hidden) return null;
  return (
    <div className={styles.spriteSlot} data-role={facing}>
      <div key={anim ? `${anim.kind}-${anim.seq}` : "idle"} className={styles.spriteAction} data-anim={anim?.kind} data-fainted={creature.fainted || undefined}>
        <img className={styles.sprite} src={`/sprites/${creature.spriteId}-${facing}.png`} alt={creature.species} width={96} height={96} draggable={false} />
      </div>
      <div className={styles.shadow} />
    </div>
  );
}

export function Viewport({ state, odds }: { state: BattleState; odds: MarketOdds | null }) {
  const me = state.you;
  const foe = me === "p1" ? "p2" : "p1";
  const myActive = state.sides[me].team[state.sides[me].activeIndex];
  const foeActive = state.sides[foe].team[state.sides[foe].activeIndex];
  const started = state.log.some((l) => l.kind === "switch");
  return (
    <div className={styles.viewport}>
      <div className={styles.field} />
      {started && <div className={styles.turnBadge}>Turn {state.turn}</div>}
      {started && foeActive && !foeActive.fainted && <HpBar creature={foeActive} role="foe" />}
      {started && myActive && !myActive.fainted && <HpBar creature={myActive} role="me" />}
      <Sprite state={state} side={foe} />
      <Sprite state={state} side={me} />
      <TrainerStrip side={state.sides[foe]} you={false} odds={odds} position="right" />
      <TrainerStrip side={state.sides[me]} you odds={odds} position="left" />
      {state.phase === "ended" && (
        <div className={styles.banner}>{state.winner === "draw" ? "Draw!" : state.winner === me ? "You won!" : `${state.sides[foe].trainer.name} won!`}</div>
      )}
    </div>
  );
}
