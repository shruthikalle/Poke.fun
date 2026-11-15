import type {
  BattleChoice, BattleEvent, BattleFormat, BattleStreamSource, Creature, Side, Trainer, Unsubscribe,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface ServerBattleOptions {
  you: Trainer;
  opponent: Trainer;
  /** Teams built from PokéAPI, same shape the mock used. */
  teams: Record<Side, Creature[]>;
  format: BattleFormat;
  /** Multiplier for animation pacing; tests can pass a small value. */
  speed?: number;
  seed?: number;
}

// Per-event animation pacing (ms), so the server's instant resolution still
// plays out like a battle. The reducer is unchanged; only timing lives here.
const DELAY: Record<string, number> = {
  init: 0, join: 150, start: 250, switch: 650, turn: 350, request: 50,
  resolving: 220, move: 900, damage: 500, miss: 500, faint: 600,
  "choice-accepted": 0, "choice-cancelled": 0, chat: 150, timer: 0, win: 700, leave: 150,
};

const TURN_SECONDS = 150;

/**
 * Authoritative battle transport. The Go server decides every outcome; this
 * client posts the player's choices, receives the resulting event batch and
 * replays it with animation pacing. Replaces MockBattleStream.
 */
export class ServerBattleStream implements BattleStreamSource {
  private listener: ((event: BattleEvent) => void) | null = null;
  private id = "";
  private token = "";
  private readonly opts: ServerBattleOptions;
  private readonly speed: number;

  private queue: BattleEvent[] = [];
  private pumping = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  private awaiting = false;
  private needsSwitch = false;
  private over = false;
  private pendingChoice: BattleChoice | null = null;
  private timerEnabled = false;
  private secondsLeft = TURN_SECONDS;
  private lastChat = 0;

  constructor(opts: ServerBattleOptions) {
    this.opts = opts;
    this.speed = opts.speed ?? 1;
  }

  connect(listener: (event: BattleEvent) => void): Unsubscribe {
    this.listener = listener;
    void this.start();
    return () => {
      this.listener = null;
      this.clearAll();
    };
  }

  private async start() {
    try {
      const r = await this.post("/api/battles", {
        you: this.opts.you,
        opponent: this.opts.opponent,
        teams: this.opts.teams,
        format: this.opts.format,
        seed: this.opts.seed ?? 0,
      });
      if (!this.listener) return; // disconnected while awaiting
      this.id = r.id;
      this.token = r.token;
      this.enqueue(r.events);
      this.startTicker();
    } catch {
      this.emitNow({ type: "chat", user: "", text: "Couldn't reach the battle server. Start the Go API on :8080 and reopen the match." });
    }
  }

  choose(choice: BattleChoice): void {
    if (this.over || this.pendingChoice || !this.awaiting) return;
    this.pendingChoice = choice;
    this.awaiting = false;
    this.emitNow({ type: "choice-accepted", choice });
    if (this.needsSwitch) {
      void this.commit();
      return;
    }
    // Brief commit window so Cancel can still take the choice back before the
    // server resolves (the server advances atomically on commit).
    this.commitTimer = this.schedule(900 + Math.random() * 800, () => void this.commit());
  }

  cancel(): void {
    if (!this.pendingChoice || this.over) return;
    if (this.commitTimer === null) return; // already sent to the server
    clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.pendingChoice = null;
    this.awaiting = true;
    this.emitNow({ type: "choice-cancelled" });
  }

  private async commit() {
    this.commitTimer = null;
    const choice = this.pendingChoice;
    if (!choice || !this.id) return;
    try {
      const r = await this.post(`/api/battles/${this.id}/choice`, choice, this.token);
      this.pendingChoice = null;
      // The server echoes choice-accepted first; we already emitted it.
      const events = (r.events as BattleEvent[]).filter((e, i) => !(i === 0 && e.type === "choice-accepted"));
      this.enqueue(events);
    } catch {
      this.pendingChoice = null;
      this.emitNow({ type: "chat", user: "", text: "That move didn't go through. Try again." });
      this.awaiting = true;
    }
  }

  setTimer(enabled: boolean): void {
    this.timerEnabled = enabled;
    this.secondsLeft = TURN_SECONDS;
    if (this.id) void this.send(`/api/battles/${this.id}/timer`, { enabled });
    else this.emitNow({ type: "timer", enabled, secondsLeft: enabled ? TURN_SECONDS : null });
  }

  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;
    const now = Date.now();
    if (now - this.lastChat < 600) {
      this.emitNow({ type: "chat", user: "", text: "You're sending messages too fast. Wait a moment." });
      return;
    }
    this.lastChat = now;
    if (this.id) void this.send(`/api/battles/${this.id}/chat`, { text: trimmed });
    else this.emitNow({ type: "chat", user: this.opts.you.name, text: trimmed });
  }

  rematch(): void {
    this.clearTimeouts();
    this.queue = [];
    this.pumping = false;
    this.over = false;
    this.awaiting = false;
    this.needsSwitch = false;
    this.pendingChoice = null;
    if (this.id) void this.send(`/api/battles/${this.id}/rematch`, {}).then((r) => r && this.enqueue(r.events));
  }

  /** POST that returns parsed JSON (create/choice). */
  private async post(path: string, body: unknown, token?: string): Promise<any> {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }

  /** POST whose event batch is enqueued (timer/chat/rematch). */
  private async send(path: string, body: unknown): Promise<{ events: BattleEvent[] } | null> {
    try {
      const r = await this.post(path, body, this.token);
      this.enqueue(r.events);
      return r;
    } catch {
      return null;
    }
  }

  private enqueue(events: BattleEvent[]) {
    this.queue.push(...events);
    this.pump();
  }

  private pump() {
    if (this.pumping) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pumping = true;
    const delay = DELAY[next.type] ?? 0;
    this.schedule(delay, () => {
      this.pumping = false;
      this.apply(next);
      this.pump();
    });
  }

  private apply(event: BattleEvent) {
    switch (event.type) {
      case "request":
        this.awaiting = true;
        this.needsSwitch = event.phase === "switching";
        this.secondsLeft = TURN_SECONDS;
        break;
      case "choice-accepted":
        this.awaiting = false;
        break;
      case "win":
        this.over = true;
        this.stopTicker();
        break;
    }
    this.emitNow(event);
  }

  private startTicker() {
    this.stopTicker();
    this.tick = setInterval(() => {
      if (!this.timerEnabled || this.over) return;
      this.secondsLeft = Math.max(0, this.secondsLeft - 1);
      this.emitNow({ type: "timer", enabled: true, secondsLeft: this.secondsLeft });
      if (this.secondsLeft === 0 && this.awaiting && !this.needsSwitch && !this.pendingChoice) {
        // Best-effort auto-move; the server validates it authoritatively.
        this.emitNow({ type: "chat", user: "", text: `${this.opts.you.name} ran out of time; a move was picked automatically.` });
        this.choose({ kind: "move", moveIndex: 0 });
      }
    }, 1000);
  }

  private stopTicker() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private schedule(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms * this.speed);
    this.timers.add(id);
    return id;
  }

  private clearTimeouts() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private clearAll() {
    this.clearTimeouts();
    this.stopTicker();
  }

  private emitNow(event: BattleEvent) {
    this.listener?.(event);
  }
}
