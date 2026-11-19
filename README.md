# Poke.fun

A browser card-battle game with a Go referee. Choose Champion on `/loadout` for the real-time, one-card arena at `/battle/live`, or Squad of 3 for turn-based multiplayer at `/battle`. The room-code duel remains at `/play`. Phantom Devnet sign-in and test-card reads are available. Paid entries shown in the UI are demos; the Solana wager contract under `contracts/` is not connected to matchmaking or settlement.

## Repository layout

```text
apps/web/                         Next.js frontend and battle screen
services/api/cmd/server/          Go API entry point
services/api/internal/battle/     One-card duel: sample cards, rules, shared type chart
services/api/internal/livebattle/ Team battle engine (hidden choices, switching, AI)
services/api/internal/arena/      Real-time battle simulation; fighters derived from the Pokédex
services/api/internal/pokedex/    Pokémon database imported from PokéAPI (species, moves, card mapping)
services/api/internal/server/     HTTP endpoints and the two-player matchmaking queue
contracts/                        Solana programs: wager escrow prototype and card marketplace, with tests
docs/                             Product, architecture and game-mechanics docs
```

## Game mechanics

The Go server decides battle outcomes. The live arena simulates both players at the same time; the older modes resolve hidden turn choices.

- **Live arena (`/battle/live`).** One level-50 fighter per player: any Pokémon (all 1,025 species plus Mega, Gigantamax, Primal and regional forms), with stats and moves derived from PokéAPI data. Any Pokémon card can battle, recognised by set and number or by its printed name. Players are only paired with the same power tier. Move, aim, dodge, and use basic and special attacks in real time. The server simulates movement and attacks at 20 ticks per second and broadcasts snapshots over WebSocket. Knock out the opponent within 90 seconds; a timeout compares remaining HP percentages.

