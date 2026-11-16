import { ApiError, apiRequest } from "./battleApi";
import { BattleFeed, type FeedBatch } from "./battleFeed";
import { EventPacer } from "./eventPacer";
import { MockBattleStream } from "./MockBattleStream";
import type {
  BattleChoice, BattleEvent, BattleFormat, BattleStreamSource, Creature, Side, Trainer, Unsubscribe,
} from "./types";

const TURN_SECONDS = 150;
/** How long to wait for a matched opponent to bring their team before giving up. */
const NO_SHOW_MS = 30_000;

/** Single player: the client sends both teams and the server plays side p2. */
interface AiOptions {
  mode: "ai";
  you: Trainer;
  opponent: Trainer;
  teams: Record<Side, Creature[]>;
  format: BattleFormat;
  seed?: number;
}

/** Two players: matchmaking already created the battle and assigned our side. */
interface PvpOptions {
  mode: "pvp";
  battleId: string;
  token: string;
  side: Side;
  /** Our own team; the opponent's arrives in the shared init event. */
  team: Creature[];
  format: BattleFormat;
}

export type ServerBattleOptions = (AiOptions | PvpOptions) & {
  /** Multiplier for animation pacing; tests can pass a small value. */
  speed?: number;
  /**
   * Status shown before the battle exists (the reducer ignores events until
   * init), e.g. waiting for the opponent's team or the server being down.
   */
  onStatus?: (message: string) => void;
};

/**
 * Authoritative battle transport. The Go server keeps a shared event log per
 * battle; BattleFeed reads it, EventPacer replays it with animation pacing, and
 * this class handles the player's input: hidden choices, cancel, timer, chat and
 * rematch. The same class serves a single player against the server AI and
 * either side of a two-player match. The reducer and UI are unchanged.
 */
export class ServerBattleStream implements BattleStreamSource {
  private listener: ((event: BattleEvent) => void) | null = null;
  private readonly opts: ServerBattleOptions;
  private readonly pacer: EventPacer;
  private readonly speed: number;

  private id = "";
  private token = "";
  private feed: BattleFeed | null = null;
  private joinedAt = 0;
  // Retained compatibility for explicitly enabled offline demos only.
  private offline: MockBattleStream | null = null;
  private offlineUnsub: Unsubscribe | null = null;

