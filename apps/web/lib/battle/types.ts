export type ElementType =
  | "Normal" | "Fire" | "Water" | "Grass" | "Electric" | "Ice" | "Fighting" | "Ground"
  | "Flying" | "Psychic" | "Rock" | "Ghost" | "Dragon" | "Dark" | "Fairy";

export type Side = "p1" | "p2";

export const otherSide = (side: Side): Side => (side === "p1" ? "p2" : "p1");

export type MoveCategory = "physical" | "special";

export interface Move {
  id: string;
  name: string;
  type: ElementType;
  category: MoveCategory;
  power: number;
  accuracy: number;
  pp: number;
  maxPp: number;
}

export interface Creature {
  id: string;
  species: string;
  spriteId: string;
  level: number;
  gender: "M" | "F" | null;
  types: ElementType[];
  hp: number;
  maxHp: number;
  moves: Move[];
  fainted: boolean;
}

export interface Trainer {
  id: string;
  name: string;
  avatar: string;
}

export interface SideState {
  side: Side;
  trainer: Trainer;
  team: Creature[];
  activeIndex: number;
}

export interface BattleRule {
  name: string;
  description: string;
}

export interface BattleFormat {
  name: string;
  rated: boolean;
  rules: BattleRule[];
}

export type BattlePhase = "connecting" | "choosing" | "waiting" | "switching" | "resolving" | "ended";

export type BattleChoice =
  | { kind: "move"; moveIndex: number }
  | { kind: "switch"; teamIndex: number };

export type LogKind =
  | "join" | "leave" | "start" | "turn" | "move" | "damage" | "effect" | "miss"
  | "faint" | "switch" | "chat" | "info" | "win" | "timer";

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  user?: string;
}

export interface TimerState {
  enabled: boolean;
  secondsLeft: number | null;
  secondsPerTurn: number;
}

export type BattleAnimation =
  | { kind: "attack"; side: Side }
  | { kind: "hit"; side: Side }
  | { kind: "faint"; side: Side }
  | { kind: "switch-in"; side: Side };

export interface BattleState {
  id: string;
  format: BattleFormat;
  turn: number;
  phase: BattlePhase;
  you: Side;
  sides: Record<Side, SideState>;
  log: LogEntry[];
  users: string[];
  pendingChoice: BattleChoice | null;
  winner: Side | "draw" | null;
  timer: TimerState;
  animation: (BattleAnimation & { seq: number }) | null;
}

export type Effectiveness = "super" | "resisted" | "immune" | "normal";

/**
 * Wire events pushed by a battle source. The client reducer is the only
 * consumer, so a real transport only needs to emit these shapes.
 */
export type BattleEvent =
  | { type: "init"; state: Omit<BattleState, "log" | "animation" | "phase"> }
  | { type: "join"; name: string }
  | { type: "leave"; name: string }
  | { type: "start" }
  | { type: "turn"; turn: number }
  | { type: "request"; phase: "choosing" | "switching" }
  | { type: "choice-accepted"; choice: BattleChoice }
  | { type: "choice-cancelled" }
  | { type: "resolving" }
  | { type: "switch"; side: Side; teamIndex: number }
  | { type: "move"; side: Side; moveIndex: number; ppLeft: number }
  | { type: "damage"; side: Side; hp: number; effectiveness: Effectiveness; crit: boolean }
  | { type: "miss"; side: Side }
  | { type: "faint"; side: Side }
  | { type: "chat"; user: string; text: string }
  | { type: "timer"; enabled: boolean; secondsLeft: number | null }
  | { type: "win"; winner: Side | "draw" };

export type Unsubscribe = () => void;

/**
 * Transport seam for live battles. The UI only talks to this interface.
 */
export interface BattleStreamSource {
  connect(listener: (event: BattleEvent) => void): Unsubscribe;
  choose(choice: BattleChoice): void;
  cancel(): void;
  setTimer(enabled: boolean): void;
  sendChat(text: string): void;
  rematch(): void;
}
