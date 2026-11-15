# Devnet test card minter

Creates a Metaplex Core collection and eleven clearly labeled **devnet-only test NFTs**: eight for the first wallet and three for the second. The roster is in `card-metadata.mjs`. None is a vaulted card or carries redemption rights.

Run from `tools/devnet` after `npm install`:

```sh
npm run mint:test-cards -- FIRST_SOLANA_ADDRESS SECOND_SOLANA_ADDRESS
```

The script creates a dedicated devnet payer for mint fees. This **is not either recipient wallet**: the NFTs are sent to the public addresses passed on the command line. The script requests devnet SOL, uploads metadata through Irys, mints the collection and assets, and records public addresses in `/private/tmp/pokefun-devnet-mints.json`. The first two cards use generated placeholder art; the others reference public Pokémon TCG card images. If the RPC faucet is unavailable, a person can request devnet SOL for the displayed payer address at [Solana's faucet](https://faucet.solana.com/). No real SOL is involved.

The payer keypair is written with owner-only permissions to `/private/tmp/pokefun-devnet-payer.json`. Both paths can be overridden with `POKEFUN_DEVNET_STATE_PATH` and `POKEFUN_DEVNET_PAYER_PATH`. Never commit the payer file.

The app must be configured with the new collection and asset addresses before it will read these NFTs from wallets. Devnet assets can disappear if the network resets.

Run `npm run verify:test-cards` to check the collection, each owner's onchain address, and the off-chain metadata. The app's test mode reads the two known Core asset addresses directly from Solana RPC, so a DAS provider is not required for this specific demo. A DAS provider will be useful when supporting arbitrary collections later.
