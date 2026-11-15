# Poke.fun

A browser card-battle game with a Go referee. The main `/loadout` flow queues two players into a real-time, one-card arena at `/battle/live`. The earlier turn-based team battle remains at `/battle`, and the room-code duel remains at `/play`. Phantom Devnet sign-in and test-card reads are available. Paid entries shown in the UI are demos; the Solana wager contract under `contracts/` is not connected to matchmaking or settlement.

## Repository layout

```text
apps/web/                         Next.js frontend and battle screen
services/api/cmd/server/          Go API entry point
services/api/internal/battle/     One-card duel: sample cards, rules, shared type chart
services/api/internal/livebattle/ Team battle engine (hidden choices, switching, AI)
services/api/internal/arena/      Real-time battle simulation and card rules
services/api/internal/server/     HTTP endpoints and the two-player matchmaking queue
contracts/                        Solana wager escrow prototype and tests
docs/                             Product, architecture and game-mechanics docs
```

## Game mechanics

The Go server decides battle outcomes. The live arena simulates both players at the same time; the older modes resolve hidden turn choices.

- **Live arena (`/battle/live`).** One level-50 Pikachu or Charmander per player. Move, aim, dodge, and use basic and special attacks in real time. The server simulates movement and attacks at 20 ticks per second and broadcasts snapshots over WebSocket. Knock out the opponent within 90 seconds; a timeout compares remaining HP percentages.

- **Team battle (`/battle`).** One creature (Champion 1v1) or three (Squad of 3). Each turn you pick a move or a switch. Switches happen first, then moves in speed order. Damage uses the creatures' PokéAPI stats with type effectiveness, a same-type bonus, accuracy, crits and limited PP. When a creature faints, only its owner chooses the replacement. The last player with a creature standing wins. Online matches run a 150-second turn clock that the server enforces.
- **One-card duel (`/play`).** Each card has a quick attack (free, builds one energy) and a heavy attack (costs two energy, carries the card's element). Both attacks land at the same time, so both cards can be knocked out together for a draw. A 60-second turn deadline auto-plays the quick attack.

Read [`docs/game-mechanics.md`](docs/game-mechanics.md) for the full rules, formulas, matchmaking and API, and [`docs/battle-spec.md`](docs/battle-spec.md) for the terse canonical spec. The engines live in `services/api/internal/livebattle` and `services/api/internal/battle`.

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

The frontend routes:

- `/`: pixel-art landing page. Sign-in (Phantom or guest) opens in a dialog.
- `/loadout`: pick a card, select a demo entry, and queue for the live arena. The arena currently accepts Pikachu and Charmander.
- `/battle/live`: the real-time match opened automatically when two compatible players queue.
- `/arena`: direct arena controls and match view.
- `/battle`: the earlier turn-based team battle.
- `/market` and `/collection`: the card marketplace and your card collection (mock data).
- `/play`: the original one-card demo that talks to the Go API.

To try a **two-player live arena**, open `http://localhost:3000/loadout` in two separate browser profiles. Select Pikachu or Charmander and the same demo entry in both, then click Find match. The first player waits until the second joins; each receives a separate seat in the same arena. The Go API must be running. The old team-battle queue remains available to code using `/api/queue`.

For `/play`, open `http://localhost:3000/play` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

### Frontend integration seams

`/loadout`, `/battle/live`, `/market` and `/collection` read data through typed interfaces in `apps/web/lib`. The live arena and its queue use the Go API. Marketplace and ratings remain demos.

| Seam | Interface | Current implementation | TODO |
| --- | --- | --- | --- |
| Battle feed | `BattleStreamSource`, `useBattleStream` (`lib/battle`) | `ServerBattleStream` → Go API shared event log (polling); `MockBattleStream` offline | Push transport (WebSocket / QuickNode Streams) instead of polling |
| Win odds | `OddsProvider`, `useOdds` (`lib/markets`) | `MockOddsProvider` | Gemini prediction markets |
| Sound cues | `AudioCueProvider`, `useBattleAudio` (`lib/audio`) | `SynthAudioProvider` | ElevenLabs |
| Sign-in | `AuthBackend`, `useWallet` (`lib/wallet`) | `useMockBackend` (any 6-digit code) when `NEXT_PUBLIC_PRIVY_APP_ID` is unset | Privy email code + embedded Solana wallet on devnet (`privyBackend.tsx`) |
| Marketplace | `MarketplaceService`, `useMarketplace` (`lib/market`) | `MockMarketplaceService` (seeded catalog, localStorage) | Marketplace program on devnet |
| SOL price | `SolPriceSource`, `useSolPrice` (`lib/market`) | `MockSolPriceSource` | Real price feed |
| Lobby and chat | `LobbyService`, `RoomChatService` (`lib/lobby`) | `MockLobbyService`, `MockRoomChatService` | Presence and chat API |
| Owned cards | `CollectionService` (`lib/cards`), shaped like Metaplex DAS `getAssetsByOwner` | Devnet test collection plus marketplace demo cards; optional Core verification mode | Broader verified collection support |
| Card → creature | `CARD_MAPPING`, `resolveCard` (`lib/cards/mapping.ts`) | Versioned table | Reviewed card list |
| Creature data | `SpeciesService` (`lib/pokemon`) | Live PokéAPI, cached in memory + localStorage | — |
| Rank | `RankService` (`lib/rank`) | `MockRankService` (localStorage Elo) | Go API ratings |
| Entry and winnings | `StakeService` (`lib/stake`) | `MockStakeService` (no money moves) | Devnet USDC escrow, after legal review |
| Matchmaking | `lib/arena.ts` and `lib/match` | Go `/api/arena-queue` for live play; `/api/queue` for older team battles | Persistent queues and verified ratings |

Creature stats, moves and sprites come from [PokéAPI](https://pokeapi.co); card art comes from the Pokémon TCG API image CDN. Pokémon is a trademark of Nintendo / The Pokémon Company, so get a rights review before any public launch.

Run backend tests with `cd services/api && go test ./...` and check the frontend with `cd apps/web && npm run typecheck && npm run build`.

## Next implementation steps

1. Persist matches and the queue so a server restart doesn't end live battles, and define forfeit/refund rules.
2. Verify wallet sign-in and ownership of supported card NFTs on the server.
3. Add rating bands to matchmaking and share player records with opponents.
4. Replace polling with a push transport (WebSocket) for battle updates.
5. Add devnet escrow and settlement once the battle protocol is stable.

Matches, team battles and the matchmaking queue are in memory and disappear when the API restarts. Player tokens are for this local demo only; do not use this code to hold stakes. Real-money or card staking requires legal review before a public launch. The Go server is currently a trusted referee.

### Card catalog and summon gallery

- `apps/web/lib/cards/catalog.generated.json` is the versioned card → creature catalog (Base Set, Jungle, Fossil, 151, Crown Zenith Galarian Gallery). Each entry has its species, level, power tier and the `artWindow` the summon lifts out of the card. Regenerate it with `npm run catalog` (from cached API responses in `scripts/.cache/`, or `-- --refresh` to download again), and check every species against PokéAPI with `npm run catalog:check`.
- `/dev/summons` (dev builds only, or set `NEXT_PUBLIC_DEV_TOOLS=1`) lists every catalog card and plays its full or mini summon. It can also switch the mock collection (default, one card, all ineligible, empty, large).
- QA findings and their status are in `docs/qa-report.md`.
