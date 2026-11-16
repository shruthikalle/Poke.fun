import type { BattleFormat, Creature, Move } from "./types";
import type { SpeciesData } from "../pokemon/SpeciesService";

// Re-exported so existing UI imports (`from ".../battle/roster"`) keep working
// while the type-chart logic lives in its own module.
export { ELEMENT_TYPES, TYPE_COLORS, typeMultiplier } from "./typeChart";

/**
 * Builds a battle-ready Creature from PokéAPI species data, scaling HP and
 * stats to the given level with the standard stat formulas. Moves start at full
 * PP.
 */
export function createCreature(species: SpeciesData, level: number, uid: string, cardArt: string | null = null): Creature {
  const maxHp = Math.floor(((2 * species.base.hp + 31) * level) / 100) + level + 10;
  const stat = (b: number) => Math.floor(((2 * b + 31) * level) / 100) + 5;
  return {
    id: uid,
    species: species.name,
    spriteId: species.key,
    sprites: species.sprites,
    cardArt,
    speed: species.base.spe,
    stats: { atk: stat(species.base.atk), def: stat(species.base.def), spa: stat(species.base.spa), spd: stat(species.base.spd) },
    level,
    gender: null,
    types: species.types,
    hp: maxHp,
    maxHp,
    fainted: false,
    moves: species.moves.map((m) => ({ ...m, pp: m.maxPp })),
  };
}

/**
 * Wraps caller-supplied rules (match, entry, ranks) with the clauses the battle
 * enforces: one of each species per team (see buildTeam) and HP shown as a
 * percentage. Explicit offline practice uses the retained damage-only engine;
 * online play receives the server's full format and effect rules.
 */
export function makeFormat(name: string, rules: BattleFormat["rules"]): BattleFormat {
  return {
    name,
    rated: true,
    rules: [
      { name: "Species Clause", description: "Limit one of each creature" },
      { name: "HP Percentage Mod", description: "HP is shown in percentages" },
      { name: "Custom damage", description: "Level 50; priority then speed orders hidden turns; 0.55 damage scale; 6% critical hits." },
      process.env.NEXT_PUBLIC_LIVE_BATTLE === "0"
        ? { name: "Offline practice", description: "Damage-only simulation. No secondary effects, status, priority or multi-hit." }
        : { name: "Move effects", description: "Supported status, stat, weather, priority and multi-hit effects. Abilities and held items are excluded." },
      { name: "Struggle", description: "Without supported moves or remaining PP: typeless 50 power with 25% max-HP recoil." },
      ...rules,
    ],
  };
}

/** Shared explicit fallback for the retained offline species provider/engine. */
export function createStruggleMove(): Move {
  return { id: "struggle", name: "Struggle", type: "Normal", category: "physical", power: 50, accuracy: 100, pp: 1, maxPp: 1 };
}
