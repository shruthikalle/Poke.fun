import { EventPacer } from "./eventPacer";
import type {
  BattleChoice, BattleEvent, BattleFormat, BattleStreamSource, Creature, Side, Trainer, Unsubscribe,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const TURN_SECONDS = 150;

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

/**
 * Authoritative battle transport. The Go server decides every outcome; this
 * client posts the player's choices, receives the resulting event batch and
 * replays it (via EventPacer) with animation pacing. Replaces MockBattleStream;
 * the reducer and UI are unchanged.
 */
export class ServerBattleStream implements BattleStreamSource {
  private listener: ((event: BattleEvent) => void) | null = null;
  private id = "";
  private token = "";
  private readonly opts: ServerBattleOptions;
  private readonly pacer: EventPacer;
  private readonly speed: number;

  // Turn state, tracked only well enough to gate input and run the timer; the
  // reducer owns the authoritative view.
  private awaiting = false;
  private needsSwitch = false;
  private over = false;
  private pendingChoice: BattleChoice | null = null;

  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private timerEnabled = false;
  private secondsLeft = TURN_SECONDS;
  private lastChat = 0;

  constructor(opts: ServerBattleOptions) {
    this.opts = opts;
    this.speed = opts.speed ?? 1;
    this.pacer = new EventPacer((event) => this.apply(event), this.speed);
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
      if (!this.listener) return; // disconnected while awaiting the response
      this.id = r.id;
      this.token = r.token;
      this.pacer.enqueue(r.events);
      this.startTicker();
    } catch {
      this.emit({ type: "chat", user: "", text: "Couldn't reach the battle server. Start the Go API on :8080 and reopen the match." });
    }
  }

  choose(choice: BattleChoice): void {
    if (this.over || this.pendingChoice || !this.awaiting) return;
    this.pendingChoice = choice;
    this.awaiting = false;
    // A forced switch resolves immediately with no cancel window (and the
    // server returns no choice-accepted for it, so we emit none here either).
    if (this.needsSwitch) {
      void this.commit();
      return;
    }
    // Normal choice: lock it in optimistically, but leave a brief window so
    // Cancel can take it back before the server resolves the turn atomically.
    this.emit({ type: "choice-accepted", choice });
    this.commitTimer = setTimeout(() => void this.commit(), (900 + Math.random() * 800) * this.speed);
  }

  cancel(): void {
    if (!this.pendingChoice || this.over || this.commitTimer === null) return; // already committed
    clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.pendingChoice = null;
    this.awaiting = true;
    this.emit({ type: "choice-cancelled" });
  }

  private async commit() {
    this.commitTimer = null;
    const choice = this.pendingChoice;
    if (!choice || !this.id) return;
    try {
      const r = await this.post(`/api/battles/${this.id}/choice`, choice, this.token);
      this.pendingChoice = null;
      // The server echoes choice-accepted first for a normal choice; we already
      // emitted that optimistically, so drop a leading one to avoid duplicates.
      const events = (r.events as BattleEvent[]).filter((e, i) => !(i === 0 && e.type === "choice-accepted"));
      this.pacer.enqueue(events);
    } catch {
      this.pendingChoice = null;
      this.awaiting = true;
      this.emit({ type: "chat", user: "", text: "That move didn't go through. Try again." });
    }
  }

  setTimer(enabled: boolean): void {
    this.timerEnabled = enabled;
    this.secondsLeft = TURN_SECONDS;
    if (this.id) void this.send(`/api/battles/${this.id}/timer`, { enabled });
    else this.emit({ type: "timer", enabled, secondsLeft: enabled ? TURN_SECONDS : null });
  }

  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;
    const now = Date.now();
    if (now - this.lastChat < 600) {
      this.emit({ type: "chat", user: "", text: "You're sending messages too fast. Wait a moment." });
      return;
    }
    this.lastChat = now;
    if (this.id) void this.send(`/api/battles/${this.id}/chat`, { text: trimmed });
    else this.emit({ type: "chat", user: this.opts.you.name, text: trimmed });
  }

  rematch(): void {
    this.clearAll();
    this.over = false;
    this.awaiting = false;
    this.needsSwitch = false;
    this.pendingChoice = null;
    this.secondsLeft = TURN_SECONDS;
    if (this.id) {
      void this.send(`/api/battles/${this.id}/rematch`, {});
      this.startTicker();
    }
  }

  /** POST returning parsed JSON (create/choice). Throws on a non-2xx response. */
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

  /** POST whose returned event batch is paced out (timer/chat/rematch). */
  private async send(path: string, body: unknown): Promise<void> {
    try {
      const r = await this.post(path, body, this.token);
      this.pacer.enqueue(r.events);
    } catch {
      /* non-critical side channel; ignore */
    }
  }

  /** Pacer callback: fold turn state, then forward the event to the listener. */
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
    this.emit(event);
  }

  private startTicker() {
    this.stopTicker();
    this.tick = setInterval(() => {
      if (!this.timerEnabled || this.over) return;
      this.secondsLeft = Math.max(0, this.secondsLeft - 1);
      this.emit({ type: "timer", enabled: true, secondsLeft: this.secondsLeft });
      if (this.secondsLeft === 0 && this.awaiting && !this.needsSwitch && !this.pendingChoice) {
        // Best-effort auto-move; the server validates it authoritatively.
        this.emit({ type: "chat", user: "", text: `${this.opts.you.name} ran out of time; a move was picked automatically.` });
        this.choose({ kind: "move", moveIndex: 0 });
      }
    }, 1000);
  }

  private stopTicker() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private clearAll() {
    this.pacer.clear();
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.stopTicker();
  }

  /** Emit immediately, outside the pacer (optimistic feedback and the timer). */
  private emit(event: BattleEvent) {
    this.listener?.(event);
  }
}
