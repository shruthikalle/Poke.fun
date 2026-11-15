# Game mechanics

This document explains, in detail, the battle mechanics implemented in this
repo: the three battle modes, their rules and formulas, how a turn flows, how two
players are matched and kept in sync, where the Pokémon data comes from, and how
the authoritative server and the web client divide responsibility. It is the companion to
[`battle-spec.md`](battle-spec.md) (the terse canonical spec) and reflects what
the code actually does today.

## The battle modes

There are three battle systems, all authoritative on the Go server. They serve
different screens and model the game at different depths. The live arena is the
main mode: Find match on `/loadout` leads there.

| | Live arena (`/battle/live`) | Team battle (`/battle`) | One-card duel (`/play`) |
| --- | --- | --- | --- |
| Package | `services/api/internal/arena` | `services/api/internal/livebattle` | `services/api/internal/battle` |
| Team size | 1 fighter | 1–3 creatures with switching | 1 card |
| Turn model | Real time, 20 ticks per second | Simultaneous hidden choice, resolved in speed order | Simultaneous hidden choice, damage applied together |
| Actions | Move, aim, dodge, a basic and a special | PP-limited moves + switches | 2 attacks + an energy economy |
| Opponent | A second human (matchmaking) | A second human (matchmaking), or the server AI | A second human (room code) |
| Data | Every species in the Pokédex dataset | Creatures built from PokéAPI in the browser | Fictional cards in `cards.json` |

All three are server-authoritative: the Go server owns every HP, energy, PP, faint
and winner value, and the web client only displays what the server reports.
Each match locks its cards or teams when it starts, and the one-card duel also
records its rules version, so a later change cannot alter a match in progress.

### The unified turn model

The two turn-based engines share the same core rule from the PRD (requirement B-03):
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
moves without being perfectly predictable. The AI always replaces a fainted
creature with its next healthy one.

Leaving a battle against the AI and coming back starts a new battle; only
two-player matches can be rejoined.

### Two-player matches

1. **Matchmaking** (`POST /api/queue`). Players are paired only with someone in
   the **same format, card power tier and entry amount** (PRD: compare format and
   power tier first, never pair different stakes); the longest-waiting
   compatible player is chosen. If no rival appears within **90 seconds**, the
   client withdraws from the queue and reports that no player was found. It checks once
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

`NEXT_PUBLIC_LIVE_BATTLE=0` explicitly selects the client-side
`MockBattleStream` for offline demo matches. Without the Go API, normal
matchmaking reports an error.

---

## Pokédex data

The server keeps its own Pokémon database, so no battle depends on what a
browser sends or on PokéAPI being up mid-match.

- **What's in it.** **Every Pokémon**: all 1,025 species' default forms, plus
  the 189 alternate forms printed on cards (Alolan, Galarian, Hisuian and
  Paldean forms, Mega, Gigantamax and Primal). Cosmetic and event forms (Pikachu
  in a cap, Totem Pokémon) are left out. Each has its name, National Dex number,
  base species, types, base stats, sprite, power tier, and **every damaging move
  it can learn**. Level-up moves come with the level they're learned at; TM, tutor and
  egg moves are listed separately. Each move (type, physical/special, power,
  accuracy, PP) is stored once in a shared move table. The catalog's card →
  species mapping (set aliases and card numbers) is included too.
- **Power tier.** 3 for legendary or mythical Pokémon, Mega and Gigantamax forms,
  and fully evolved (stage 2) species; 2 for a first evolution; 1 for a basic
  Pokémon. Baby Pokémon don't count as a stage, as in the card game, so Pikachu,
  Mr. Mime and Hitmonchan are tier 1. These match the tiers in the devnet test
  card log.
- **Where it lives.** `services/api/internal/pokedex/pokedex.json`, built into
  the Go binary and read through the `pokedex` package. It's versioned with the
  card catalog, so every server runs the same reviewed data (PRD N-02).
