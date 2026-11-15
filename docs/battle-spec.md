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
frontend chart in `apps/web/lib/battle/typeChart.ts` so the server and the display
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

The one-card duel pairs players by room code only; matchmaking exists for the
team battle below. Wallet login, NFT ownership/eligibility and any staking or
escrow live in other services and branches; they must not change these
authoritative rules.

## Team battle (`/battle`)

The `/battle` screen uses the canonical, full-featured ruleset served by the
`internal/livebattle` package: teams of up to three creatures, PP-limited moves,
accuracy, crits, the physical/special split and switching, scored from PokéAPI
stats. It shares this file's core turn rule — **both sides choose in secret and
the turn resolves only once both have chosen** — but applies the resolved turn
in order: switches first, then moves by speed.

- **Opponents.** A second human found through matchmaking (`POST /api/queue`,
  paired by format, card power tier and entry). Offline bot play is an explicit
  demo setting.
- **Shared log.** Every outcome is appended to one event log per battle; both
  clients poll `GET /api/battles/{id}/events?since=N`, so both screens show the
  identical battle. Each side has its own bearer token and can only act for
  itself; a player's choice never appears in the log before the turn resolves.
- **Forced switches** ask only the side whose creature fainted; the other waits.
- **Deadlines.** Online matches always run a 150-second turn clock, enforced by
  the server on the next poll (it auto-plays the stalling side). Against the AI
  the timer is optional.
- **Determinism.** Each battle runs from a per-match seed; a given sequence of
  choices replays identically.

See [`game-mechanics.md`](game-mechanics.md) for the formulas, the full turn
flow, the matchmaking rules and the HTTP API.
