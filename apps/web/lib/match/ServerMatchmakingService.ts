import { apiRequest } from "../battle/battleApi";
import type { Side, Trainer } from "../battle/types";
import type { CardPick } from "../cards/mapping";
import { tierFor } from "../rank/RankService";
import type { MatchmakingService, MatchRequest, MatchSearch, MatchTicket } from "./MatchmakingService";

const POLL_MS = 1000;
/** Maximum time to look for a human rival. */
const HUMAN_SEARCH_MS = 90_000;

interface QueueMatched {
  status: "matched";
  id: string;
  token: string;
  side: Side;
  opponent: { trainer: Trainer; rating: number; team: CardPick[] };
}
type QueueReply = QueueMatched | { status: "searching"; ticket: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Real two-player matchmaking through the Go API queue, which pairs players by
 * format, card power tier and entry. If nobody compatible turns up within
 * HUMAN_SEARCH_MS, the search ends without inventing an opponent.
 */
export class ServerMatchmakingService implements MatchmakingService {
  find(request: MatchRequest): MatchSearch {
    let cancelled = false;
    let ticket: string | null = null;
    const withdraw = () => (ticket ? apiRequest("DELETE", `/api/queue/${ticket}`).catch(() => {}) : Promise.resolve());

    const result = (async (): Promise<MatchTicket> => {
      const startedAt = Date.now();
      try {
        let reply = await apiRequest<QueueReply>("POST", "/api/queue", {
          trainer: { id: request.player, name: request.player, avatar: "maya" },
          rating: request.rating, format: request.format, tier: request.tier, entry: request.entry, team: request.team,
        });
        while (reply.status === "searching" && Date.now() - startedAt < HUMAN_SEARCH_MS) {
          ticket = reply.ticket;
          await sleep(POLL_MS);
          if (cancelled) throw new Error("cancelled");
          reply = await apiRequest<QueueReply>("GET", `/api/queue/${ticket}`);
        }
        if (reply.status === "searching") {
          // Withdraw first so we can't be paired from here on, then check once
          // more: a rival who matched us in the meantime must not be stranded.
          await withdraw();
          reply = await apiRequest<QueueReply>("GET", `/api/queue/${ticket}`).catch(() => reply);
        }
        if (reply.status === "matched") return toTicket(reply, request);
        throw new Error("No player with the same format, card tier, and entry joined within 90 seconds. Try again together.");
      } catch (e) {
        await withdraw();
        throw e;
      }
    })();

    return {
      result,
      cancel: () => {
        cancelled = true;
        void withdraw();
      },
    };
  }
}

function toTicket(reply: QueueMatched, request: MatchRequest): MatchTicket {
  return {
    matchId: reply.id,
    format: request.format,
    entry: request.entry,
    you: { name: request.player, rating: request.rating, team: request.team },
    opponent: {
      trainer: reply.opponent.trainer,
      rating: reply.opponent.rating,
      tier: tierFor(reply.opponent.rating),
      wins: 0, // the queue does not share records yet
      losses: 0,
      team: reply.opponent.team,
    },
    live: { battleId: reply.id, token: reply.token, side: reply.side },
  };
}
