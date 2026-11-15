import { apiRequest } from "../battle/battleApi";
import type { Side, Trainer } from "../battle/types";
import type { CardPick } from "../cards/mapping";
import { tierFor } from "../rank/RankService";
import type { MatchmakingService, MatchRequest, MatchSearch, MatchTicket } from "./MatchmakingService";

const POLL_MS = 1000;
/** How long to look for a human rival before battling the AI instead. */
const HUMAN_SEARCH_MS = 20_000;

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
 * HUMAN_SEARCH_MS (or the API is unreachable) it falls back to `fallback`, an
 * AI opponent, so a lone player is never left waiting.
 */
export class ServerMatchmakingService implements MatchmakingService {
  constructor(private readonly fallback: MatchmakingService) {}

  find(request: MatchRequest): MatchSearch {
    let cancelled = false;
    let ticket: string | null = null;
    let fallbackSearch: MatchSearch | null = null;
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
      } catch (e) {
        if (cancelled) throw e;
        // API unreachable or the search expired: fall through to the AI.
      }
      if (cancelled) throw new Error("cancelled");
      fallbackSearch = this.fallback.find(request);
      return fallbackSearch.result;
    })();

    return {
      result,
      cancel: () => {
        cancelled = true;
        void withdraw();
        fallbackSearch?.cancel();
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
