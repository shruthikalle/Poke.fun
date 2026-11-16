import { effectivenessLabel, typeMultiplier } from "./typeChart";
import type { Creature, Effectiveness, Move } from "./types";

// Pure rich-battle rules, shared by the offline MockBattleStream and mirroring
// the authoritative Go engine (services/api/internal/livebattle/resolve.go) and
// docs/game-mechanics.md. Keeping the math here means the formula lives in one
// place and can be reasoned about without the stream's async scheduling.

/** Injectable randomness so results can be made deterministic in tests. */
export type Rng = () => number;

export interface DamageResult {
  damage: number;
  effectiveness: Effectiveness;
  crit: boolean;
}

const CRIT_CHANCE = 0.06;
const CRIT_MULT = 1.5;
const STAB_MULT = 1.5;
// Scales damage below the games' numbers so one- to three-card matches last a
// satisfying handful of turns rather than ending in a single hit.
const BALANCE_SCALE = 0.55;

/**
 * Damage for one landed move, applying type effectiveness, same-type attack
 * bonus (STAB), a 6% crit and a small random spread. An immune matchup deals 0;
 * any other landed hit deals at least 1.
 */
export function computeDamage(attacker: Creature, defender: Creature, move: Move, rng: Rng = Math.random): DamageResult {
  const mult = move.id === "struggle" ? 1 : typeMultiplier(move.type, defender.types);
  if (mult === 0) return { damage: 0, effectiveness: "immune", crit: false };

  const stab = move.id !== "struggle" && attacker.types.includes(move.type) ? STAB_MULT : 1;
  const crit = rng() < CRIT_CHANCE;
  const [atk, def] = move.category === "physical"
    ? [attacker.stats.atk, defender.stats.def]
    : [attacker.stats.spa, defender.stats.spd];
  const base = (((2 * attacker.level) / 5 + 2) * move.power * (atk / def)) / 50 + 2;
  const spread = 0.85 + rng() * 0.15;
  const damage = Math.max(1, Math.round(base * stab * mult * (crit ? CRIT_MULT : 1) * spread * BALANCE_SCALE));
  return { damage, effectiveness: effectivenessLabel(mult), crit };
}

/**
 * The AI's move choice: score each usable move by power × effectiveness with a
 * little randomness, so it favours strong, super-effective moves without being
 * perfectly predictable. A move with no PP is a last resort.
 */
export function chooseAiMove(attacker: Creature, defender: Creature, rng: Rng = Math.random): number {
  let best = 0;
  let bestScore = -Infinity;
  attacker.moves.forEach((m, i) => {
    const score = m.pp > 0 ? m.power * (m.id === "struggle" ? 1 : typeMultiplier(m.type, defender.types)) * (0.7 + rng() * 0.6) : -1;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Turn-order speed with a fractional jitter so equal speeds break ties randomly. */
export function effectiveSpeed(creature: Creature, rng: Rng = Math.random): number {
  return creature.speed + creature.level / 10 + rng();
}
