# Poke.fun

One-card, turn-based battles using tokenized collectible cards. This repository is an early hackathon scaffold; wallet login, NFT verification, matchmaking, and staking are not implemented yet.

## Repository layout

```text
apps/web/                 Next.js frontend
services/api/             Go API and authoritative battle logic
data/cards.example.json   Example combat data for the first battle format
contracts/                Solana escrow contract design and future code
docs/                     Architecture and rules decisions
```

## First milestone

Two players each choose **one card** and an attack every turn. The Go server owns the match state and decides the winner. Start with example cards; add wallet-owned cards only after the battle loop works.

## Run locally

Frontend (Node.js 20.9+):

```sh
cd apps/web
npm install
npm run dev
```

Backend (Go 1.22+):

```sh
cd services/api
go run ./cmd/server
```

The frontend runs at `http://localhost:3000`; the API health endpoint is `http://localhost:8080/health`.

## Next implementation steps

1. Define the small initial card catalog and attack rules in `data/`.
2. Implement matches and turn resolution in `services/api/internal/battle/`.
3. Add a battle screen and connect it to the API.
4. Add Solana wallet login and verify ownership of supported card NFTs.
5. Add devnet escrow and settlement only after free matches work end to end.

Real-money or card staking requires legal review before a public launch. The Go server will be a trusted referee unless a separate verification mechanism is added.
