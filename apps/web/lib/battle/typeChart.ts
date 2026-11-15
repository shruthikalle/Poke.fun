import type { ElementType, Effectiveness } from "./types";

// The 18-type effectiveness chart. It is the client's copy of the same rules the
// Go server enforces (services/api/internal/battle/types.go), so the display and
// the authoritative engine always agree on effectiveness.

type Row = { super: ElementType[]; resisted: ElementType[]; immune?: ElementType[] };

const CHART: Record<ElementType, Row> = {
  Normal: { super: [], resisted: ["Rock", "Steel"], immune: ["Ghost"] },
  Fire: { super: ["Grass", "Ice", "Bug", "Steel"], resisted: ["Fire", "Water", "Rock", "Dragon"] },
  Water: { super: ["Fire", "Ground", "Rock"], resisted: ["Water", "Grass", "Dragon"] },
  Grass: { super: ["Water", "Ground", "Rock"], resisted: ["Fire", "Grass", "Poison", "Flying", "Bug", "Dragon", "Steel"] },
  Electric: { super: ["Water", "Flying"], resisted: ["Electric", "Grass", "Dragon"], immune: ["Ground"] },
  Ice: { super: ["Grass", "Ground", "Flying", "Dragon"], resisted: ["Fire", "Water", "Ice", "Steel"] },
  Fighting: { super: ["Normal", "Ice", "Rock", "Dark", "Steel"], resisted: ["Poison", "Flying", "Psychic", "Bug", "Fairy"], immune: ["Ghost"] },
  Poison: { super: ["Grass", "Fairy"], resisted: ["Poison", "Ground", "Rock", "Ghost"], immune: ["Steel"] },
  Ground: { super: ["Fire", "Electric", "Poison", "Rock", "Steel"], resisted: ["Grass", "Bug"], immune: ["Flying"] },
  Flying: { super: ["Grass", "Fighting", "Bug"], resisted: ["Electric", "Rock", "Steel"] },
  Psychic: { super: ["Fighting", "Poison"], resisted: ["Psychic", "Steel"], immune: ["Dark"] },
  Bug: { super: ["Grass", "Psychic", "Dark"], resisted: ["Fire", "Fighting", "Poison", "Flying", "Ghost", "Steel", "Fairy"] },
  Rock: { super: ["Fire", "Ice", "Flying", "Bug"], resisted: ["Fighting", "Ground", "Steel"] },
  Ghost: { super: ["Psychic", "Ghost"], resisted: ["Dark"], immune: ["Normal"] },
  Dragon: { super: ["Dragon"], resisted: ["Steel"], immune: ["Fairy"] },
  Dark: { super: ["Psychic", "Ghost"], resisted: ["Fighting", "Dark", "Fairy"] },
  Steel: { super: ["Ice", "Rock", "Fairy"], resisted: ["Fire", "Water", "Electric", "Steel"] },
  Fairy: { super: ["Fighting", "Dragon", "Dark"], resisted: ["Fire", "Poison", "Steel"] },
};

export const ELEMENT_TYPES = Object.keys(CHART) as ElementType[];

/**
 * Effectiveness of an attack type against a (possibly dual-typed) defender.
 * Multipliers stack across the defender's types, so a doubly-weak target takes
 * 4× and a doubly-resistant one takes 0.25×. Returns 0 if any type is immune.
 */
export function typeMultiplier(attack: ElementType, defender: ElementType[]): number {
  const row = CHART[attack];
  return defender.reduce((mult, t) => {
    if (row.immune?.includes(t)) return 0;
    if (row.super.includes(t)) return mult * 2;
    if (row.resisted.includes(t)) return mult * 0.5;
    return mult;
  }, 1);
}

/** Labels a multiplier for the battle log, matching battle.EffectivenessLabel on the server. */
export function effectivenessLabel(mult: number): Effectiveness {
  if (mult === 0) return "immune";
  if (mult > 1) return "super";
  if (mult < 1) return "resisted";
  return "normal";
}

export const TYPE_COLORS: Record<ElementType, string> = {
  Normal: "#a8a77a", Fire: "#ee8130", Water: "#6390f0", Grass: "#7ac74c", Electric: "#f7d02c",
  Ice: "#96d9d6", Fighting: "#c22e28", Ground: "#e2bf65", Flying: "#a98ff3", Psychic: "#f95587",
  Rock: "#b6a136", Ghost: "#735797", Dragon: "#6f35fc", Dark: "#705746", Fairy: "#d685ad",
  Bug: "#a6b91a", Poison: "#a33ea1", Steel: "#b7b7ce",
};
