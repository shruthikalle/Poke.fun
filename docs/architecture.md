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
- Collector Crypt NFT metadata identifies the collectible; battle HP and attacks require a separate game catalog.

## Build order

1. One-card free matches with sample data.
2. Wallet sign-in and ownership checks for supported NFTs.
3. Matchmaking within compatible formats.
4. Devnet escrow, result signing, settlement, and refunds.
5. Optional voice commentary.
