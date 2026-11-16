import { ApiError, apiRequest } from "./battleApi";
import type { BattleEvent, Side } from "./types";

const POLL_MS = 600;

export type BattleConnection = "connecting" | "online" | "reconnecting" | "expired";

export interface FeedBatch {
  /** Events to apply at once: the backlog when (re)joining mid-battle. */
  instant: BattleEvent[];
  /** Events to replay with animation pacing. */
  paced: BattleEvent[];
  /** Whether both teams are in and the battle has begun. */
  started: boolean;
}

/**
 * Reads a battle's shared event log from the Go API by polling
 * GET /api/battles/{id}/events?since=N. It tracks the cursor, rewrites the
 * shared init event for this client's side, and splits a rejoin backlog so only
 * the current turn animates.
 */
export class BattleFeed {
  private cursor = 0;
  private inflight = false;
  private interrupted = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly battleId: string,
    private readonly token: string,
    private readonly side: Side,
    private readonly onBatch: (batch: FeedBatch) => void,
    private readonly onConnection?: (state: BattleConnection, message?: string) => void,
  ) {}

  start() {
    if (this.timer) return;
    this.onConnection?.("connecting");
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch anything new now (e.g. right after sending a choice). */
  async poll() {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const r = await apiRequest("GET", `/api/battles/${this.battleId}/events?since=${this.cursor}`, undefined, this.token);
      if (!this.timer) return; // stopped while the request was in flight
      this.onConnection?.("online");
      if (r.cursor < this.cursor) { this.cursor = 0; this.interrupted = true; return; }
      const firstFetch = this.cursor === 0;
      this.cursor = r.cursor;
      const events = (r.events as BattleEvent[]).map((e) => this.localize(e));
      this.onBatch({ ...((firstFetch || this.interrupted) ? catchUp(events) : { instant: [], paced: events }), started: r.started });
      this.interrupted = false;
    } catch (cause) {
      if (!this.timer) return;
      this.interrupted = true;
      if (cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status)) {
        this.stop();
        this.onConnection?.("expired", cause.message);
      } else this.onConnection?.("reconnecting", "Connection interrupted. Reconnecting to your saved battle…");
    } finally {
      this.inflight = false;
    }
  }

  /** The shared init event says you="p1"; each client substitutes its own side. */
  private localize(event: BattleEvent): BattleEvent {
    return event.type === "init" ? { ...event, state: { ...event.state, you: this.side } } : event;
  }
}

/**
 * On (re)joining, everything before the latest turn is applied instantly and
 * only the current turn animates, so a refresh mid-battle rejoins in seconds
 * instead of replaying every past animation.
 */
function catchUp(events: BattleEvent[]): Pick<FeedBatch, "instant" | "paced"> {
  const turns = events.flatMap((e, i) => (e.type === "turn" ? [i] : []));
  const cut = turns.length >= 2 ? turns[turns.length - 1] : 0;
  return { instant: events.slice(0, cut), paced: events.slice(cut) };
}
