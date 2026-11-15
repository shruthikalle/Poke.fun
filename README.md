# Poke.fun

A browser card-battle game where the Go server is the referee. Players bring a collectible card (or a team of three), get matched with a real opponent, choose moves in secret each turn, and see the same server-decided result. There are two battle modes: the **team battle** at `/battle` (creatures built from PokéAPI, two-player matchmaking) and the original **one-card duel** at `/play` (fictional sample cards, room codes). Server-side wallet and NFT verification and staking are not implemented yet.

## Repository layout

```text
apps/web/                         Next.js frontend and battle screen
services/api/cmd/server/          Go API entry point
services/api/internal/battle/     One-card duel: sample cards, rules, shared type chart
services/api/internal/livebattle/ Team battle engine (hidden choices, switching, AI)
services/api/internal/server/     HTTP endpoints and the two-player matchmaking queue
contracts/                        Solana escrow design and future code
docs/                             Product, architecture and game-mechanics docs
```

## Game mechanics

Both battle modes share one rule: **each player chooses in secret, and the turn resolves only once both have chosen.** The Go server decides every outcome; the browser only displays it.

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
- `/loadout`: pick a card from your collection, a format (Champion 1v1 or Squad of 3) and an entry amount, see your rank, then find a match.
- `/battle`: the team battle. Find match on `/loadout` pairs you with a real player through the Go API queue. A search ends after 90 seconds if no compatible player joins. Opening it without a match sends you to `/loadout`.
- `/market` and `/collection`: the card marketplace and your card collection (mock data).
- `/play`: the original one-card demo that talks to the Go API.

To try a **two-player team battle** locally, open `http://localhost:3000/loadout` in two browsers (or separate browser profiles). In both, pick the same format and entry and a lead card with the same power tier (the pips on each card), then press Find match within 90 seconds. Players are only paired when all three match. For example, Pikachu and Charmander are both tier 1, while Blastoise and Venusaur are both tier 3. Refreshing `/battle` during a two-player match rejoins it. The Go API must be running; set `NEXT_PUBLIC_LIVE_BATTLE=0` only for an offline bot demo.

For `/play`, open `http://localhost:3000/play` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

### Frontend integration seams

`/loadout`, `/battle`, `/market` and `/collection` read all live data through typed interfaces in `apps/web/lib`. Battles and matchmaking use the Go API; the rest are backed by mocks for now. To swap in a real service, implement the interface; the UI code doesn't change.

| Seam | Interface | Current implementation | TODO |
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
| Matchmaking | `MatchmakingService` (`lib/match`) | `ServerMatchmakingService` → Go API queue; `MockMatchmakingService` only in explicit offline mode | Rating bands, persistent queue |

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
