import type { BattleEvent } from "./types";

// Per-event animation pacing (ms). The server resolves a turn instantly; these
// delays replay its events at the speed a battle should read, so the reducer
// and UI stay unchanged. Spacing mirrors the former client-side simulation.
const DELAY: Record<string, number> = {
  init: 0, join: 150, start: 250, switch: 650, turn: 350, request: 50,
  resolving: 220, move: 900, damage: 500, miss: 500, faint: 600,
  "choice-accepted": 0, "choice-cancelled": 0, chat: 150, timer: 0, win: 700, leave: 150,
};

/**
 * Plays a queue of battle events out over time, one at a time, waiting the
 * event's pacing delay before emitting it. Its only job is timing; callers pass
 * an emit callback that applies state and notifies listeners.
 */
export class EventPacer {
  private queue: BattleEvent[] = [];
  private pumping = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: (event: BattleEvent) => void,
    private readonly speed = 1,
  ) {}

  enqueue(events: BattleEvent[]) {
    this.queue.push(...events);
    this.pump();
  }

  /** Cancels pending timers and drops any unplayed events. */
  clear() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.queue = [];
    this.pumping = false;
  }

  private pump() {
    if (this.pumping) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pumping = true;
    const id = setTimeout(() => {
      this.timers.delete(id);
      this.pumping = false;
      this.emit(next);
      this.pump();
    }, (DELAY[next.type] ?? 0) * this.speed);
    this.timers.add(id);
  }
}
