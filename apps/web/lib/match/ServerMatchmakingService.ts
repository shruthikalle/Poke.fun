import { ApiError, apiRequest } from "../battle/battleApi";
import type { Side, Trainer } from "../battle/types";
import type { CardPick } from "../cards/mapping";
import { tierFor } from "../rank/RankService";
import type { MatchmakingService, MatchRequest, MatchSearch, MatchTicket } from "./MatchmakingService";

const POLL_MS = 1000;
const HUMAN_SEARCH_MS = 90_000;

interface QueuePlayer {
  trainer: Trainer;
  rating: number;
  wins: number;
  losses: number;
  team: CardPick[];
}
interface QueueMatched {
  status: "matched";
  id: string;
  token: string;
  side: Side;
  opponent: QueuePlayer;
  you: QueuePlayer;
}
type QueueReply = QueueMatched | { status: "searching"; ticket: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Server queue, paired by format, canonical team tier and demo entry amount. */
export class ServerMatchmakingService implements MatchmakingService {
  find(request: MatchRequest): MatchSearch {
    let cancelled = false;
    let ticket: string | null = null;
    const withdraw = () => ticket ? apiRequest("DELETE", `/api/queue/${ticket}`) : Promise.resolve();
    // Cancellation can race pairing. Matched tickets remain collectable after
    // DELETE; only an unpaired search disappears. Never strand the other side.
    const withdrawAndCollect = async (): Promise<QueueMatched | null> => {
      if (!ticket) return null;
      await withdraw();
      try {
        const reply = await apiRequest<QueueReply>("GET", `/api/queue/${ticket}`);
        return reply.status === "matched" ? reply : null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    };

    const result = (async (): Promise<MatchTicket> => {
      const startedAt = Date.now();
      try {
        let reply = await apiRequest<QueueReply>("POST", "/api/queue", {
          trainer: { id: request.player, name: request.player, avatar: "maya" },
          rating: request.rating, format: request.format, tier: request.tier, entry: request.entry, team: request.team,
        });
        while (reply.status === "searching") {
          ticket = reply.ticket;
          if (cancelled || Date.now() - startedAt >= HUMAN_SEARCH_MS) {
            const matched = await withdrawAndCollect();
            if (matched) return toTicket(matched, request);
            throw new Error(cancelled ? "cancelled" : "No player with the same format, card tier, and entry joined within 90 seconds. Try again together.");
          }
          await sleep(POLL_MS);
          if (cancelled) {
            const matched = await withdrawAndCollect();
            if (matched) return toTicket(matched, request);
            throw new Error("cancelled");
          }
          reply = await apiRequest<QueueReply>("GET", `/api/queue/${ticket}`);
        }
        // A POST already paired us even if Cancel was clicked in flight.
        return toTicket(reply, request);
      } catch (error) {
        const matched = await withdrawAndCollect();
        if (matched) return toTicket(matched, request);
        throw error;
      }
    })();

    return {
      result,
      cancel: () => {
        cancelled = true;
        // Prompt withdrawal; result still performs the final GET and owns errors.
        void withdraw().catch(() => {});
      },
    };
  }
}

function toTicket(reply: QueueMatched, request: MatchRequest): MatchTicket {
  return {
    matchId: reply.id,
    format: request.format,
    entry: request.entry,
    you: { name: reply.you.trainer.name, rating: reply.you.rating, team: reply.you.team },
    opponent: {
      trainer: reply.opponent.trainer,
      rating: reply.opponent.rating,
      tier: tierFor(reply.opponent.rating),
      wins: reply.opponent.wins,
      losses: reply.opponent.losses,
      team: reply.opponent.team,
    },
    live: { battleId: reply.id, token: reply.token, side: reply.side },
  };
}