  // Decision state, tracked only to gate input and drive the timer display; the
  // reducer owns the view, and the server owns the truth.
  private side: Side = "p1";
  private awaiting = false;
  private needsSwitch = false;
  private over = false;
  private pendingChoice: BattleChoice | null = null;
  private optimistic = false; // whether we showed a lock-in for pendingChoice

  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
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
      this.offlineUnsub?.();
      this.clearAll();
    };
  }

  private async start() {
    try {
      if (this.opts.mode === "ai" && !this.id) {
        const { mode, you, opponent, teams, format, seed } = this.opts;
        const r = await apiRequest("POST", "/api/battles", { mode, you, opponent, teams, format, seed: seed ?? 0 });
        Object.assign(this, { id: r.id, token: r.token, side: r.side });
      } else if (this.opts.mode === "pvp") {
        Object.assign(this, { id: this.opts.battleId, token: this.opts.token, side: this.opts.side });
        await this.submitTeam();
      }
      if (!this.listener) return; // disconnected while starting
      this.joinedAt = Date.now();
      this.feed = new BattleFeed(this.id, this.token, this.side, (batch) => this.receive(batch), (state, message) => {
        this.connected = state === "online";
        this.opts.onStatus?.(state === "online" ? "" : state === "expired" ? `${message ?? "Battle session expired"}. Return to loadout to find a match.` : message ?? "Connecting to your battle…");
      });
      this.feed.start();
    } catch (error) {
      if (process.env.NEXT_PUBLIC_LIVE_BATTLE === "0" && this.opts.mode === "ai" && this.listener) {
        const { you, opponent, teams, format } = this.opts;
        this.offline = new MockBattleStream({ you, opponent, teams, format, speed: this.speed });
        this.offlineUnsub = this.offline.connect(this.listener);
        return;
      }
      if (this.listener && !(error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) && (this.opts.mode === "pvp" || this.id)) {
        this.opts.onStatus?.("Connection interrupted. Reconnecting to your saved battle…");
        this.reconnectTimer = setTimeout(() => { if (this.listener) void this.start(); }, 1500);
        return;
      }
      this.opts.onStatus?.(`Couldn't connect to the battle server: ${error instanceof Error ? error.message : "network error"}. Reopen the match to retry.`);
    }
  }

  /** Two-player only: send our team. After a refresh the team is already locked, which is fine. */
  private async submitTeam() {
    if (this.opts.mode !== "pvp") return;
    await apiRequest("POST", `/api/battles/${this.id}/team`, { team: this.opts.team, format: this.opts.format }, this.token);
    this.opts.onStatus?.("Connecting to your matched battle…");
  }

  private receive({ instant, paced, started }: FeedBatch) {
    if (!started && Date.now() - this.joinedAt > NO_SHOW_MS) {
      this.opts.onStatus?.("Your opponent didn't bring a team in time. Head back to the loadout to find another match.");
    }
    instant.forEach((e) => this.apply(e));
    this.pacer.enqueue(paced);
  }

  choose(choice: BattleChoice): void {
    if (this.offline) return this.offline.choose(choice);
    if (!this.connected || this.over || this.pendingChoice || !this.awaiting) return;
    this.pendingChoice = choice;
    this.awaiting = false;
    // A forced switch is sent at once: no lock-in banner, nothing to cancel.
    this.optimistic = !this.needsSwitch;
    if (!this.optimistic) {
      void this.commit();
      return;
    }
    this.emit({ type: "choice-accepted", choice });
    // A short window in which Cancel can still take the choice back. Against
    // the AI it is longer, standing in for the bot "thinking".
    const delay = this.opts.mode === "ai" ? 900 + Math.random() * 800 : 500;
    this.commitTimer = setTimeout(() => void this.commit(), delay * this.speed);
  }

  cancel(): void {
    if (this.offline) return this.offline.cancel();
    if (!this.pendingChoice || this.over || this.commitTimer === null) return; // already sent
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
      await apiRequest("POST", `/api/battles/${this.id}/choice`, choice, this.token);
      this.pendingChoice = null; // the resolved turn arrives through the feed
      void this.feed?.poll();
    } catch (e) {
      this.pendingChoice = null;
      if (e instanceof ApiError && e.status === 409) {
        // Already locked in (e.g. after a refresh) or the turn timed out; the
        // feed will bring the next request.
        this.emit({ type: "chat", user: "", text: "Your move for this turn is already in. Waiting for the battle to continue…" });
        return;
      }
      this.awaiting = true;
      if (this.optimistic) this.emit({ type: "choice-cancelled" });
      this.emit({ type: "chat", user: "", text: "That move didn't go through. Try again." });
    }
  }

  setTimer(enabled: boolean): void {
    if (this.offline) return this.offline.setTimer(enabled);
    if (this.id) void this.send("timer", { enabled });
  }

  sendChat(text: string): void {
    if (this.offline) return this.offline.sendChat(text);
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed || !this.id) return;
    const now = Date.now();
    if (now - this.lastChat < 600) {
      this.emit({ type: "chat", user: "", text: "You're sending messages too fast. Wait a moment." });
      return;
    }
    this.lastChat = now;
    void this.send("chat", { text: trimmed });
  }

  rematch(): void {
    if (this.offline) return this.offline.rematch();
    if (this.id) void this.send("rematch", {});
  }

  /** Side-channel actions; their results appear in the feed. */
  private async send(action: "timer" | "chat" | "rematch", body: unknown) {
    try {
      await apiRequest("POST", `/api/battles/${this.id}/${action}`, body, this.token);
      void this.feed?.poll();
    } catch (e) {
      if (action === "rematch") this.emit({ type: "chat", user: "", text: e instanceof Error ? e.message : "Rematch failed." });
    }
  }

  /** Fold decision state from a server event, then forward it to the listener. */
  private apply(event: BattleEvent) {
    switch (event.type) {
      case "init": // a new battle or a rematch
        this.opts.onStatus?.("");
        this.over = false;
        this.awaiting = false;
        this.needsSwitch = false;
        this.pendingChoice = null;
        this.timerEnabled = event.state.timer.enabled;
        break;
      case "request": {
        const forOpponent = event.phase === "switching" && !!event.side && event.side !== this.side;
        this.awaiting = !forOpponent;
        this.needsSwitch = event.phase === "switching" && !forOpponent;
        this.secondsLeft = TURN_SECONDS;
        break;
      }
      case "timer":
        this.timerEnabled = event.enabled;
        if (event.secondsLeft !== null) this.secondsLeft = event.secondsLeft;
        break;
      case "win":
        this.over = true;
        break;
    }
    this.emit(event);
  }

  // Timer display is updated only by server events. An interrupted connection
  // must not continue counting down or invent battle progress.
  private clearAll() {
    this.pacer.clear();
    this.feed?.stop();
    if (this.commitTimer) clearTimeout(this.commitTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.commitTimer = this.reconnectTimer = null;
    this.connected = false;
  }

  /** Emit immediately, outside the pacer (optimistic feedback, notes and the timer). */
  private emit(event: BattleEvent) {
    this.listener?.(event);
  }
}