- **Team battle (`/battle`).** One creature (Champion 1v1) or three (Squad of 3). Each turn you pick a move or a switch. Switches happen first, then moves in priority and speed order. Damage uses the creatures' PokéAPI stats with type effectiveness, a same-type bonus, accuracy, crits and limited PP. Supported moves also apply status, stat, weather and multi-hit effects. When a creature faints, only its owner chooses the replacement. The last player with a creature standing wins. Online matches run a 150-second turn clock that the server enforces.
- **History and replays (`/history`).** Finished matches are listed by public demo name. Signed results bind to saved team event logs, duel turns or arena tick frames and can be played back after a restart.
- **One-card duel (`/play`).** Each card has a quick attack (free, builds one energy) and a heavy attack (costs two energy, carries the card's element). Both attacks land at the same time, so both cards can be knocked out together for a draw. A 60-second turn deadline auto-plays the quick attack.

Read [`docs/game-mechanics.md`](docs/game-mechanics.md) for the full rules, formulas, matchmaking, API and where the Pokémon data comes from, and [`docs/battle-spec.md`](docs/battle-spec.md) for the terse canonical spec. The engines live in `services/api/internal/livebattle` and `services/api/internal/battle`.

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
- `/loadout`: pick an owned card or an explicit rental, choose Champion or Squad, select an entry, and queue. Champion shows arena moves; Squad shows the three server-defined creatures and moves. Demo entry choices remain available without moving funds.
- `/battle/live`: the real-time match opened automatically when two compatible players queue.
- `/arena`: direct arena controls and match view.
- `/battle`: the earlier turn-based team battle.
- `/market` and `/collection`: the on-chain devnet card marketplace and your wallet's cards (needs the Go API with `MARKET_PROGRAM_ID`).
- `/play`: the original one-card demo that talks to the Go API.

To try a **two-player live arena**, open `http://localhost:3000/loadout` in two separate browser profiles. Pick Champion, fighters of the same power tier, and the same demo entry in both, then click Find match. The first player waits until the second joins; each receives a separate seat in the same arena. The Go API must be running. An active arena can be forfeited; the server awards the opponent and records the outcome once.

For **Squad of 3**, choose Squad in both browsers and use the same entry and team tier (the highest species tier on each team). The selected lead and two distinct owned creatures or shared rentals form the squad. Matchmaking locks both selections and opens `/battle`; both players must agree before a completed match restarts. Unknown species, duplicate base species and browser-authored combat stats cannot alter the server's teams.

For `/play`, open `http://localhost:3000/play` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

### Frontend integration seams

`/loadout`, `/battle/live`, `/market` and `/collection` read data through typed interfaces in `apps/web/lib`. Online combat, player records, community presence, room chat, the landing activity feed and the marketplace use the Go API. External prediction markets and unconfigured auth integrations retain their existing demo implementations while those integrations are deferred.

| Seam | Interface | Current implementation | TODO |
| --- | --- | --- | --- |
| Battle feed | `BattleStreamSource`, `useBattleStream` (`lib/battle`) | `ServerBattleStream` → Go API shared event log (polling); `MockBattleStream` offline | Push transport (WebSocket / QuickNode Streams) instead of polling |
| Battle HP share | `OddsProvider`, `useOdds` (`lib/markets`) | Current team HP share, explicitly labelled as a heuristic; mock provider retained as an opt-in tool | External prediction market integration |
| Sound cues | `AudioCueProvider`, `useBattleAudio` (`lib/audio`) | `SynthAudioProvider` | ElevenLabs |
| Sign-in | `AuthBackend`, `useWallet` (`lib/wallet`) | Verified Phantom message-signature sessions when `NEXT_PUBLIC_PRIVY_APP_ID` is unset | Privy email code + embedded Solana wallet on devnet (`privyBackend.tsx`) |
| Marketplace | `MarketplaceService`, `useMarketplace` (`lib/market`) | `ChainMarketplaceService`: devnet `pokefun_market` program, read through the Go index, wallet-signed writes | Configure deployed program and approved collection; audit before any real value |
| SOL price | `SolPriceSource`, `useSolPrice` (`lib/market`) | Go `/api/market/sol-price` (cached CoinGecko); prices show in SOL while no quote is available | |
| Lobby and chat | `LobbyService`, `RoomChatService` (`lib/lobby`) | Go community presence and shared room messages | Durable chat history and verified identities |
| Owned cards | `CollectionService` (`lib/cards`), shaped like Metaplex DAS `getAssetsByOwner` | Go marketplace index of wallet-owned Core NFTs in approved collections | Broader verified collection support |
| Card → creature | `CARD_MAPPING`, `resolveCard` (`lib/cards/mapping.ts`) | Versioned table | Reviewed card list |
| Creature data | `SpeciesService` (`lib/pokemon`) | Go embedded Pokédex for online play; PokéAPI provider retained for explicit offline play | Abilities, held items and bespoke one-off moves |
| Rank | `RankService` (`lib/rank`) | Go API Elo from actual multiplayer results; persistent JSON records | Verified account identities and a database for multiple servers |
| Entry and winnings | `StakeService` (`lib/stake`) | `MockStakeService` (no money moves) | Devnet USDC escrow, after legal review |
| Matchmaking | `lib/arena.ts` and `lib/match` | Go `/api/arena-queue` for live play; `/api/queue` for older team battles | Persistent queues and verified ratings |

Creature stats, moves and sprites come from [PokéAPI](https://pokeapi.co); card art comes from the Pokémon TCG API image CDN. Pokémon is a trademark of Nintendo / The Pokémon Company, so get a rights review before any public launch.

Run backend tests with `cd services/api && go test ./...` and check the frontend with `cd apps/web && npm run test:battle && npm run typecheck && npm run build`.

## Next implementation steps

1. Define refund rules for unfinished funded matches (forfeits and disconnects already produce signed results).
2. Verify wallet sign-in and ownership of supported card NFTs on the server.
3. Bind public player records to verified account identities (rating bands are implemented).
4. Replace polling with a push transport (WebSocket) for battle updates.
5. Add devnet escrow and settlement once the battle protocol is stable.

Matches, team battles, queues and their entry terms are checkpointed to `data/games.json` (`GAME_STORE_PATH`) and restored when the API restarts; signed final results are kept in `data/results.json` with the referee key in `data/referee.key` (`RESULT_STORE_PATH`, `REFEREE_KEY_PATH`). These are single-process files, not a shared database. A verified NFT can back only one search or unfinished match at a time. Player tokens are for this local demo only; do not use this code to hold stakes. Real-money or card staking requires legal review before a public launch. The Go server is currently a trusted referee.

### Player records and community

New records start at 1200 Elo with zero wins, losses and draws. Only the server records completed human battles; browser-submitted ratings and results do not award points. Outcomes are idempotent per match/round. The API stores player records in `data/players.json` relative to its working directory; set `PLAYER_STORE_PATH` to choose another file. This is a single-server store with atomic saves. Public player names identify these records and are not verified wallet accounts.

The landing leaderboard and active-match list read actual server state and show empty or unavailable states when appropriate. Room chat uses shared server messages and heartbeat presence, not generated chatter. Presence and chat history remain in memory.

### Wallet cards

Owned cards in `/collection` and `/loadout` come from the Go marketplace index of Metaplex Core accounts in approved collections. A wallet with no cards has an empty collection. API errors are shown rather than replaced with invented cards. The Go battle API independently checks ownership and collection at entry. Explicit practice rentals remain available for guest play.

Without a Privy app ID, sign-in requires Phantom and a server-verified message signature; email sign-in is offered only when Privy is configured. No arbitrary email codes or generated wallet addresses are accepted.

### On-chain marketplace

`contracts/programs/pokefun_market` lists, sells, takes offers and swaps Metaplex Core cards for native SOL. A listed or traded card never leaves its owner's wallet: the program freezes it with Core's FreezeDelegate and moves it with TransferDelegate, so it stays battle-eligible until it sells. Offers and trade SOL are escrowed in program accounts; the fee (2.5%) goes to a treasury. See [`contracts/README.md`](contracts/README.md).

The Go API indexes it read-only when `MARKET_PROGRAM_ID` is set (`services/api/internal/market`): `GET /api/market` (snapshot of cards, listings, offers, trades, sales), `POST /api/market/refresh`, `GET /api/market/sol-price`. Users sign every marketplace transaction. Optional onboarding uses a separate server-only Devnet minter key. History is kept in `MARKET_STORE_PATH` (default `data/market.json`).

The marketplace has no mock mode: without the API it shows an unavailable notice. Signing works with a Privy wallet or with "Continue with Phantom"; email sign-in uses Privy when configured.

### Free NFT → list → buy → wallet transfer

These are test collectibles, but minting, payment and ownership are real Solana transactions. Connect Phantom, click **Get a free card** on `/market` or `/collection`, and the API creates a Metaplex Core NFT owned by that wallet. In My Cards, get Devnet SOL for fees and list the card. Another wallet can buy it: the contract atomically pays the seller, pays the marketplace fee and transfers the NFT to the buyer. The index then removes it from the seller's collection and adds it to the buyer's collection and battle loadout.

Configure a deployed market program and a collection owned by your minter (from `contracts/`):

```sh
node scripts/setup-market.mjs --rpc https://api.devnet.solana.com --admin /private/path/minter.json --create-collection "Poke.fun Devnet Cards"
```

Export these in the Go API terminal before running `go run ./cmd/server`:

```sh
export MARKET_PROGRAM_ID=<deployed-market-program>
export MARKET_RPC_URL=https://api.devnet.solana.com
export MARKET_MINTER_KEYPAIR=/private/path/minter.json
export MARKET_MINT_COLLECTION=<collection-printed-by-setup>
export MARKET_FAUCET_SOL=0.25
```

Set `NEXT_PUBLIC_MARKET_PROGRAM_ID` and `NEXT_PUBLIC_SOLANA_RPC_URL` to the same program/network in `apps/web/.env.local`. Fund the minter with Devnet SOL for mint rent, fees and grants. It must control the collection's update authority; the setup script approves that collection in the market. The API rejects mainnet onboarding. Never expose the minter key through a `NEXT_PUBLIC_` variable.

Minting is limited to three cards per wallet daily, twelve per connecting IP and four hundred globally. SOL grants are limited to one per wallet, four per IP and sixty globally per twelve hours; wallets already at the grant threshold receive nothing. Limits persist in `MARKET_STORE_PATH`; the faucet keeps a reserve. The API uses the direct connection IP, so a reverse proxy shares an IP quota. Buyers and sellers always sign their own trades; the minter cannot authorize a sale for them.

Run the integration suite with `cd contracts && ./tests/run-market.sh` (Go, Node, Solana tools and built program artifacts required). It uses an isolated local validator with real Core and marketplace programs, runs the 39 contract checks, then starts the Go API and verifies minting, faucet limits, listing, purchase, on-chain ownership, wallet collections and sale history. Override `MARKET_TEST_PORT`, `MARKET_TEST_API_PORT` or `GO_BIN` if needed.

### Card catalog and summon gallery

- `apps/web/lib/cards/catalog.generated.json` is the versioned card → creature catalog (Base Set, Jungle, Fossil, 151, Crown Zenith Galarian Gallery). Each entry has its species, level, power tier and the `artWindow` the summon lifts out of the card. Regenerate it with `npm run catalog` (from cached API responses in `scripts/.cache/`, or `-- --refresh` to download again), and check every species against PokéAPI with `npm run catalog:check`.
- `/dev/summons` (dev builds only, or set `NEXT_PUBLIC_DEV_TOOLS=1`) lists every catalog card and plays its full or mini summon. Owned inventory comes from the wallet index.
- QA findings and their status are in `docs/qa-report.md`.

### Pokémon data

The Go server's Pokémon database (`services/api/internal/pokedex/pokedex.json`) holds every Pokémon (1,214 entries with card forms), with types, base stats, sprite, power tier and every damaging move it can learn, plus the card → species mapping. Rebuild it from PokéAPI with `node scripts/build-pokedex.mjs` from the repo root; it also writes the browser's card-name index, `apps/web/lib/cards/species.generated.json`. See [`docs/game-mechanics.md`](docs/game-mechanics.md#pokédex-data).
