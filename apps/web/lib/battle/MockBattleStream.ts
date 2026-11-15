import { makeFormat } from "./roster";
import { chooseAiMove, computeDamage, effectiveSpeed } from "./rules";
import {
  otherSide,
  type BattleChoice, type BattleEvent, type BattleFormat, type BattleStreamSource, type Creature,
  type Side, type SideState, type Trainer, type Unsubscribe,
} from "./types";

const OPPONENT_LINES = ["gl hf", "nice switch", "oof", "that crit tho", "gg", "close one!"];

export interface MockBattleOptions {
  you: Trainer;
  opponent?: Trainer;
  /** Teams locked in at matchmaking. Each battle (and rematch) starts from a fresh copy. */
  teams: Record<Side, Creature[]>;
  format?: BattleFormat;
  /** Multiplier for every delay; tests can pass a small value. */
  speed?: number;
}

/**
 * In-memory stand-in for the live battle feed. It plays the matched
 * opponent's team and emits the same events a real transport would.
 */
export class MockBattleStream implements BattleStreamSource {
  private listener: ((event: BattleEvent) => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private sides!: Record<Side, SideState>;
  private turn = 1;
  private pending: BattleChoice | null = null;
  private needsSwitch = false;
  private awaiting = false;
  private over = false;
  private timerEnabled = false;
  private secondsLeft = 150;
  private readonly speed: number;
  private readonly you: Trainer;
  private readonly opponent: Trainer;
  private readonly teams: Record<Side, Creature[]>;
  private readonly format: BattleFormat;

  constructor(options: MockBattleOptions) {
    this.teams = options.teams;
    this.format = options.format ?? makeFormat("Champion 1v1", []);
    this.you = options.you;
    this.opponent = options.opponent ?? { id: "thar07", name: "thar07", avatar: "kai" };
    this.speed = options.speed ?? 1;
  }

  connect(listener: (event: BattleEvent) => void): Unsubscribe {
    this.listener = listener;
    this.start();
    return () => {
      this.listener = null;
      this.clearAll();
    };
  }

  choose(choice: BattleChoice): void {
    if (this.over || this.pending || !this.awaiting) return;
    const mine = this.sides.p1;
    if (choice.kind === "switch") {
      const target = mine.team[choice.teamIndex];
      if (!target || target.fainted || choice.teamIndex === mine.activeIndex) return;
    }
    if (this.needsSwitch) {
      if (choice.kind !== "switch") return;
      this.needsSwitch = false;
      this.awaiting = false;
      this.emit({ type: "resolving" });
      mine.activeIndex = choice.teamIndex;
      this.emit({ type: "switch", side: "p1", teamIndex: choice.teamIndex });
      this.later(700, () => this.beginTurn(false));
      return;
    }
    if (choice.kind === "move") {
      const m = mine.team[mine.activeIndex].moves[choice.moveIndex];
      if (!m || m.pp <= 0) return;
    }
    this.pending = choice;
    this.awaiting = false;
    this.emit({ type: "choice-accepted", choice });
    this.later(1200 + Math.random() * 1800, () => this.resolveTurn());
  }

  cancel(): void {
    if (!this.pending || this.over) return;
    this.pending = null;
    this.awaiting = true;
    this.clearTimeouts();
    this.emit({ type: "choice-cancelled" });
  }

  setTimer(enabled: boolean): void {
    this.timerEnabled = enabled;
    this.secondsLeft = 150;
    this.emit({ type: "timer", enabled, secondsLeft: enabled ? this.secondsLeft : null });
    if (enabled) this.emit({ type: "chat", user: "", text: `Battle timer is ON: if time runs out, a move is picked for you. (requested by ${this.you.name})` });
    else this.emit({ type: "chat", user: "", text: "Battle timer is now OFF." });
  }

  private lastChat = 0;

  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;
    const now = Date.now();
    if (now - this.lastChat < 600) {
      this.emit({ type: "chat", user: "", text: "You're sending messages too fast. Wait a moment." });
      return;
    }
    this.lastChat = now;
    this.emit({ type: "chat", user: this.you.name, text: trimmed });
    if (Math.random() < 0.4) {
      this.later(1500, () => this.emit({ type: "chat", user: this.opponent.name, text: OPPONENT_LINES[Math.floor(Math.random() * OPPONENT_LINES.length)] }));
    }
  }

  rematch(): void {
    this.clearAll();
    this.start();
  }

  private start() {
    this.turn = 1;
    this.pending = null;
    this.needsSwitch = false;
    this.awaiting = false;
    this.over = false;
    this.sides = {
      p1: { side: "p1", trainer: this.you, team: structuredClone(this.teams.p1), activeIndex: 0 },
      p2: { side: "p2", trainer: this.opponent, team: structuredClone(this.teams.p2), activeIndex: 0 },
    };
    this.emit({
      type: "init",
      state: {
        id: `battle-${Math.floor(Math.random() * 9e9) + 1e9}`,
        format: this.format,
        turn: 1,
        you: "p1",
        sides: structuredClone(this.sides),
        users: [this.you.name],
        pendingChoice: null,
        winner: null,
        timer: { enabled: this.timerEnabled, secondsLeft: this.timerEnabled ? 150 : null, secondsPerTurn: 150 },
      },
    });
    this.later(150, () => this.emit({ type: "join", name: this.opponent.name }));
    this.later(300, () => this.emit({ type: "join", name: this.you.name }));
    this.later(600, () => {
      this.emit({ type: "start" });
      this.emit({ type: "switch", side: "p2", teamIndex: 0 });
    });
    this.later(1100, () => this.emit({ type: "switch", side: "p1", teamIndex: 0 }));
    this.later(1500, () => this.beginTurn(true));
    this.startTicker();
  }

