# Devnet test card minter

Creates a Metaplex Core collection and two clearly labeled **devnet-only test NFTs**: a Pikachu stand-in for the first wallet and a Charmander stand-in for the second. Neither NFT is a vaulted card or carries redemption rights.

Run from `tools/devnet` after `npm install`:

```sh
npm run mint:test-cards -- FIRST_SOLANA_ADDRESS SECOND_SOLANA_ADDRESS
```

The script creates a dedicated devnet payer for mint fees. This **is not either recipient wallet**: the two NFTs are sent to the public addresses passed on the command line. The script requests devnet SOL, uploads placeholder SVG art and metadata through Irys, mints the collection and assets, and records public addresses in `/private/tmp/pokefun-devnet-mints.json`. If the RPC faucet is unavailable, a person can request devnet SOL for the displayed payer address at [Solana's faucet](https://faucet.solana.com/). No real SOL is involved.

The payer keypair is written with owner-only permissions to `/private/tmp/pokefun-devnet-payer.json`. Both paths can be overridden with `POKEFUN_DEVNET_STATE_PATH` and `POKEFUN_DEVNET_PAYER_PATH`. Never commit the payer file.

The app must be configured with a devnet DAS RPC and the new collection address before it will read these NFTs from wallets. Devnet assets can disappear if the network resets.
