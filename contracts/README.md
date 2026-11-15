# Poke.fun wager escrow (prototype)

This Anchor program holds **one SPL token mint** selected at initialization. It accepts six-decimal tokens, so a $1 entry for a genuine USDC mint is `1_000_000` base units. The program does not verify that a six-decimal token is genuine USDC: the deployed mint address must be checked before anyone deposits.

## Flow

1. Deploy the program with its actual program ID. Call `initialize` once with the chosen devnet test-token mint and the trusted referee wallet. The config is immutable in this prototype.
2. Player A calls `open_wager(nonce, 1_000_000)` and signs a transfer of 1 test USDC into a program-owned vault. The on-chain wager is `Waiting` for five minutes. `nonce` must be unique per maker.
3. The Go matchmaking server indexes waiting wagers, matches on stake and rating, then its referee wallet calls `reserve_wager(wager, player_b_wallet)`. Only that wallet can join. The reservation lasts two minutes.
4. Player B calls `join_wager` and transfers exactly the same amount to the same vault. The wager becomes `Playing` for 15 minutes. The vault then holds 2 test USDC.
5. After the authoritative game server records a winner, the referee calls `settle_wager(winner)`. The contract checks that winner is A or B and sends the pot to that player's token account. It then closes the vault and records `Settled`.
6. Before B joins, A may call `cancel_wager` for a refund. When a deadline passes, anyone may call `expire_wager`; an unmatched offer refunds A, and a timed-out game refunds each player their own stake. These paths close the vault and leave the wager account as an audit record.

The queue ordering and skill rating are **off-chain**. The program enforces the reserved opponent, token mint, equal stake, winner recipient, and deadlines. It **trusts the referee to report the game result correctly**; it cannot independently verify real-time combat. The current web and Go apps still use demo entry amounts. They do not yet sign these instructions, link wallet addresses to queue tickets, index wager events, or call settlement. The contract alone does not make the UI's `$1` button charge a wallet.

## Build

```sh
cd contracts
cargo check
cargo test
anchor build
```

Anchor program dependencies are pinned to 0.31.1. If your Solana CLI installation is read-only, `anchor build` may fail while installing platform tools beside the CLI. Copy its `platform-tools-sdk/sbf` directory to a writable location and run `SBF_SDK_PATH=/path/to/writable/sbf anchor build`. On this machine, the SBF build and IDL generation passed with that setting. The generated IDL is copied to `idl/pokefun_wager.json` for client work.

To exercise real token transfers against a local validator after building:

```sh
solana-test-validator --reset --bpf-program Fg6PaFpoGXkYsidMpWxqSWY4ZbWvMaJf1c4SSbM9VTx target/deploy/pokefun_wager.so
# In another terminal, from contracts/:
npm install
npm run test:local
```

The test creates a six-decimal local token, funds two wallets, rejects an unreserved opponent and unauthorized settlement, pays the winner, and refunds a cancelled offer. It does not wait through the five-minute and fifteen-minute expiry windows.

Replace the example program ID in `Anchor.toml` and `declare_id!` with the deployed keypair's public address before deployment. Do not use this program with real funds: it has no independent audit, dispute process, or production game-result proof. Keep the demo on localnet or devnet test tokens until those pieces exist.
