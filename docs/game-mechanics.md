# Game mechanics

This document explains, in detail, the battle mechanics implemented in this
repo: the two battle engines, their rules and formulas, how a turn flows, how two
players are matched and kept in sync, and how the authoritative server and the
web client divide responsibility. It is the companion to
[`battle-spec.md`](battle-spec.md) (the terse canonical spec) and reflects what
the code actually does today.

## The two engines

There are two battle systems, both authoritative on the Go server. They serve
different screens and model the game at different depths.

| | One-card duel (`/play`) | Team battle (`/battle`) |
| --- | --- | --- |
| Package | `services/api/internal/battle` | `services/api/internal/livebattle` |
| Team size | 1 card | 1–3 creatures with switching |
| Turn model | Simultaneous hidden choice, damage applied together | Simultaneous hidden choice, resolved in speed order |
| Actions | 2 attacks + an energy economy | PP-limited moves + switches |
| Opponent | A second human (room code) | A second human (matchmaking), or the server AI |
| Data | Fictional cards in `cards.json` | Creatures built from PokéAPI |

Both are server-authoritative: the Go server owns every HP, energy, PP, faint
and winner value, and the web client only displays what the server reports. A
match locks its rules when it starts, so a later balance change cannot alter a
match in progress.

### The unified turn model

Both engines now share the same core rule from the PRD (requirement B-03):
**each player chooses secretly, and the turn resolves only once both have
chosen.** Neither player ever sees the other's choice before it plays out. They
differ only in how a resolved turn is applied:

- The one-card duel applies both attacks **at once** against the pre-turn HP, so
  both cards can be knocked out together (a draw).
- The team battle applies actions **in order**: switches first, then moves by
  speed. The faster creature can knock out the slower one before it acts.

The team battle is the canonical, full-featured ruleset. The one-card duel
remains as the minimal energy-economy demo on `/play`.

---

## Shared rules

### Type effectiveness

An 18-type chart is the single source of effectiveness. The server defines it in
`battle/types.go` (`TypeMultiplier`), and the client mirrors it in
`lib/battle/typeChart.ts` so the display and the engine agree.

- An attack is **super effective** (×2), **neutral** (×1), **not very
  effective** (×0.5) or **has no effect** (×0, immune) against a defender type.
- Against a dual-typed defender the multipliers **stack**: e.g. an Ice move hits
  a Grass/Flying target for ×4; a Fire move hits a Fire/Water target for ×0.25.
- `EffectivenessLabel` turns the multiplier into the words shown in the log
  (`super`, `resisted`, `immune`, `normal`), identically on both sides.

### Same-type attack bonus (STAB)

If a creature or card uses an attack whose element matches one of its own types,
the damage is multiplied by **1.5**.

---

## One-card duel (`/play`)

Rules version **1.0.0**. Full spec in [`battle-spec.md`](battle-spec.md).

### Setup

Each player brings one card. A card has a max HP, an element, and two attacks: a
**quick** attack (costs 0 energy, grants +1) and a **heavy** attack (costs 2
energy, grants 0). The three sample cards form a Fire → Grass → Water → Fire
triangle.

### A turn

1. Both players submit one attack. A submission is hidden: the opponent only
   sees that a choice was locked in, never which.
2. When both are in, the server resolves them **simultaneously**: it computes
   both attacks' damage against the pre-turn HP and applies them together.
3. Energy updates by `gain − cost`. HP drops by the incoming damage, clamped at 0.

### Damage

```
damage = round(power × STAB × effectiveness)
```

Quick attacks are element **Normal** (no STAB, neutral vs the sample types), so
they are safe chip damage that builds energy. Heavy attacks carry the card's
element, so they earn STAB and swing with effectiveness. A non-immune hit always
deals at least 1.

**Worked example.** Emberfox (Fire) uses Flare Burst (Fire, power 45) against
Mossling (Grass). STAB ×1.5 and Fire-vs-Grass ×2 give `45 × 1.5 × 2 = 135`
damage — enough to KO a 120-HP card in one blow.

### Ending, deadline and API

