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

Each player uses one card. Both submit an attack; the Go server resolves both simultaneously. Quick attacks generate one energy, while stronger attacks cost two energy. The first card at zero HP loses. If both reach zero on the same turn, the match is a draw.

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

Open `http://localhost:3000` in two separate tabs. Create a match in one, copy its room code, and join in the other. Sessions are stored per tab. The API health endpoint is `http://localhost:8080/health`.

If your ports differ, set `API_ADDR` and `WEB_ORIGIN` for the Go server and `NEXT_PUBLIC_API_URL` for the frontend; see `apps/web/.env.example`.

Run backend tests with `cd services/api && go test ./...` and check the frontend with `cd apps/web && npm run build`.

## Next implementation steps

1. Replace the fictional catalog with a curated, verified battle catalog for supported collectibles.
2. Add persistent match storage, reconnect, turn deadlines, and forfeit/refund rules.
3. Add Solana wallet login and verify ownership of supported card NFTs.
4. Add matchmaking within compatible formats.
5. Add devnet escrow and settlement after the battle protocol is stable.

Matches are in memory and disappear when the API restarts. Player tokens are for this local demo only; do not use this code to hold stakes. Real-money or card staking requires legal review before a public launch. The Go server is currently a trusted referee.
