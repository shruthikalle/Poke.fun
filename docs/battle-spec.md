# Battle spec (rules v1.0.0)

> For a detailed, example-driven walkthrough of both battle engines, see
> [`game-mechanics.md`](game-mechanics.md). This file is the terse canonical spec.


The authoritative battle rules, implemented by the Go server in
`services/api/internal/battle`. The server is the referee: it owns every HP,
energy, turn and winner value, and the web client only displays what the server
reports. This document is the source of truth for `RulesVersion` **1.0.0**.

A match locks its `RulesVersion` and `CatalogVersion` when it is created, and each
player's card definition is copied into the match at join time. A later catalog
or rules change therefore cannot alter a match that is already in progress
(PRD §8).

## Match shape

- **One card per player.** Each player brings a single card with a fixed max HP
  and two attacks.
- **Simultaneous, hidden turns.** Both players submit one attack per turn. A
  submitted attack is never revealed to the opponent until both have submitted
  (`View.Submitted` exposes only a boolean). Once both are in, the turn resolves.
- **Damage is applied together.** Both attacks' damage is computed against the
  pre-turn state and applied in the same step, so a turn can knock out both
  cards at once.

## Energy

- Every card has one **quick** attack (cost 0, grants +1 energy) and one
  **heavy** attack (cost 2, grants 0).
- Energy is a server-owned value starting at 0. The server rejects a heavy
  attack when the player cannot afford its cost (`ErrInvalidAttack`).

## Damage

For an attack of element *E*, base power *P*, from an attacker of card-element
*A* against a defender of card-element *D*:

```
damage = round(P × STAB × effectiveness)
STAB   = 1.5 if E == A, else 1.0            (same-type attack bonus)
effectiveness = TypeMultiplier(E, D)         (2, 1, 0.5 or 0)
```

A non-immune hit always deals at least 1 damage. Negative HP is clamped to 0.

### Type effectiveness

`TypeMultiplier` uses the 18-type chart in `battle/types.go`, which mirrors the
frontend chart in `apps/web/lib/battle/roster.ts` so the server and the display
layer agree. Quick attacks are element **Normal** (neutral chip damage); heavy
attacks carry the card's element, so they earn STAB and can be super-effective
or resisted. The turn log records each attack's effectiveness as `super`,
`resisted`, `immune` or `normal`.

The three sample cards form a Fire → Grass → Water → Fire triangle:

| Card | Element | Quick | Heavy |
| --- | --- | --- | --- |
| Emberfox | Fire | Quick Claw (Normal, 20) | Flare Burst (Fire, 45) |
| Tidecub | Water | Quick Splash (Normal, 18) | Wave Crash (Water, 48) |
| Mossling | Grass | Quick Vine (Normal, 16) | Bloom Strike (Grass, 50) |

Sample stats are for engineering tests, not final balance (PRD §8).

## Turn deadline (PRD R-02)

Each turn has a deadline of `TurnDuration` (60 s), exposed to clients as
`View.DeadlineUnixMs`. When the deadline passes, the server auto-plays the
cheapest affordable (quick) attack for any player who has not submitted, then
resolves the turn. Auto-played attacks are flagged in the turn log (`Turn.Auto`)
so both players can see which choices were made by the timer.

Timeouts are evaluated whenever a client polls or submits (`ApplyTimeout`). A
background sweeper could make expiry fully push-based; it is not required for the
polling demo.

## Outcome

- One card at 0 HP: the other player wins.
- Both at 0 HP on the same turn: the match is a **draw**.
- A finished match rejects further attacks (`ErrFinished`).

## Out of scope for v1.0.0

Wallet login, NFT ownership/eligibility, matchmaking, and any staking or escrow.
Those live in other services and branches; they must not change these
authoritative rules.

## Rich team battle (`/battle`)

The `/battle` screen uses a second, richer ruleset served by the
`internal/livebattle` package — teams of up to three creatures, PP-limited
moves, accuracy, crits, the physical/special split, speed-ordered turns and
switching, scored from PokéAPI stats. It is **also server-authoritative**: the
web client builds the creature teams (species stats and sprites come from
PokéAPI) and posts them to `POST /api/battles`; the server runs the battle,
including the AI opponent, and returns the ordered `BattleEvent`s the client
reducer renders. `ServerBattleStream` replaces the former client-side
`MockBattleStream`; the mock remains only as an offline fallback
(`NEXT_PUBLIC_LIVE_BATTLE=0`).

Endpoints: `POST /api/battles` (create + opening events), and, authenticated by
the returned token, `POST /api/battles/{id}/choice|timer|chat|rematch`. Each
battle runs from a per-match seed, so a given sequence of choices is
reproducible. The type chart is shared with the one-card engine
(`battle.TypeMultiplier`).

The two engines are not yet unified; the one-card simultaneous model above is
the canonical staking-path ruleset, while the rich model drives the richer
single-player-vs-AI `/battle` experience. Real-time two-player play and merging
the models remain future work.
