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
- Collector Crypt NFT metadata identifies the collectible; battle HP and attacks require a separate game catalog. Cards map to species through the versioned catalog; the Go server builds online team stats and moves from its embedded Pokédex and locks the selections when players pair. The one-card duel retains fictional cards in `services/api/internal/battle/cards.json`.

## Build order

1. Free matches, in memory (implemented): the one-card duel and the server-authoritative team battle, with hidden simultaneous choices, type effectiveness, server-enforced turn deadlines and version locking. See [game-mechanics.md](game-mechanics.md).
2. Matchmaking within compatible formats (implemented for the arena and team queues: format, card power tier, exact entry, then a rating band that widens with waiting time).
3. Persistent matches (implemented for a single API process). Matches, queues and match terms are checkpointed and restored on restart; see [Persistence](game-mechanics.md#persistence).
4. Wallet sign-in and ownership checks for supported NFTs.
5. Devnet escrow, settlement, and refunds. Result signing is implemented: each final result is sealed with the agreed entry and verified cards ([Final results](game-mechanics.md#final-results-and-match-terms)).
6. Optional voice commentary.
