# Game mechanics

This document explains, in detail, the battle mechanics implemented in this
repo: the two battle engines, their rules and formulas, how a turn flows, and
how the authoritative server and the web client divide responsibility. It is the
companion to [`battle-spec.md`](battle-spec.md) (the terse canonical spec) and
reflects what the code actually does today.

## The two engines

There are two battle systems, each authoritative on the Go server. They serve
different screens and model the game at different depths.

| | One-card duel (`/play`) | Rich team battle (`/battle`) |
| --- | --- | --- |
| Package | `services/api/internal/battle` | `services/api/internal/livebattle` |
| Team size | 1 card | 1–3 creatures with switching |
| Turn model | Simultaneous, hidden reveal | Speed-ordered, sequential |
| Actions | 2 attacks + an energy economy | PP-limited moves + switches |
| Opponent | A second human (room code) | Server-run AI |
| Data | Fictional cards in `cards.json` | Creatures built from PokéAPI |

Both are server-authoritative: the Go server owns every HP, energy, PP, faint
and winner value. The web client only displays what the server reports. A match
locks its rules version when it starts, so a later balance change cannot alter a
match in progress.

Why two engines: the one-card duel is the PRD's canonical, staking-path ruleset
(simple, fair, fully deterministic). The rich battle is the showcase experience
built on real creature data. Unifying them onto one model is future work; for
now each is documented and tested on its own.

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

1. Both players submit one attack. A submission is hidden — the opponent only
   sees that a choice was locked in, never which (requirement B-03).
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

### Ending

- One card at 0 HP → the other player wins.
- Both at 0 HP on the same turn → a **draw** (possible here because resolution is
  simultaneous).

### Turn deadline

Each turn has a 60-second deadline (`TurnDuration`). If it passes, the server
auto-plays the player's quick attack and resolves the turn; auto-played attacks
are flagged in the log. Timeouts are evaluated whenever either client polls, so
the `/play` page's 1-second polling drives them.

### HTTP API

- `POST /api/matches` — create a room, returns an id and player token.
- `POST /api/matches/{id}/join` — join with the room code.
- `GET /api/matches/{id}` — authenticated match view (also advances timeouts).
- `POST /api/matches/{id}/attacks` — submit an attack.

---

## Rich team battle (`/battle`)

Served by `services/api/internal/livebattle`; the client transport is
`lib/battle/ServerBattleStream.ts`. The former client-only `MockBattleStream`
remains as an **offline fallback** (`NEXT_PUBLIC_LIVE_BATTLE=0`) and shares its
math with the server through `lib/battle/rules.ts`.

### Creatures and teams

The client turns each chosen card into a `Creature` from PokéAPI data
(`lib/battle/roster.ts` → `createCreature`): HP and stats (atk/def/spa/spd) are
scaled to the creature's level, and each move starts at full PP. A team is 1
creature (Champion 1v1) or 3 (Squad of 3). The client posts both teams — its own
and the matched opponent's — to the server, which runs the battle from there.

### Moves

A move has a type, a category (**physical** uses atk/def, **special** uses
spa/spd), a power, an accuracy, and PP. Using a move spends 1 PP. A move can
**miss**: it lands only if `random(0,100) < accuracy`.

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
and `lib/battle/rules.ts` (`computeDamage`).

### A turn

1. The player chooses a **move** or a **switch**. A switch spends the turn.
2. The server picks the AI opponent's move, then orders the actions by
   **speed** (`speed + level/10 + random jitter`); the faster creature acts
   first, ties broken randomly.
3. Each action resolves in order: accuracy check → damage → possible faint. A
   creature that fainted earlier in the same turn cannot act.
4. If a creature faints: the opponent's next creature is sent in automatically;
   the **player** must choose a replacement before the next turn (a forced
   switch). When a whole team has fainted, the battle ends.

### The AI opponent

`pickOpponentMove` scores each usable move by `power × effectiveness × random`,
so the AI favours strong, super-effective moves without being perfectly
predictable. A move with no PP is only chosen as a last resort.

### Determinism

Each battle runs from a per-match seed (`Config.Seed`). Given the same seed and
the same sequence of choices, the battle replays identically — useful for tests
and audits. An unseeded request gets a fresh random battle.

### Timer and chat

An optional 150-second turn timer can be toggled on; the client counts it down
and, on a choosing-phase timeout, auto-submits a move (the server validates it).
Chat is cosmetic banter; the server occasionally replies as the opponent.

### HTTP API and event flow

- `POST /api/battles` — the client sends `{you, opponent, teams, format, seed}`;
  the server returns `{id, token, events}` where `events` are the opening
  sequence.
- `POST /api/battles/{id}/choice` — send a move/switch; returns the ordered
  events for the whole resolved turn.
- `POST /api/battles/{id}/timer|chat|rematch` — toggle the timer, chat, or
  restart.

The server resolves a turn **atomically** and returns the full ordered list of
`BattleEvent`s (`init`, `move`, `damage`, `faint`, `switch`, `turn`, `request`,
`win`, …). `ServerBattleStream` replays them with animation pacing (via
`EventPacer`) so the reducer and UI are unchanged — only the authority moved to
the server. There is no long-lived connection; each turn is one request.

---

## What is not modeled yet

To keep the implemented mechanics honest about their scope, the engines do **not**
include: status conditions (sleep/poison/burn/etc.), abilities, held items,
weather/terrain, stat-stage changes, multi-hit or priority moves, or PP-out
"Struggle". The rich battle is **single-player versus a server AI**; real-time
two-player play is future work. Wallet login, NFT ownership/eligibility,
matchmaking and staking live in other services and branches and do not change
these rules.

## Code map

| Concern | File |
| --- | --- |
| One-card engine | `services/api/internal/battle/{match,catalog,types}.go` |
| Rich engine — lifecycle | `services/api/internal/livebattle/engine.go` |
| Rich engine — turn resolution, damage, AI | `services/api/internal/livebattle/resolve.go` |
| Rich engine — event shapes | `services/api/internal/livebattle/events.go` |
| HTTP endpoints | `services/api/internal/server/{server,live}.go` |
| Shared type chart (client) | `apps/web/lib/battle/typeChart.ts` |
| Shared rich rules (client) | `apps/web/lib/battle/rules.ts` |
| Live transport | `apps/web/lib/battle/ServerBattleStream.ts` + `eventPacer.ts` |
| Offline fallback | `apps/web/lib/battle/MockBattleStream.ts` |
| Reducer + UI hook | `apps/web/lib/battle/BattleEngine.ts` |
