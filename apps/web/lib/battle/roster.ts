import type { BattleFormat, Creature, ElementType } from "./types";
import type { SpeciesData } from "../pokemon/SpeciesService";

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

export function makeFormat(name: string, rules: BattleFormat["rules"]): BattleFormat {
  return {
    name,
    rated: true,
    rules: [
      ...rules,
    ],
  };
}

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

export function typeMultiplier(attack: ElementType, defender: ElementType[]): number {
  const row = CHART[attack];
  return defender.reduce((mult, t) => {
    if (row.immune?.includes(t)) return 0;
    if (row.super.includes(t)) return mult * 2;
    if (row.resisted.includes(t)) return mult * 0.5;
    return mult;
  }, 1);
}

export const TYPE_COLORS: Record<ElementType, string> = {
  Normal: "#a8a77a", Fire: "#ee8130", Water: "#6390f0", Grass: "#7ac74c", Electric: "#f7d02c",
  Ice: "#96d9d6", Fighting: "#c22e28", Ground: "#e2bf65", Flying: "#a98ff3", Psychic: "#f95587",
  Rock: "#b6a136", Ghost: "#735797", Dragon: "#6f35fc", Dark: "#705746", Fairy: "#d685ad",
  Bug: "#a6b91a", Poison: "#a33ea1", Steel: "#b7b7ce",
};
