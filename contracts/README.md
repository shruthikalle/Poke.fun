# Poke.fun Devnet wager escrow

The Anchor program is deployed on **Solana Devnet** at [`FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J`](https://explorer.solana.com/address/FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J?cluster=devnet). It accepts native Devnet SOL wagers and, separately, its configured SPL demo token. Its immutable config account is [`8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S`](https://explorer.solana.com/address/8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S?cluster=devnet). The configured token mint is [`e8aEdsUNqX96cnptqfH1ddGdYvKspSEzLGHrpgH8Zhp`](https://explorer.solana.com/address/e8aEdsUNqX96cnptqfH1ddGdYvKspSEzLGHrpgH8Zhp?cluster=devnet), a **six-decimal demo token, not Circle USDC or a dollar claim**. The trusted referee address is `4JEbjdy2WGKASayP2LuiMvA8TVo1uQ9z7mjgZLxgbHvL`. The two test wallets `Dxx5…Q8p6z` and `7Aug…793k` each received ten demo tokens. The second wallet also received 0.03 Devnet SOL for transaction fees.

## Match flow

1. For a native Devnet SOL wager, player A signs `open_sol_wager(nonce, stake)` and sends the chosen lamports into the program-owned wager account. For a token wager, A signs `open_wager(nonce, stake)` and deposits the configured mint into a token vault. In either case, the wager is `Waiting` for five minutes. One SOL is `1_000_000_000` lamports; one six-decimal demo token is `1_000_000` token units.
2. An off-chain skill queue pairs A with B at the same stake. The configured referee signs `reserve_wager(B)`, restricting the wager to B's wallet for two minutes.
3. B signs `join_sol_wager` or `join_wager` and deposits the same amount. The match becomes `Playing` for fifteen minutes only after both deposits are confirmed.
4. The authoritative game server decides the result. The referee signs `settle_sol_wager(winner)` or `settle_wager(winner)`, transferring both deposits to that player. It can sign `settle_sol_draw` or `settle_draw` to return each stake for a tie.
5. Before B joins, A can sign `cancel_sol_wager` or `cancel_wager` to recover the deposit. After any deadline, anyone can sign `expire_sol_wager` or `expire_wager`; it returns A's deposit if no one joined, or both original deposits if the match timed out. Native SOL terminal paths close the wager account and return its rent to A; the transaction log remains the audit trail.

The program enforces the mint, stake, reserved opponent, payout recipient, state transitions, and timeouts. **It trusts the referee to report the winner honestly.** A referee compromise or bad game result can misdirect the pot before the battle deadline. This is a Devnet prototype, not an audited real-funds contract.

## Current app integration

The existing web loadout still labels nonzero entries as **demo entries**. It does not yet sign `open_sol_wager`, `join_sol_wager`, `open_wager`, or `join_wager`; the Go queue does not verify on-chain deposits, reserve opponents, or settle battle results. Its match creation is therefore separate from the deployed escrow. Do not describe the current `$1` button as an on-chain bet. A full integration must bind the authenticated wallet and NFT to an on-chain wager, start the game only after the `Playing` state is confirmed, persist the game-to-wager mapping, have the server referee sign the result, and show transaction signatures and refund actions in the UI. Never put the referee key in browser code.

## Build and verify

From `contracts/`:

```sh
cargo fmt --check
cargo check
SBF_SDK_PATH=/path/to/writable/sbf anchor build
solana-test-validator --reset --bpf-program FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J target/deploy/pokefun_wager.so
npm ci
npm run test:local
```

The local test covers token and SOL deposits, opponent restrictions, unauthorized settlement rejection, payout, draw refund, and pre-match cancellation. The on-chain [token smoke wager](https://explorer.solana.com/address/6DiKVH7fsxduAArn1c3HuxzmPyWgwNmCYHbyfVmW1V1e?cluster=devnet) demonstrates an actual one-token deposit from each side and a two-token payout. The [Devnet SOL settlement transaction](https://explorer.solana.com/tx/2yvx2TncYzDFAAyUiKTyZNL2hZTWWbcS8tD62bCCN2rj9vrStwzXZWCZeX535X1dEZCjYtk7KtvXaDUHdGrrbjiM?cluster=devnet) paid a 0.02 SOL pot after two 0.01 SOL deposits. Run `POKEFUN_PAYER_KEYPAIR=/path/to/payer.json POKEFUN_REFEREE_KEYPAIR=/path/to/referee.json npm run test:sol:devnet` to repeat with fresh disposable wallets.

To create a **fresh** Devnet deployment, generate a program keypair, update `declare_id!` and `Anchor.toml`, then deploy with `solana program deploy target/deploy/pokefun_wager.so --program-id /path/to/program.json --keypair /path/to/payer.json --url devnet`. Run `POKEFUN_PAYER_KEYPAIR=/path/to/payer.json POKEFUN_REFEREE_KEYPAIR=/path/to/referee.json npm run setup:devnet -- <wallet-one> <wallet-two>` once. The setup script creates the referee key, test mint, immutable config, and ten test tokens per listed wallet. Run `POKEFUN_PAYER_KEYPAIR=/path/to/payer.json POKEFUN_REFEREE_KEYPAIR=/path/to/referee.json npm run test:devnet` to exercise the deposited and settled path. Keep all keypair files outside git. The referee key must be kept for the game server; losing it prevents prompt settlement, though anyone can trigger a timeout refund.

This deployment's payer, program upgrade, and referee keypairs are backed up as SOPS-encrypted binary files in the local, git-ignored `secrets/devnet-wager-*.sops.json` directory. Back up that encrypted directory and your age identity separately; a fresh clone will not contain it. To recover a keypair locally, set `SOPS_AGE_KEY_FILE` to your age identity file and run `sops decrypt --output-type binary --output /private/tmp/pokefun-referee.json secrets/devnet-wager-referee.sops.json` from the repo root. Substitute `payer` or `program` in both filenames for the other keys. Decrypted files are secrets; use a private temporary directory and delete them when finished.
