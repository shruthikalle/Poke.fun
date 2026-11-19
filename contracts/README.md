# Poke.fun Solana programs

- `programs/pokefun_market`: card marketplace (below).
- `programs/pokefun_wager`: Devnet wager escrow (further below).

## Card marketplace (`pokefun_market`)

Trades Metaplex Core cards from admin-approved collections for native SOL.

- **Non-custodial listings.** `list` adds Core FreezeDelegate (frozen) and TransferDelegate plugins with the program's `authority` PDA as delegate. The card stays in the seller's wallet and stays battle-eligible, but cannot move until it sells, trades or is released. Cancelling thaws it and returns both plugin authorities to the owner.
- **Buy** (`buy(expected_price)`): pays the seller the price minus the fee, pays the treasury the fee (`fee_bps`, default 0, capped at 1000) and transfers the card, all in one instruction. `expected_price` stops a seller from raising the price under a pending purchase.
- **Offers** on listed cards escrow the buyer's lamports in an offer PDA. The seller can accept, decline or counter; the buyer can accept a counter (topping up the difference) or withdraw. Anyone can refund an expired offer, or one whose listing is gone.
- **Trades**: up to 3 cards each way plus optional SOL from the proposer. The proposer's cards are frozen and delegated; the counterparty accepts by signing (atomic swap) or declines. The proposer can cancel, and anyone can expire a trade after 7 days. Clients delist listed cards in the same transaction.
- **Admin** can only set the fee, treasury, pause flag and collection allowlist. Pause blocks new activity but never cancels, refunds or declines.

Events (`Listed`, `Sale`, `OfferMade`, `TradeClosed`, …) feed the Go index in `services/api/internal/market`.

```sh
anchor build -p pokefun_market        # with Anchor 0.31.1
npm install && npm run fetch:core     # dumps the Core program for the local validator
./tests/run-market.sh                 # isolated validator + 39 contract checks + Go mint/buy integration
node scripts/setup-market.mjs --rpc <RPC> --collection <CORE_COLLECTION>   # initialize + approve a collection
```

The local program ID comes from `target/deploy/pokefun_market-keypair.json` (not committed). Before deploying, put the deployed address in `declare_id!`, `Anchor.toml`, `idl/pokefun_market.json` and `apps/web/lib/market/pokefun_market.idl.json` (or set `NEXT_PUBLIC_MARKET_PROGRAM_ID` / `MARKET_PROGRAM_ID`). Devnet only: no independent audit.

## Devnet wager escrow (`pokefun_wager`)

The Anchor program is deployed on **Solana Devnet** at [`FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J`](https://explorer.solana.com/address/FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J?cluster=devnet). It accepts native Devnet SOL wagers and, separately, its configured SPL demo token. Its immutable config account is [`8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S`](https://explorer.solana.com/address/8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S?cluster=devnet). The configured token mint is [`e8aEdsUNqX96cnptqfH1ddGdYvKspSEzLGHrpgH8Zhp`](https://explorer.solana.com/address/e8aEdsUNqX96cnptqfH1ddGdYvKspSEzLGHrpgH8Zhp?cluster=devnet), a **six-decimal demo token, not Circle USDC or a dollar claim**. The trusted referee address is `4JEbjdy2WGKASayP2LuiMvA8TVo1uQ9z7mjgZLxgbHvL`. The two test wallets `Dxx5…Q8p6z` and `7Aug…793k` each received ten demo tokens. The second wallet also received 0.03 Devnet SOL for transaction fees.

### Match flow

1. For a native Devnet SOL wager, player A signs `open_sol_wager(nonce, stake)` and sends the chosen lamports into the program-owned wager account. For a token wager, A signs `open_wager(nonce, stake)` and deposits the configured mint into a token vault. In either case, the wager is `Waiting` for five minutes. One SOL is `1_000_000_000` lamports; one six-decimal demo token is `1_000_000` token units.
2. An off-chain skill queue pairs A with B at the same stake. The configured referee signs `reserve_wager(B)`, restricting the wager to B's wallet for two minutes.
3. B signs `join_sol_wager` or `join_wager` and deposits the same amount. The match becomes `Playing` for fifteen minutes only after both deposits are confirmed.
4. The authoritative game server decides the result. The referee signs `settle_sol_wager(winner)` or `settle_wager(winner)`, transferring both deposits to that player. It can sign `settle_sol_draw` or `settle_draw` to return each stake for a tie.
5. Before B joins, A can sign `cancel_sol_wager` or `cancel_wager` to recover the deposit. After any deadline, anyone can sign `expire_sol_wager` or `expire_wager`; it returns A's deposit if no one joined, or both original deposits if the match timed out. Native SOL terminal paths close the wager account and return its rent to A; the transaction log remains the audit trail.

The program enforces the mint, stake, reserved opponent, payout recipient, state transitions, and timeouts. **It trusts the referee to report the winner honestly.** A referee compromise or bad game result can misdirect the pot before the battle deadline. This is a Devnet prototype, not an audited real-funds contract.

### Current app integration

The web loadout offers free play and native **Devnet SOL** stakes from 0.001 to 1 SOL per player. Paid queue requests require a Phantom-signed Devnet session and an NFT that the Go API verifies on-chain as owned by that wallet and belonging to the configured test collection. The first player signs `open_sol_wager`, the server confirms the escrow account and referee-reserves the second wallet, and the second player signs `join_sol_wager`. The Go arena starts only after both deposits are confirmed. Its result triggers server-side referee settlement; the battle page links to the escrow and payout transactions. A player can cancel and recover a pre-match deposit or, after the 15-minute contract deadline, sign a timeout refund.

For local play, run the Go API with `DEVNET_TEST_COLLECTION_ID=9cu8Rf7ryTHPrN24D62Q4xsEHnP8aBHS28mBdy4WRuCv` and set `POKEFUN_REFEREE_KEYPAIR` in `apps/web/.env.local` to the private local path of the configured referee key. The referee wallet needs a small Devnet SOL balance for reservation and settlement fees. Keep the keypair out of the browser and git.

The paid queue and settlement worker currently live in the single Next.js server process. A restart loses its queue and game mapping; signed-in players can cancel an unjoined deposit or recover a joined wager after the on-chain deadline. Persisting that mapping in a shared database and running a durable settlement worker are required before deploying this beyond a single-process hackathon demo. The SPL demo-token escrow is deployed but is not exposed in the loadout. Devnet SOL has no cash value; none of this processes real USDC or mainnet SOL.

A two-player app-to-contract integration test matched equal stakes, reserved the opponent, verified both deposits, started the arena, and [settled a 0.002 Devnet SOL pot](https://explorer.solana.com/tx/2qeHvQKF2Nnzg6gNZNrr7itjaADMgFDG5beZK5t5ToM3bD54rmFtVkFzoSRWgpYTdnv54vPRmzwpS7nxGr4jaySV?cluster=devnet). That test used a stub NFT reader and a predetermined arena result; the separate Go NFT reader test verified ownership of the minted Pikachu on Devnet. Two interactive Phantom profiles have not yet been exercised against the new UI.

### Build and verify

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
