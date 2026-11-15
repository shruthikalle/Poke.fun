# Poke.fun

A one-card, real-time 1v1 arena plus an earlier turn-based demo. Two players enter a live queue, get paired automatically, move and attack at the same time, and see the same Go server-decided result. The live arena is free to play; NFT ownership is displayed for reference but is not required or verified by the arena server. A separately tested Solana wager contract exists under `contracts/`, but the web and Go apps have not been wired to it; paid entries shown in the UI are demos.

## Repository layout

```text
apps/web/                         Next.js frontend and battle screen
services/api/cmd/server/          Go API entry point
services/api/internal/battle/     Card catalog and battle rules
services/api/internal/arena/      Live battle simulation and card rules
services/api/internal/server/     HTTP match endpoints
contracts/                        Solana wager escrow program and local validator test
docs/                             Architecture and rules decisions
```

## Current rules

In `/arena`, each player uses one card at level 50. Pikachu and Charmander have distinct HP, speed, range, damage, and cooldowns chosen for this game, not read from NFT metadata. Basic hits gain one energy (maximum three). Specials cost two energy, show a 0.4-second warning area, and lock the attacker in place until they fire. Pikachu's Thunderbolt strikes opponents within its radius; Charmander's Flamethrower hits a cone that can be aimed with the mouse or auto-aimed. A dodge dashes away or in the movement direction and avoids damage briefly, then goes on cooldown. The Go server simulates movement and attacks 20 times a second and broadcasts snapshots 10 times a second. Knock out the opponent before 90 seconds; at time, the higher HP percentage wins. Simultaneous knockouts and equal percentages are draws. The earlier `/play` route keeps its turn-based energy rules.

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
- `/loadout`: pick Pikachu or Charmander from your Devnet collection or guest rentals, select a demo entry, and join the live queue. No funds move.
- `/battle`: battle screen for the matched cards. It runs on its own with mock data, so the Go API is not needed. Opening it without a match sends you to `/loadout`.
- `/play`: the original one-card demo that talks to the Go API.
- `/arena`: live two-player arena with automatic matchmaking, keyboard or touch controls, and reconnect in the same tab.
- `/battle/live`: the live match opened automatically after matchmaking on `/loadout`.

To test matchmaking, open `http://localhost:3000/loadout` in two separate browsers or tabs and click **Find match** in each. The first player stays on the loadout page while waiting; the second is paired automatically if both selected the same demo entry. The queue selects the waiting player with the closest demo rating and opens `/battle/live` for both. A guest can select a free Pikachu or Charmander rental. The queue ticket and match token are held in each tab's session storage, so a refresh reconnects that player. Use WASD or arrow keys to move, J or Space for the basic attack, K for the special, and Shift to dodge. Touch controls are below the arena.

For a friend on another device, both browsers must reach the same web app and Go API. Run the web app with `npm run dev -- --hostname 0.0.0.0`, set `NEXT_PUBLIC_API_URL=http://YOUR_LAN_IP:8080` in `apps/web/.env.local`, restart Next, and run the Go API with `WEB_ORIGIN=http://YOUR_LAN_IP:3000`. Both players should open `http://YOUR_LAN_IP:3000/loadout` on the same network. For internet play, deploy both services over HTTPS/WSS and set `NEXT_PUBLIC_API_URL` and `WEB_ORIGIN` to the public origins. Queue and matches are held in one Go process, so use one API instance for this demo.

For `/play`, open `http://localhost:3000/play` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

### Frontend integration seams

`/loadout` and `/battle` read all live data through typed interfaces in `apps/web/lib`, each backed by a mock for now. To swap in a real service, implement the interface; the UI code doesn't change.