- One card at 0 HP → the other player wins; both at 0 HP on the same turn → a
  **draw**.
- Each turn has a 60-second deadline; when it passes the server auto-plays the
  player's quick attack (flagged in the log). The `/play` page's polling drives it.
- `POST /api/matches`, `POST /api/matches/{id}/join`, `GET /api/matches/{id}`,
  `POST /api/matches/{id}/attacks`.

---

## Team battle (`/battle`)

Served by `services/api/internal/livebattle`. The client side is
`lib/battle/ServerBattleStream.ts`, which reads the shared log through
`battleFeed.ts` and replays it with `eventPacer.ts`.

### Creatures and teams

The client turns each chosen card into a `Creature` from PokéAPI data
(`lib/battle/roster.ts` → `createCreature`): HP and stats (atk/def/spa/spd) are
scaled to the creature's level, and each move starts at full PP. A team is 1
creature (Champion 1v1) or 3 (Squad of 3, padded with shared rentals). Each
player sends **their own** team to the server; in a single-player battle the
client also sends the bot's team.

### Moves

A move has a type, a category (**physical** uses atk/def, **special** uses
spa/spd), a power, an accuracy, and PP. Using a move spends 1 PP. A move can
**miss**: it lands only if `random(0,100) < accuracy`. A move with no PP left
can't be chosen while another move still has PP; once **every** move is spent the
creature may keep using them, a stand-in for the games' "Struggle" so a battle
can never get stuck.

### Damage

```
base   = (((2 × level) / 5 + 2) × power × (atk / def)) / 50 + 2
damage = round(base × STAB × effectiveness × crit × spread × 0.55)
```

- **crit**: 6% chance, ×1.5 when it happens.
- **spread**: a random 0.85–1.00 roll, so identical hits vary slightly.
- **0.55**: a balance scale that keeps the games' formula from ending matches in
  one hit, so a duel lasts a satisfying handful of turns.
- An **immune** matchup deals exactly 0; any other landed hit deals at least 1.

The formula lives once per language: `livebattle/resolve.go` (`computeDamage`)
and `lib/battle/rules.ts` (`computeDamage`, used by the offline simulator).

### A turn

1. **Both players choose in secret** — a move, or a switch to a healthy bench
   creature. Locking in shows "Waiting for opponent…" on your own screen only;
   nothing about the choice reaches the other player. You can cancel during a
   brief window before the choice is sent.
2. Once both choices are in, the server resolves the turn:
   - **Switches first.** A switch spends that side's turn.
   - **Then moves, by speed** (`speed + level/10 + random jitter`); the faster
     creature acts first, and ties break randomly.
   - Each move: accuracy check → damage → possible faint. A creature that
     fainted earlier in the same turn cannot act.
3. **Fainted creatures are replaced.** The AI swaps in its next creature
   automatically. A human must choose a replacement: the server asks only that
   player (a "switching" request naming their side) while the other waits. Then
   the next turn opens for both.
4. When a whole team has fainted, the battle ends. In speed order, the first
   side to be wiped out loses before the other can act, so draws effectively
   cannot happen here.

### The AI opponent

In a single-player battle the server plays side p2. It chooses **at the same
moment as the human**, against the creature the human currently has out, so it
cannot react to a switch. It scores each usable move by
`power × effectiveness × random(0.7–1.3)`, favouring strong, super-effective
moves without being perfectly predictable.

### Two-player matches

1. **Matchmaking** (`POST /api/queue`). Players are paired only with someone in
   the **same format, card power tier and entry amount** (PRD: compare format and
   power tier first, never pair different stakes); the longest-waiting
   compatible player is chosen. If no rival appears within **20 seconds**, the
   client withdraws from the queue and battles the AI instead. It checks once
   more after withdrawing, so a rival who matched at the last moment is never
   left stranded. Searches expire after 2 minutes.
2. **Each side gets its own token.** Pairing creates the battle and returns a
   token for p1 and another for p2. A token can only act for its own side.
3. **Teams.** Each player sends their own creatures (`POST …/team`). The battle
   opens once both are in; if the opponent hasn't arrived after 30 seconds, the
   waiting player is told to find another match.
