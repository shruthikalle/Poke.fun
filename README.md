# Poke.fun

A working one-card, turn-based 1v1 demo. Two players can create and join a room, select fictional sample cards, attack, and see the same server-decided result. Wallet login, NFT verification, matchmaking, and staking are not implemented yet.

## Repository layout

```text
apps/web/                         Next.js frontend and battle screen
services/api/cmd/server/          Go API entry point
services/api/internal/battle/     Card catalog and battle rules
services/api/internal/server/     HTTP match endpoints
contracts/                        Solana escrow design and future code
docs/                             Architecture and rules decisions
```

## Current rules

Each player uses one card. Both submit an attack; the Go server resolves both simultaneously. Quick attacks are neutral and generate one energy, while stronger attacks cost two energy and carry the card's element, so they earn a same-type bonus and can be super-effective or resisted against the opponent's type. Each turn has a 60-second deadline; a player who misses it has their quick attack auto-played. The first card at zero HP loses. If both reach zero on the same turn, the match is a draw.

The full ruleset is documented in [`docs/battle-spec.md`](docs/battle-spec.md) and implemented authoritatively in `services/api/internal/battle`. For a detailed walkthrough of both battle engines (the one-card duel and the rich `/battle` team battle), see [`docs/game-mechanics.md`](docs/game-mechanics.md).

## Run locally

In terminal 1, start the API (Go 1.22+):

```sh
cd services/api
go run ./cmd/server
```

In terminal 2, start the frontend (Node.js 20.9+):

```sh
cd apps/web
npm install
npm run dev
```

The frontend has four routes:

- `/`: pixel-art landing page. Sign-in (Phantom or guest) opens in a dialog.
- `/loadout`: pick a card from your collection, a format (Champion 1v1 or Squad of 3) and an entry amount, see your rank, then find a match.
- `/battle`: the team battle, **server-authoritative** and **two-player**. Find match on `/loadout` pairs you with a real player in the same format, card tier and entry through the Go API queue; if nobody turns up within 20 seconds you battle the server AI instead. To try two-player locally, open `/loadout` in two browsers (or a normal and a private window) and press Find match in both. Without the Go API, single-player battles fall back to the offline client-side simulation; `NEXT_PUBLIC_LIVE_BATTLE=0` forces offline mode. Opening it without a match sends you to `/loadout`.
- `/play`: the original one-card demo that talks to the Go API.

For `/play`, open `http://localhost:3000/play` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

### Frontend integration seams

`/loadout`, `/battle`, `/market` and `/collection` read all live data through typed interfaces in `apps/web/lib`, each backed by a mock for now. To swap in a real service, implement the interface; the UI code doesn't change.

| Seam | Interface | Mock | TODO |
| --- | --- | --- | --- |
| Battle feed | `BattleStreamSource`, `useBattleStream` (`lib/battle`) | `ServerBattleStream` → Go API shared event log (polling); `MockBattleStream` offline | Push transport (WebSocket / QuickNode Streams) instead of polling |
| Win odds | `OddsProvider`, `useOdds` (`lib/markets`) | `MockOddsProvider` | Gemini prediction markets |
| Sound cues | `AudioCueProvider`, `useBattleAudio` (`lib/audio`) | `SynthAudioProvider` | ElevenLabs |
| Sign-in | `AuthBackend`, `useWallet` (`lib/wallet`) | `useMockBackend` (any 6-digit code) when `NEXT_PUBLIC_PRIVY_APP_ID` is unset | Privy email code + embedded Solana wallet on devnet (`privyBackend.tsx`) |
| Marketplace | `MarketplaceService`, `useMarketplace` (`lib/market`) | `MockMarketplaceService` (seeded catalog, localStorage) | Marketplace program on devnet |
| SOL price | `SolPriceSource`, `useSolPrice` (`lib/market`) | `MockSolPriceSource` | Real price feed |
| Lobby and chat | `LobbyService`, `RoomChatService` (`lib/lobby`) | `MockLobbyService`, `MockRoomChatService` | Presence and chat API |
| Owned cards | `CollectionService` (`lib/cards`), shaped like Metaplex DAS `getAssetsByOwner` | `MockCollectionService` | DAS RPC (QuickNode) |
| Card → creature | `CARD_MAPPING`, `resolveCard` (`lib/cards/mapping.ts`) | Versioned table | Reviewed card list |
| Creature data | `SpeciesService` (`lib/pokemon`) | Live PokéAPI, cached in memory + localStorage | — |
| Rank | `RankService` (`lib/rank`) | `MockRankService` (localStorage Elo) | Go API ratings |
| Entry and winnings | `StakeService` (`lib/stake`) | `MockStakeService` (no money moves) | Devnet USDC escrow, after legal review |
| Matchmaking | `MatchmakingService` (`lib/match`) | `ServerMatchmakingService` → Go API queue; `MockMatchmakingService` AI fallback | Rating bands, persistent queue |

Creature stats, moves and sprites come from [PokéAPI](https://pokeapi.co); card art comes from the Pokémon TCG API image CDN. Pokémon is a trademark of Nintendo / The Pokémon Company, so get a rights review before any public launch.

Run backend tests with `cd services/api && go test ./...` and check the frontend with `cd apps/web && npm run build`.

## Next implementation steps

1. Replace the fictional catalog with a curated, verified battle catalog for supported collectibles.
2. Add persistent match storage, reconnect, turn deadlines, and forfeit/refund rules.
3. Add Solana wallet login and verify ownership of supported card NFTs.
4. Add matchmaking within compatible formats.
5. Add devnet escrow and settlement after the battle protocol is stable.

Matches are in memory and disappear when the API restarts. Player tokens are for this local demo only; do not use this code to hold stakes. Real-money or card staking requires legal review before a public launch. The Go server is currently a trusted referee.

### Card catalog and summon gallery

- `apps/web/lib/cards/catalog.generated.json` is the versioned card → creature catalog (Base Set, Jungle, Fossil, 151, Crown Zenith Galarian Gallery). Each entry has its species, level, power tier and the `artWindow` the summon lifts out of the card. Regenerate it with `npm run catalog` (from cached API responses in `scripts/.cache/`, or `-- --refresh` to download again), and check every species against PokéAPI with `npm run catalog:check`.
- `/dev/summons` (dev builds only, or set `NEXT_PUBLIC_DEV_TOOLS=1`) lists every catalog card and plays its full or mini summon. It can also switch the mock collection (default, one card, all ineligible, empty, large).
- QA findings and their status are in `docs/qa-report.md`.