| Seam | Interface | Mock | TODO |
| --- | --- | --- | --- |
| Battle feed | `BattleStreamSource`, `useBattleStream` (`lib/battle`) | `MockBattleStream` | QuickNode Streams / Go API match feed |
| Win odds | `OddsProvider`, `useOdds` (`lib/markets`) | `MockOddsProvider` | Gemini prediction markets |
| Sound cues | `AudioCueProvider`, `useBattleAudio` (`lib/audio`) | `SynthAudioProvider` | ElevenLabs |
| Sign-in | `AuthService` (`lib/wallet`) | `mockAuthService` | Go API nonce + signature check |
| Lobby and chat | `LobbyService`, `RoomChatService` (`lib/lobby`) | `MockLobbyService`, `MockRoomChatService` | Presence and chat API |
| Owned cards | `CollectionService` (`lib/cards`), shaped like Metaplex DAS `getAssetsByOwner` | `MockCollectionService` | DAS RPC (QuickNode) |
| Card → creature | `CARD_MAPPING`, `resolveCard` (`lib/cards/mapping.ts`) | Versioned table | Reviewed card list |
| Creature data | `SpeciesService` (`lib/pokemon`) | Live PokéAPI, cached in memory + localStorage | — |
| Rank | `RankService` (`lib/rank`) | `MockRankService` (localStorage Elo) | Go API ratings |
| Entry and winnings | `StakeService` (`lib/stake`) | `MockStakeService` (no money moves) | Connect wallet signing and Go matchmaking to the tested `contracts/` escrow; use devnet test tokens first |
| Matchmaking | `lib/arena.ts` + Go `/api/arena-queue` for live play | `/battle` still uses `MockMatchmakingService` | Server-verified rating and more formats |

Creature stats, moves and sprites come from [PokéAPI](https://pokeapi.co); card art comes from the Pokémon TCG API image CDN. Pokémon is a trademark of Nintendo / The Pokémon Company, so get a rights review before any public launch.

Run backend tests with `cd services/api && go test ./...` and check the frontend with `cd apps/web && npm run build`.

## Next implementation steps

1. Replace the fictional catalog with a curated, verified battle catalog for supported collectibles.
2. Add persistent match storage, reconnect, turn deadlines, and forfeit/refund rules.
3. Add Solana wallet login and verify ownership of supported card NFTs.
4. Extend matchmaking beyond the free one-card Pikachu/Charmander format with server-verified rating and card eligibility.
5. Connect the tested devnet escrow to wallet signing, queue tickets, and the Go referee after binding wallet addresses to player sessions.

Matches and queue entries are in memory and disappear when the API restarts. Player tokens are for this free demo only; do not use this code to hold stakes. Real-money or card staking needs wallet signature login, verified card ownership, escrow and settlement, dispute and disconnect rules, and legal review before a public launch. The Go server is currently a trusted referee.

### Card catalog and summon gallery

- `apps/web/lib/cards/catalog.generated.json` is the versioned card → creature catalog (Base Set, Jungle, Fossil, 151, Crown Zenith Galarian Gallery). Each entry has its species, level, power tier and the `artWindow` the summon lifts out of the card. Regenerate it with `npm run catalog` (from cached API responses in `scripts/.cache/`, or `-- --refresh` to download again), and check every species against PokéAPI with `npm run catalog:check`.
- `/dev/summons` (dev builds only, or set `NEXT_PUBLIC_DEV_TOOLS=1`) lists every catalog card and plays its full or mini summon. It can also switch the mock collection (default, one card, all ineligible, empty, large).
- QA findings and their status are in `docs/qa-report.md`.

### Devnet NFT test mode

The normal `/loadout` collection is mocked. To test actual ownership with two devnet NFTs, mint the clearly labeled test assets using [`tools/devnet`](tools/devnet/README.md), then copy the public collection and asset addresses into `apps/web/.env.local` using the names shown in `apps/web/.env.example`. Set `NEXT_PUBLIC_COLLECTION_SOURCE=devnet`, rebuild/restart the web app, and connect the receiving Phantom wallet with Solana Devnet selected. The `/api/devnet-cards` route checks the known Core asset accounts and their current owners on Solana before returning playable cards. These are test NFTs, not vaulted collectibles; no staking is involved.

The Go backend can now read the same Metaplex Core NFTs directly from Solana RPC. Set `DEVNET_TEST_COLLECTION_ID` in the **API process environment** to the public collection address in `apps/web/.env.local`; optionally set `DEVNET_RPC_URL` (default: Solana public devnet RPC). Then `GET /api/collectibles/{assetAddress}?owner={walletAddress}` returns the on-chain owner, collection, name, URI, and off-chain image and card attributes. In devnet collection mode, `/loadout` also sends its selected asset address to the Go matchmaking queue, which checks ownership, collection, and Pokémon name before accepting it. The backend reads only Core assets in the configured test collection. The wallet address is still supplied by the client rather than proven by a server-verified signature, so this check is suitable for the free demo only; wager eligibility needs signed wallet authentication and ownership rechecking at escrow time.
