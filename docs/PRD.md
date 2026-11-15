# Poke.fun — Product Requirements Document

| Field | Value |
| --- | --- |
| Status | Draft for team review |
| Target | UBC 2026 hackathon demo |
| Primary track | Consumer Apps |
| Product owner | Team to assign |

## 1. Product summary

Poke.fun is a browser-based, turn-based 1v1 card battle game. A player selects one collectible card, gets matched with another player, chooses attacks, and tries to knock out the opposing card. The long-term concept lets players stake equal amounts of USDC or mutually agreed tokenized physical cards, with the winner receiving the stakes. The hackathon version must first prove that the battle itself is fun, fair, and reliable.

The current repository contains a playable free-match demo with fictional cards. It does **not** connect wallets, verify NFTs, or hold stakes. This PRD separates that working base from proposed hackathon additions and later production features.

## 2. Problem and opportunity

Tokenized physical collectibles can be owned and traded, but ownership alone gives players little to do with a card inside an app. Poke.fun gives a card a playable role and makes its ownership visible in a social, competitive experience. The differentiator is a player-controlled battle whose outcome depends on choices, rather than a coin flip or random draw.

## 3. Users and core jobs

| User | Job |
| --- | --- |
| Collector | Use a card they own in a game without redeeming the physical card. |
| Competitive player | Find a fair opponent and win through attack choices. |
| Friend group | Create a private match, share a room code, and watch the result together. |

Spectators, voice commentary, and prediction markets are outside the first release. Prediction markets are not part of the current product plan.

## 4. Product principles

1. **One card is enough.** A player must never need a three-card deck to participate. Larger teams can be a later format.
2. **Player decisions matter.** Attacks have tradeoffs such as energy cost and damage; the server rejects illegal moves.
3. **Comparable opponents.** Card format or power tier is checked before skill rating. A player's MMR alone cannot make a clearly unequal card matchup fair.
4. **A collectible's price is not combat power.** Market price, vault value, and grading score do not automatically increase HP or damage.
5. **The server is the referee.** The Go backend decides turn outcomes. Any onchain payout based on that result must explicitly account for this trust assumption.
6. **No ambiguous stakes.** Both players must see and approve the exact stake asset and settlement rules before either deposit is final.

## 5. Scope by release

### Release A — playable free match (implemented in the starter)

- Two players create/join a room using a code.
- Each chooses one fictional sample card.
- Each submits one attack per turn; attacks resolve simultaneously once both submit.
- Quick attacks build energy; stronger attacks spend energy.
- Server calculates HP, records a turn log, and declares win, loss, or draw.
- Browser shows card stats, available attacks, pending state, and result.

### Release B — hackathon target

- Connect an existing Solana wallet, starting with Phantom; accept other wallets only if they expose a compatible Solana account.
- Verify a wallet signature for login. The app never asks for a seed phrase or private key.
- Read supported vaulted-card NFTs from the connected wallet and verify current ownership on Solana.
- Map each supported NFT to a curated battle card definition. Unsupported cards are shown as ineligible rather than given invented stats.
- Allow a wallet owner to choose one eligible card and play a free 1v1 match.
- Persist match state so a server restart or page refresh does not erase a live match.
- Provide clear turn deadlines, reconnect behavior, and a deterministic result for disconnects.

### Release C — devnet stake demo, only after Release B is stable

- Players choose **one stake mode per match**: equal USDC deposits or one agreed card NFT from each player. Mixed stake types are not supported.
- Both players review the stake terms and escrow destination before signing transactions.
- Escrow waits for both deposits before play starts. If a deposit fails or the second player does not deposit by the deadline, the first player can recover their deposit.
- A win transfers the escrowed stakes to the winner. A draw refunds each original asset to its depositor.
- Timeout and dispute paths are specified and tested before any value-bearing deployment.
- Devnet assets are used for the hackathon demo. Real vaulted mainnet cards and real-money stakes are outside the demo unless legal and security review explicitly clears them.

### Later releases

- Public matchmaking by battle format/power tier, then MMR band and stake band.
- Ratings, match history, replays, and leaderboards.
- Optional larger-team formats for people who own two or more cards; one-card play remains available.
- Voice commentary if it improves the battle experience and can be delivered reliably.

## 6. Main user flow

1. Player opens the site and sees the one-card battle format.
2. For a free match, player selects an eligible card and creates or joins a room.
3. For a future staked match, each player chooses and approves the exact stake terms; both deposits are confirmed before the battle begins.
4. The server shows both cards, HP, energy, and the current turn.
5. Both players submit an attack. The UI shows that a choice is locked in without revealing it to the opponent until both choices are submitted.
6. The server validates and resolves the turn, then broadcasts the same result to both players.
7. Play repeats until a card reaches zero HP or a defined timeout ends the match.
8. Both players see the winner and turn log. A future escrow program settles or refunds according to the recorded result and match terms.

## 7. Functional requirements