- **Updating it.** Run `node scripts/build-pokedex.mjs` from the repo root and
  commit the new `pokedex.json` and `apps/web/lib/cards/species.generated.json`
  (the browser's name index). Re-run it when PokéAPI adds Pokémon, or after
  `npm run catalog` changes the card catalog. Responses are cached in `scripts/.cache/pokeapi/`
  (`--refresh` downloads again). Seven species (Ditto, Smeargle, Wobbuffet,
  Wynaut, Pyukumuku, Cosmog and Cosmoem) learn no damaging move; the battle
  engines give them standard Normal-type moves.

### Which Pokémon a card is

Any Pokémon card can battle, not only the five sets in the card catalog.

1. **Catalog cards** are matched by set and number (Base Set #58 → Pikachu),
   which also gives the exact form and the card's own power tier.
2. **Any other card** is matched by its **printed name**, on both the loadout
   (`lib/cards/cardNames.ts`) and the server (`pokedex.SpeciesForCardName`),
   which follow the same rules:
   - Parentheticals, "with …" clauses and an owner are dropped: "Pikachu with
     Grey Felt Hat" and "Team Rocket's Mewtwo ex" name Pikachu and Mewtwo.
   - The Pokémon is the longest run of up to four words that is a species' name,
     so surrounding words don't matter: "Dark Charizard", "Radiant Charizard",
     "Infernape LV.X", "Garchomp C", "Tapu Koko GX", "Mr. Mime", "Type: Null".
     Accents and ♀/♂ are handled ("Flabebe", "Nidoran ♀").
   - Form markers pick the variant when the species has it: "Galarian
     Rapidash V" → Galarian Rapidash, "M Charizard EX" or "Mega Charizard X ex"
     → Mega Charizard X, "Primal Groudon EX" → Primal Groudon, "Charizard VMAX"
     → Gigantamax Charizard. Between twin forms the card's other words decide:
     "Single Strike Urshifu VMAX".
   - A plain name means the default form ("Deoxys" → `deoxys-normal`). A name
     shared by two species is never guessed: "Nidoran" alone isn't matched.
   - Cards that name no Pokémon (Trainer, Energy) can't battle.

   The 45 shared cases in `services/api/internal/pokedex/testdata/card_names.json`
   are checked against the Go resolver, and both resolvers agree on all of them.

## Live arena (`/battle/live`)

A real-time 1v1 on a 960 × 540 field, served by `services/api/internal/arena`.
The server steps the match 20 times a second and broadcasts snapshots over
WebSocket. Each player moves, aims, dodges (a short dash with brief
invulnerability) and attacks. Basic attacks that land build energy (up to 3); a
special costs 2 energy, winds up for 0.4 s with a visible telegraph so it can be
dodged, then fires. Knock the opponent out within 90 seconds; at the buzzer the
higher HP percentage wins.

### Fighters

**Every Pokémon in the Pokédex is a fighter** (1,214 with forms). Its numbers are derived from its
PokéAPI data by fixed rules, calibrated so the original hand-tuned Pikachu and
Charmander keep the same feel (Thunderbolt still hits Charmander for 26).

| | Rule | Pikachu |
| --- | --- | --- |
| Max HP | Level-50 HP from base HP, as in the games | 110 |
| Movement | 160 + base Speed, clamped to 170–300 units/s | 250 |
| Basic cooldown | 700 − 2.8 × base Speed ms, rounded to 50, clamped to 400–700 | 450 ms |
| Special cooldown | 6300 − 20 × base Speed ms, rounded to 100, clamped to 3.5–6 s | 4.5 s |
| Basic range | 140 for everyone | 140 |
| Special range | 225 for a radius burst, 205 for a cone (±26°) | 225 (radius) |

**Picking the two moves.** A species "leans" physical or special when its Attack
or Special Attack is at least 20% higher than the other; otherwise it has no
lean. Level-up moves are considered first, then TM, tutor and egg moves.

- **Basic:** the weakest 100%-accurate move of 35–60 power, in the species' lean
  (physical when there is none), learned as early as possible. Pikachu → Quick
  Attack, Charmander → Scratch, Abra → Confusion.
- **Special:** the strongest move by power × accuracy, in this order of
  preference: a same-type move of at least 60 power in the species' lean (special
  when there is none), any same-type move, any move in that category, any move.
  Pikachu → Thunderbolt, Charmander → Flamethrower, Geodude → Earthquake.
- Moves whose effect the arena can't honour are never picked: ones that make the
  user faint (Explosion, Self-Destruct), ones that need sleep or the first turn
  (Dream Eater, Snore, Fake Out), and delayed hits (Future Sight).
- **Shape:** Fire, Water, Ice, Grass, Poison, Dragon and Flying specials spray a
  **cone** ahead of the attacker. Every other type bursts in a **radius** around
  it.

### Damage

Each hit uses the games' level-50 damage formula, without random rolls or crits
so the real-time match stays deterministic:

```
damage = round(((22 × power × Atk / Def) / 50 + 2) × STAB × effectiveness × 0.42)
```

- Physical moves use the attacker's Attack against the target's Defense; special
  moves use Special Attack against Special Defense. Power is capped at 120 so no
  special one-shots.
- **Specials** get the 1.5× same-type bonus and the full type chart. An immune
  target takes 0: Pikachu's Thunderbolt does nothing to Onix, and hits a
  Water/Flying Gyarados for ×4.
- **Basics are typeless 40-power jabs:** no bonus and no type matchups. That
  keeps them as reliable chip damage that builds energy. Otherwise a Normal-type
  basic could never touch a Ghost, and its user could never earn a special.
- Any landed, non-immune hit deals at least 1. The damage shown on a move button
  ("≈26 dmg") is against an average target; real hits depend on the opponent.

Within each tier, knocking out an average opponent with basics alone takes about
7–8 seconds (median), so tiers are similarly paced. A test keeps every tier's
median between 5 and 10 seconds.

### Matchmaking and cards

- Find match on `/loadout` queues the selected card's fighter
  (`POST /api/arena-queue`). Players are paired only with the **same entry and
  the same power tier**, then by the closest rating, so a Mewtwo never faces a
  Magikarp. Abandoned searches expire after 20 seconds without a heartbeat.
- **Guests** borrow tier-1 fighters (Pikachu, Charmander and the shared rental
  pool), so any two guests can be paired.
- **Devnet NFTs.** When a player queues with a Solana devnet card, the server
  reads the NFT and checks it is the selected fighter, identifying the card as
  in [Which Pokémon a card is](#which-pokémon-a-card-is): by set and number for
  catalog cards, by printed name otherwise ("Dark Charizard" from Team Rocket →
  Charizard). An NFT that isn't the selected fighter is refused.
- `GET /api/arena-cards` lists every fighter (1,214, gzipped to about 67 KB);
  `?ids=pikachu,charizard` returns just those, which is what the loadout uses.
  `/arena` lets anyone pick any fighter (searchable) and enter the same queue.

---

## What is not modeled yet

To keep the implemented mechanics honest about their scope, the engines do **not**
include: status conditions (sleep/poison/burn/etc.), abilities, held items,
weather/terrain, stat-stage changes, or multi-hit and priority moves.
Matchmaking does not yet use rating bands or share player records (a real
opponent shows as 0–0), and there are no spectators.
Battles live **in server memory**: a server restart ends them (PRD R-01
persistence is still open). Wallet login, NFT ownership/eligibility and staking
live in other services and branches and do not change these rules.

## Code map

| Concern | File |
| --- | --- |
| Pokédex dataset (PokéAPI import) | `scripts/build-pokedex.mjs` → `services/api/internal/pokedex/pokedex.json` and `apps/web/lib/cards/species.generated.json` |
| Pokédex lookups, card → species by set/number or name | `services/api/internal/pokedex/{pokedex,cards}.go` |
| Card → species in the browser | `apps/web/lib/cards/mapping.ts` (catalog), `cardNames.ts` (any other card) |
| Live arena — fighters from the Pokédex, damage | `services/api/internal/arena/fighters.go` |
| Live arena — real-time simulation | `services/api/internal/arena/arena.go` |
| Live arena HTTP, WebSocket and queue | `services/api/internal/server/{arena,queue}.go` |
| Live arena UI | `apps/web/app/arena/page.tsx` (also `/battle/live`), `apps/web/lib/arena.ts` |
| One-card engine | `services/api/internal/battle/{match,catalog,types}.go` |
| Team engine — setup, lifecycle, event log | `services/api/internal/livebattle/engine.go` |
| Team engine — hidden choices, forced switches, timeouts | `services/api/internal/livebattle/choices.go` |
| Team engine — turn resolution, damage, AI | `services/api/internal/livebattle/resolve.go` |
| Team engine — event shapes | `services/api/internal/livebattle/events.go` |
| Battle HTTP endpoints | `services/api/internal/server/live.go` |
| Two-player matchmaking queue | `services/api/internal/server/matchmaking.go` |
| Shared type chart / rich rules (client) | `apps/web/lib/battle/typeChart.ts`, `rules.ts` |
| Battle transport | `apps/web/lib/battle/ServerBattleStream.ts`, `battleFeed.ts`, `eventPacer.ts`, `battleApi.ts` |
| Matchmaking client | `apps/web/lib/match/ServerMatchmakingService.ts` (`MockMatchmakingService` only in offline mode) |
| Offline simulator | `apps/web/lib/battle/MockBattleStream.ts` |
| Reducer + UI hook | `apps/web/lib/battle/BattleEngine.ts` |
