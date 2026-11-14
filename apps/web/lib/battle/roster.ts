import type { BattleFormat, Creature, ElementType, Move, MoveCategory } from "./types";

type MoveDef = Omit<Move, "pp">;

const move = (id: string, name: string, type: ElementType, category: MoveCategory, power: number, accuracy: number, maxPp: number): MoveDef =>
  ({ id, name, type, category, power, accuracy, maxPp });

export const MOVES: Record<string, MoveDef> = Object.fromEntries([
  move("ember-dash", "Ember Dash", "Fire", "physical", 70, 100, 16),
  move("flare-burst", "Flare Burst", "Fire", "special", 95, 90, 8),
  move("tidal-slam", "Tidal Slam", "Water", "physical", 80, 100, 12),
  move("bubble-jet", "Bubble Jet", "Water", "special", 60, 100, 20),
  move("vine-lash", "Vine Lash", "Grass", "physical", 75, 100, 16),
  move("spore-bloom", "Spore Bloom", "Grass", "special", 90, 90, 10),
  move("static-snap", "Static Snap", "Electric", "special", 80, 100, 16),
  move("hex-wail", "Hex Wail", "Ghost", "special", 85, 100, 12),
  move("shadow-pounce", "Shadow Pounce", "Dark", "physical", 80, 100, 16),
  move("boulder-roll", "Boulder Roll", "Rock", "physical", 85, 90, 12),
  move("quake-stomp", "Quake Stomp", "Ground", "physical", 90, 100, 10),
  move("drill-burrow", "Drill Burrow", "Ground", "physical", 80, 95, 16),
  move("pixie-gust", "Pixie Gust", "Fairy", "special", 80, 100, 16),
  move("moon-dust", "Moon Dust", "Fairy", "special", 95, 90, 8),
  move("iron-jab", "Iron Jab", "Fighting", "physical", 75, 100, 20),
  move("haymaker", "Haymaker", "Fighting", "physical", 110, 80, 8),
  move("wyrm-breath", "Wyrm Breath", "Dragon", "special", 90, 100, 10),
  move("frost-lance", "Frost Lance", "Ice", "physical", 85, 95, 12),
  move("glacier-wall", "Glacier Crash", "Ice", "special", 100, 85, 8),
  move("mind-pulse", "Mind Pulse", "Psychic", "special", 85, 100, 12),
  move("gale-wing", "Gale Wing", "Flying", "physical", 75, 100, 16),
  move("quick-tackle", "Quick Tackle", "Normal", "physical", 50, 100, 30),
  move("body-slam", "Body Slam", "Normal", "physical", 85, 100, 16),
].map((m) => [m.id, m]));

export interface SpeciesDef {
  id: string;
  name: string;
  types: ElementType[];
  base: { hp: number; atk: number; def: number; spe: number };
  moves: [string, string, string, string];
}

export const SPECIES: SpeciesDef[] = [
  { id: "emberfox", name: "Emberfox", types: ["Fire"], base: { hp: 70, atk: 90, def: 65, spe: 105 }, moves: ["ember-dash", "flare-burst", "shadow-pounce", "quick-tackle"] },
  { id: "tidecub", name: "Tidecub", types: ["Water"], base: { hp: 95, atk: 80, def: 85, spe: 60 }, moves: ["tidal-slam", "bubble-jet", "body-slam", "frost-lance"] },
  { id: "mossling", name: "Mossling", types: ["Grass", "Ground"], base: { hp: 105, atk: 75, def: 100, spe: 40 }, moves: ["vine-lash", "spore-bloom", "quake-stomp", "body-slam"] },
  { id: "wispurr", name: "Wispurr", types: ["Ghost"], base: { hp: 65, atk: 70, def: 60, spe: 110 }, moves: ["hex-wail", "shadow-pounce", "mind-pulse", "pixie-gust"] },
  { id: "bouldillo", name: "Bouldillo", types: ["Rock", "Ground"], base: { hp: 90, atk: 95, def: 120, spe: 35 }, moves: ["boulder-roll", "quake-stomp", "iron-jab", "body-slam"] },
  { id: "lumoth", name: "Lumoth", types: ["Fairy", "Flying"], base: { hp: 75, atk: 60, def: 70, spe: 95 }, moves: ["pixie-gust", "moon-dust", "gale-wing", "mind-pulse"] },
  { id: "brawlaroo", name: "Brawlaroo", types: ["Fighting"], base: { hp: 85, atk: 115, def: 75, spe: 80 }, moves: ["iron-jab", "haymaker", "shadow-pounce", "quick-tackle"] },
  { id: "draconet", name: "Draconet", types: ["Dragon", "Flying"], base: { hp: 80, atk: 95, def: 80, spe: 85 }, moves: ["wyrm-breath", "gale-wing", "flare-burst", "static-snap"] },
  { id: "frostguard", name: "Frostguard", types: ["Ice", "Water"], base: { hp: 90, atk: 85, def: 95, spe: 55 }, moves: ["frost-lance", "glacier-wall", "tidal-slam", "iron-jab"] },
  { id: "drillmole", name: "Drillmole", types: ["Ground"], base: { hp: 80, atk: 105, def: 70, spe: 75 }, moves: ["drill-burrow", "boulder-roll", "iron-jab", "quick-tackle"] },
  { id: "umbrawolf", name: "Umbrawolf", types: ["Dark", "Fire"], base: { hp: 75, atk: 100, def: 65, spe: 100 }, moves: ["shadow-pounce", "ember-dash", "iron-jab", "hex-wail"] },
  { id: "psyowl", name: "Psyowl", types: ["Psychic", "Flying"], base: { hp: 80, atk: 65, def: 75, spe: 90 }, moves: ["mind-pulse", "gale-wing", "hex-wail", "moon-dust"] },
];