4. **One shared log.** The battle records every event in an append-only log.
   Both clients poll it (`GET …/events?since=N`, every 0.6 s) and render the
   same events, so both screens show the identical battle; each client just
   presents it from its own side.
5. **Turn timer.** Online matches always run the 150-second turn clock, and the
   server enforces it: once the deadline passes, the next poll auto-plays the
   stalling side (its first move with PP left, or its first healthy creature for
   a forced switch) and notes it in chat. A player can't stall the other forever.
6. **Refresh to rejoin.** Reloading the page reuses the saved ticket and token,
   reads the log from the start, applies the history instantly and animates only
   the current turn.
7. **Rematch** is allowed once the battle is over, so neither player can reset a
   match in progress.

### Determinism

Each battle runs from a per-match seed (`Config.Seed`). Given the same seed and
the same sequence of choices, the battle replays identically — useful for tests
and audits. Chat uses a separate random source, so chatting never changes the
dice rolls. Unseeded battles (including all online matches) get a fresh seed.

### Timer and chat

Against the AI, the 150-second timer is optional and off by default; when on,
the server enforces it the same way as online. The client only counts the clock
down for display. Chat is cosmetic banter; the AI occasionally replies.

### HTTP API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/battles` | Single player: send `{you, opponent, teams, format, seed}` → `{id, token, side}` |
| `POST /api/queue` | Two players: join matchmaking → matched `{id, token, side, opponent}` or `{ticket}` |
| `GET /api/queue/{ticket}` · `DELETE /api/queue/{ticket}` | Poll or withdraw a search |
| `POST /api/battles/{id}/team` | Two players: submit your team |
| `GET /api/battles/{id}/events?since=N` | Read the shared log from cursor N (also enforces deadlines) |
| `POST /api/battles/{id}/choice` | Submit your side's hidden move or switch |
| `POST /api/battles/{id}/timer\|chat\|rematch` | Toggle the timer, chat, or restart after the end |

All battle endpoints after creation require `Authorization: Bearer <token>`.

### Offline fallback

If the Go API can't be reached, a single-player battle runs on the client-side
`MockBattleStream` instead (same rules via `rules.ts`), so `/battle` still works
without the server. `NEXT_PUBLIC_LIVE_BATTLE=0` forces offline mode for
matchmaking and battles.

---

## What is not modeled yet

To keep the implemented mechanics honest about their scope, the engines do **not**
include: status conditions (sleep/poison/burn/etc.), abilities, held items,
weather/terrain, stat-stage changes, or multi-hit and priority moves.
Matchmaking does not yet use rating bands, and there are no spectators.
Battles live **in server memory**: a server restart ends them (PRD R-01
persistence is still open). Wallet login, NFT ownership/eligibility and staking
live in other services and branches and do not change these rules.

## Code map

| Concern | File |
| --- | --- |
| One-card engine | `services/api/internal/battle/{match,catalog,types}.go` |
| Team engine — setup, lifecycle, event log | `services/api/internal/livebattle/engine.go` |
| Team engine — hidden choices, forced switches, timeouts | `services/api/internal/livebattle/choices.go` |
| Team engine — turn resolution, damage, AI | `services/api/internal/livebattle/resolve.go` |
| Team engine — event shapes | `services/api/internal/livebattle/events.go` |
| Battle HTTP endpoints | `services/api/internal/server/live.go` |
| Two-player matchmaking queue | `services/api/internal/server/matchmaking.go` |
| Shared type chart / rich rules (client) | `apps/web/lib/battle/typeChart.ts`, `rules.ts` |
| Battle transport | `apps/web/lib/battle/ServerBattleStream.ts`, `battleFeed.ts`, `eventPacer.ts`, `battleApi.ts` |
| Matchmaking client | `apps/web/lib/match/ServerMatchmakingService.ts` (falls back to `MockMatchmakingService`) |
| Offline simulator | `apps/web/lib/battle/MockBattleStream.ts` |
| Reducer + UI hook | `apps/web/lib/battle/BattleEngine.ts` |
