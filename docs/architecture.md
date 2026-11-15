# Architecture

```text
Next.js web app  <->  Go API / battle server
      |                     |
Solana wallet          Match state and rules
      |                     |
      +---- Solana escrow program (later)
```

## Ownership boundaries

- The web app displays cards and sends player actions.
- The Go server validates actions and determines the winner. It is the trusted referee in the first version.
- Solana verifies NFT ownership and holds stakes in a later version. A smart contract cannot infer the winner from an off-chain battle by itself.
- Collector Crypt NFT metadata identifies the collectible; battle HP and attacks require a separate game catalog. The team battle maps cards to creatures through the versioned catalog in `apps/web/lib/cards/` and PokéAPI stats; the one-card duel uses fictional cards in `services/api/internal/battle/cards.json`.

## Build order

1. Free matches, in memory (implemented): the one-card duel and the server-authoritative team battle, with hidden simultaneous choices, type effectiveness, server-enforced turn deadlines and version locking. See [game-mechanics.md](game-mechanics.md).
2. Matchmaking within compatible formats (implemented for the team battle: format, card power tier and entry, with an AI fallback). Rating bands are still to do.
3. Persistent matches (still to do). A refresh already rejoins a live two-player match from the server's event log, but a server restart ends all battles.
4. Wallet sign-in and ownership checks for supported NFTs.
5. Devnet escrow, result signing, settlement, and refunds.
6. Optional voice commentary.