  private beginTurn(first: boolean) {
    if (!first) this.turn += 1;
    this.secondsLeft = 150;
    this.emit({ type: "turn", turn: this.turn });
    if (this.timerEnabled) this.emit({ type: "timer", enabled: true, secondsLeft: this.secondsLeft });
    this.awaiting = true;
    this.emit({ type: "request", phase: "choosing" });
  }

  private resolveTurn() {
    const choice = this.pending;
    if (!choice) return;
    this.pending = null;
    this.emit({ type: "resolving" });
    const steps: Array<() => void> = [];
    const p1 = this.sides.p1;
    const p2 = this.sides.p2;

    if (choice.kind === "switch") {
      steps.push(() => {
        p1.activeIndex = choice.teamIndex;
        this.emit({ type: "switch", side: "p1", teamIndex: choice.teamIndex });
      });
    }

    const opponentMove = this.pickOpponentMove();
    const order: Array<{ side: Side; moveIndex: number }> = [];
    if (choice.kind === "move") order.push({ side: "p1", moveIndex: choice.moveIndex });
    order.push({ side: "p2", moveIndex: opponentMove });
    order.sort((a, b) => this.speedOf(b.side) - this.speedOf(a.side));

    for (const action of order) {
      steps.push(() => this.performMove(action.side, action.moveIndex));
    }

    this.runSteps(steps, () => {
      if (this.over) return;
      if (p2.team[p2.activeIndex].fainted) {
        const next = p2.team.findIndex((c) => !c.fainted);
        p2.activeIndex = next;
        this.emit({ type: "switch", side: "p2", teamIndex: next });
      }
      if (p1.team[p1.activeIndex].fainted) {
        this.needsSwitch = true;
        this.awaiting = true;
        this.emit({ type: "request", phase: "switching" });
        return;
      }
      this.later(500, () => this.beginTurn(false));
    });
  }

  private runSteps(steps: Array<() => void>, done: () => void) {
    const [head, ...rest] = steps;
    if (!head || this.over) {
      this.later(400, done);
      return;
    }
    head();
    this.later(1100, () => this.runSteps(rest, done));
  }

  private performMove(side: Side, moveIndex: number) {
    const attacker = this.active(side);
    const defenderSide = otherSide(side);
    const defender = this.active(defenderSide);
    if (attacker.fainted || defender.fainted) return;
    const m = attacker.moves[moveIndex];
    m.pp = Math.max(0, m.pp - 1);
    this.emit({ type: "move", side, moveIndex, ppLeft: m.pp });

    this.later(450, () => {
      if (Math.random() * 100 >= m.accuracy) {
        this.emit({ type: "miss", side: defenderSide });
        return;
      }
      const { damage, effectiveness, crit } = computeDamage(attacker, defender, m);
      defender.hp = Math.max(0, defender.hp - damage);
      this.emit({ type: "damage", side: defenderSide, hp: defender.hp, effectiveness, crit });
      if (defender.hp === 0) {
        defender.fainted = true;
        this.later(500, () => {
          this.emit({ type: "faint", side: defenderSide });
          this.checkWinner();
        });
      }
    });
  }

  private checkWinner() {
    const p1Out = this.sides.p1.team.every((c) => c.fainted);
    const p2Out = this.sides.p2.team.every((c) => c.fainted);
    if (!p1Out && !p2Out) return;
    this.over = true;
    this.stopTicker();
    const winner = p1Out && p2Out ? "draw" : p1Out ? "p2" : "p1";
    this.later(600, () => {
      this.emit({ type: "win", winner });
      this.emit({ type: "chat", user: this.opponent.name, text: "gg" });
    });
  }

  private pickOpponentMove(): number {
    return chooseAiMove(this.active("p2"), this.active("p1"));
  }

  private speedOf(side: Side) {
    return effectiveSpeed(this.active(side));
  }

  private active(side: Side): Creature {
    const s = this.sides[side];
    return s.team[s.activeIndex];
  }

  private startTicker() {
    this.stopTicker();
    this.tick = setInterval(() => {
      if (!this.timerEnabled || this.over) return;
      this.secondsLeft = Math.max(0, this.secondsLeft - 1);
      this.emit({ type: "timer", enabled: true, secondsLeft: this.secondsLeft });
      if (this.secondsLeft === 0 && this.awaiting) {
        const mine = this.active("p1");
        if (this.needsSwitch) {
          this.choose({ kind: "switch", teamIndex: this.sides.p1.team.findIndex((c) => !c.fainted) });
        } else {
          const usable = mine.moves.findIndex((m) => m.pp > 0);
          this.emit({ type: "chat", user: "", text: `${this.you.name} ran out of time; a move was picked automatically.` });
          this.choose({ kind: "move", moveIndex: Math.max(0, usable) });
        }
      }
    }, 1000);
  }

  private stopTicker() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms * this.speed);
    this.timers.add(id);
  }

  private clearTimeouts() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  private clearAll() {
    this.clearTimeouts();
    this.stopTicker();
  }

  private emit(event: BattleEvent) {
    this.listener?.(event);
  }
}
