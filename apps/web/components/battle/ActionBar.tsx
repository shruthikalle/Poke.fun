"use client";

import Link from "next/link";
import type { BattleChoice, BattleState } from "../../lib/battle/types";
import { TYPE_COLORS } from "../../lib/battle/roster";
import { formatClock, hpPercent } from "./format";
import styles from "./battle.module.css";

interface Props {
  state: BattleState;
  choose: (choice: BattleChoice) => void;
  cancel: () => void;
  toggleTimer: () => void;
  rematch: () => void;
}

function TimerButton({ state, toggleTimer }: Pick<Props, "state" | "toggleTimer">) {
  const { enabled, secondsLeft } = state.timer;
  const low = enabled && secondsLeft !== null && secondsLeft <= 30;
  return (
    <button className={styles.timer} data-on={enabled || undefined} data-low={low || undefined} onClick={toggleTimer} title={enabled ? "Turn off the battle timer" : "Start the battle timer"}>
      <span className={styles.clock} aria-hidden="true" />
      {enabled && secondsLeft !== null ? formatClock(secondsLeft) : "Timer"}
    </button>
  );
}

export function ActionBar({ state, choose, cancel, toggleTimer, rematch }: Props) {
  const mine = state.sides[state.you];
  const active = mine.team[mine.activeIndex];

  if (state.phase === "ended") {
    return (
      <div className={styles.actions}>
        <p className={styles.prompt}><strong>{state.winner === "draw" ? "The battle ended in a draw." : state.winner === state.you ? "You won the battle!" : `${state.sides[state.winner === "p1" ? "p1" : "p2"].trainer.name} won the battle.`}</strong></p>
        <div className={styles.endRow}>
          <button className={styles.button} onClick={rematch}>Rematch</button>
          <Link className={styles.button} href="/">Main menu</Link>
        </div>
      </div>
    );
  }

  if (state.phase === "connecting" || state.phase === "resolving" || !active) {
    return (
      <div className={styles.actions}>
        <div className={styles.actionHead}>
          <p className={styles.waiting}>{state.phase === "connecting" ? "Starting battle..." : "Turn in progress..."}</p>
          <TimerButton state={state} toggleTimer={toggleTimer} />
        </div>
      </div>
    );
  }

  if (state.phase === "waiting" && state.pendingChoice) {
    const c = state.pendingChoice;
    const what = c.kind === "move" ? `${active.species} will use ${active.moves[c.moveIndex].name}.` : `${active.species} will be switched out for ${mine.team[c.teamIndex].species}.`;
    return (
      <div className={styles.actions}>
        <div className={styles.actionHead}>
          <div>
            <p className={styles.prompt}>{what}</p>
            <p className={styles.waiting}>Waiting for opponent... <button className={styles.button} onClick={cancel}>Cancel</button></p>
          </div>
          <TimerButton state={state} toggleTimer={toggleTimer} />
        </div>
      </div>
    );
  }

  const forced = state.phase === "switching";
  return (
    <div className={styles.actions}>
      <div className={styles.actionHead}>
        <p className={styles.prompt}>{forced ? <>Switch <strong>{active.species}</strong> to:</> : <>What will <strong>{active.species}</strong> do?</>}</p>
        <TimerButton state={state} toggleTimer={toggleTimer} />
      </div>

      {!forced && (
        <>
          <div className={styles.label}>Attack</div>
          <div className={styles.moves}>
            {active.moves.map((m, i) => (
              <button key={m.id} className={styles.move} style={{ "--type": TYPE_COLORS[m.type] } as React.CSSProperties}
                disabled={m.pp <= 0} onClick={() => choose({ kind: "move", moveIndex: i })}
                title={`${m.name}: ${m.type} · ${m.category} · Power ${m.power} · Accuracy ${m.accuracy}%`}>
                <span className={styles.moveName}>{m.name}</span>
                <small className={styles.moveType}>{m.type}</small>
                <small className={styles.movePp}>{m.pp}/{m.maxPp}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={styles.label}>Switch</div>
      <div className={styles.switches}>
        {mine.team.map((c, i) => {
          const isActive = i === mine.activeIndex;
          const pct = hpPercent(c.hp, c.maxHp);
          return (
            <button key={c.id} className={styles.switch} disabled={c.fainted || isActive} data-active={isActive || undefined} data-fainted={c.fainted || undefined}
              onClick={() => choose({ kind: "switch", teamIndex: i })} title={`${c.species} · L${c.level} · ${pct}% HP${isActive ? " · active" : ""}`}>
              <img src={`/sprites/${c.spriteId}-front.png`} alt="" width={24} height={24} />
              <span>{c.species}</span>
              <i className={styles.miniHp}><b style={{ width: `${pct}%` }} /></i>
            </button>
          );
        })}
      </div>
    </div>
  );
}