export const speciesById = (id: string) => SPECIES.find((s) => s.id === id);

export const MOCK_FORMAT: BattleFormat = {
  name: "[Gen 9] Random Battle",
  rated: true,
  rules: [
    { name: "Species Clause", description: "Limit one of each creature" },
    { name: "HP Percentage Mod", description: "HP is shown in percentages" },
    { name: "Sleep Clause Mod", description: "Limit one foe put to sleep" },
    { name: "Illusion Level Mod", description: "Illusion disguises the creature's true level" },
  ],
};

export function createCreature(species: SpeciesDef, level: number, uid: string): Creature {
  const maxHp = Math.floor(((2 * species.base.hp + 31) * level) / 100) + level + 10;
  return {
    id: uid,
    species: species.name,
    spriteId: species.id,
    level,
    gender: species.id === "frostguard" || species.id === "bouldillo" ? null : Math.random() < 0.5 ? "M" : "F",
    types: species.types,
    hp: maxHp,
    maxHp,
    fainted: false,
    moves: species.moves.map((id) => ({ ...MOVES[id], pp: MOVES[id].maxPp })),
  };
}

export function randomTeam(size = 6, exclude: string[] = []): Creature[] {
  const pool = SPECIES.filter((s) => !exclude.includes(s.id));
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, size);
  return picked.map((species, i) => createCreature(species, 76 + Math.floor(Math.random() * 12), `${species.id}-${i}-${Math.random().toString(36).slice(2, 7)}`));
}

const CHART: Partial<Record<ElementType, { super: ElementType[]; resisted: ElementType[]; immune?: ElementType[] }>> = {
  Normal: { super: [], resisted: ["Rock"], immune: ["Ghost"] },
  Fire: { super: ["Grass", "Ice"], resisted: ["Fire", "Water", "Rock", "Dragon"] },
  Water: { super: ["Fire", "Ground", "Rock"], resisted: ["Water", "Grass", "Dragon"] },
  Grass: { super: ["Water", "Ground", "Rock"], resisted: ["Fire", "Grass", "Flying", "Dragon"] },
  Electric: { super: ["Water", "Flying"], resisted: ["Electric", "Grass", "Dragon"], immune: ["Ground"] },
  Ice: { super: ["Grass", "Ground", "Flying", "Dragon"], resisted: ["Fire", "Water", "Ice"] },
  Fighting: { super: ["Normal", "Ice", "Rock", "Dark"], resisted: ["Flying", "Psychic", "Fairy"], immune: ["Ghost"] },
  Ground: { super: ["Fire", "Electric", "Rock"], resisted: ["Grass"], immune: ["Flying"] },
  Flying: { super: ["Grass", "Fighting"], resisted: ["Electric", "Rock"] },
  Psychic: { super: ["Fighting"], resisted: ["Psychic"], immune: ["Dark"] },
  Rock: { super: ["Fire", "Ice", "Flying"], resisted: ["Fighting", "Ground"] },
  Ghost: { super: ["Psychic", "Ghost"], resisted: ["Dark"], immune: ["Normal"] },
  Dragon: { super: ["Dragon"], resisted: [], immune: ["Fairy"] },
  Dark: { super: ["Psychic", "Ghost"], resisted: ["Fighting", "Dark", "Fairy"] },
  Fairy: { super: ["Fighting", "Dragon", "Dark"], resisted: ["Fire"] },
};

export function typeMultiplier(attack: ElementType, defender: ElementType[]): number {
  const row = CHART[attack];
  if (!row) return 1;
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
};