| ID | Priority | Requirement | Acceptance criterion |
| --- | --- | --- | --- |
| B-01 | P0 | One-card match | Two players can complete a match with one card each. |
| B-02 | P0 | Authoritative turns | Only the server changes HP, energy, turn number, and winner. |
| B-03 | P0 | Hidden simultaneous choices | A submitted attack is not revealed before both players submit. |
| B-04 | P0 | Legal move validation | Unknown attacks, insufficient energy, duplicate submissions, and moves after match end are rejected. |
| B-05 | P0 | Shared result | Both clients see identical HP, turn log, and winner after resolution. |
| B-06 | P0 | Draw handling | Simultaneous knockouts produce a draw, not an arbitrary winner. |
| W-01 | P1 | Wallet login | A signed nonce proves control of a Solana address; nonce cannot be replayed. |
| N-01 | P1 | NFT eligibility | Only currently owned NFTs from supported collections can enter an NFT-backed match. |
| N-02 | P1 | Battle mapping | Every playable NFT resolves to a reviewed, versioned combat definition. |
| R-01 | P1 | Recovery | Refresh or temporary disconnect preserves a player's match seat and state. |
| R-02 | P1 | Turn deadline | The match ends or advances by a documented rule when a player misses a deadline. |
| S-01 | P2 | Equal USDC escrow | Two equal deposits are confirmed before play; winner receives the pot, draw refunds both. |
| S-02 | P2 | NFT escrow | Each player deposits the exact agreed NFT; winner receives both, draw returns each original NFT. |
| S-03 | P2 | Failed setup refund | No match can strand the first player's deposit when the second player fails to fund. |
| M-01 | P2 | Skill matchmaking | Queue pairs players in the same format/power tier, then uses rating and stake band. |

P0 is required for a playable demo, P1 is the recommended hackathon extension, and P2 is conditional on time and review. The existing starter meets B-01 through B-06 for local free matches, with in-memory state only. It also now implements R-02 (a 60-second turn deadline that auto-plays the player's quick attack) and the rules/catalog version locking described in §8. R-01 persistence/reconnect and the wallet/NFT/stake requirements remain open.

## 8. Initial game rules

- Match format: one card per player, one chosen attack per player per turn.
- Both attacks resolve simultaneously. Damage is applied to both cards before checking for a knockout.
- A quick attack costs zero energy and grants one energy. A heavy attack costs two energy and deals more damage.
- Attacks have an element. Quick attacks are neutral; heavy attacks use the card's element, gaining a same-type bonus and a type-effectiveness multiplier against the opponent's element. The full damage and type rules are in [battle-spec.md](battle-spec.md).
- Energy and HP are server-owned values. Negative HP is displayed as zero.
- If one card is knocked out, the other player wins. If both are knocked out on the same turn, the result is a draw.
- The combat catalog is versioned. A match locks its card definitions and rules version when it starts, so later balance changes cannot alter an active match.
- The final supported-card list and any use of printed TCG moves need explicit data mapping and rights review. Marketplace NFT metadata alone is not a complete rules source.

The existing sample cards are fictional. Their stats are for engineering tests, not the final balance design.

## 9. Architecture and data

| Component | Responsibility |
| --- | --- |
| Next.js web app | Wallet connection, card selection, battle UI, transaction signing, and result display. |
| Go API | Login verification, ownership checks, matchmaking, authoritative battle state, turn timers, and result records. |
| Database | Users, card mappings, matches, actions, ratings, and settlement references. PostgreSQL is the planned persistent store. |
| Solana RPC/indexer | Verify wallet ownership, NFT identity, deposits, and final transactions. |
| Solana escrow program | Hold exact stakes, enforce deposit windows, pay winner or refund under defined conditions. |

The Go server's signed outcome is a trust boundary: the escrow program cannot independently determine who won an off-chain battle. Before staking, the team must define who can sign outcomes, how signer keys are protected, how results are audited, and what happens when the server is unavailable or disputed.

## 10. Non-functional requirements

- **Consistency:** A turn is applied once, even if a player retries the request.
- **Security:** Wallet login uses expiring single-use nonces; room codes do not substitute for player authentication. No server-held wallet private keys.
- **Availability:** A process restart must not erase a funded match. Staked matches need a recovery/refund path that does not depend solely on the web server remaining online.
- **Observability:** Log match ID, rules version, turn number, action timestamps, deposit transaction IDs, and settlement transaction ID without logging player secrets.
- **Usability:** Both players can tell whose action is pending, what an attack costs, and why a match ended.
- **Performance:** A normal attack submission should update both clients within two seconds under hackathon demo conditions.

## 11. Success criteria for the demo

1. A judge can create a room and join from a second browser without developer intervention.
2. Both players can finish a one-card match, including a heavy attack after earning energy.
3. Both screens show the same winner and turn history.
4. If Release B is shown, the team can explain and demonstrate that a supported NFT belongs to the connected Solana wallet and maps to a fixed battle definition.
5. If Release C is shown, the team can demonstrate a complete devnet deposit-to-settlement path and a refund path.

## 12. Risks and decisions to close

| Topic | Decision needed before implementation or launch |
| --- | --- |
| Collectible scope | Which collection(s), NFT standards, and specific card sets are supported first? |
| Battle data | Are abilities original game mechanics, licensed card text, or a curated mapping of printed attacks? Who reviews balance and rights? |
| Fairness | What format or power-tier rule makes one-card matchups acceptable? |
| Timeouts | How long is each turn, and is a missed turn a forfeit, automatic move, or cancelled match? |
| Stakes | Are battle cards themselves staked, or can a player stake a different NFT? What exact asset is shown in the confirmation screen? |
| Oracle trust | Who signs the off-chain result, and what independent evidence or dispute path exists? |
| Legal and IP | Jurisdiction-specific wagering review and permission to use third-party names, art, and printed game text. |

## 13. Explicit exclusions

- Spectator prediction markets.
- A mandatory multi-card deck.
- Price- or grade-based combat boosts.
- Mainnet wagers in the hackathon prototype without legal and security review.
- Claims that smart contracts independently verify off-chain gameplay.
