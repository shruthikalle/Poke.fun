import type { CreatureSprites, ElementType, Move, MoveCategory } from "../battle/types";
import { ELEMENT_TYPES } from "../battle/roster";
import { cached } from "./cache";

export interface BaseStats { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }

export interface SpeciesData {
  /** PokéAPI species key, e.g. "pikachu". */
  key: string;
  dex: number;
  name: string;
  types: ElementType[];
  base: BaseStats;
  /** Four battle moves picked from the level-up movepool. */
  moves: Omit<Move, "pp">[];
  sprites: CreatureSprites;
  /** Large official artwork, used while the creature leaves its card. */
  artwork: string | null;
  /** Cry audio clip (ogg). */
  cry: string | null;
}

export interface SpeciesService {
  getSpecies(key: string): Promise<SpeciesData>;
}

const API = "https://pokeapi.co/api/v2";
const CACHE_VERSION = "v3";

interface RawPokemon {
  id: number;
  name: string;
  is_default: boolean;
  species: { name: string };
  types: { slot: number; type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
  moves: { move: { name: string }; version_group_details: { level_learned_at: number; move_learn_method: { name: string } }[] }[];
  sprites: {
    front_default: string | null;
    back_default: string | null;
    other?: { showdown?: { front_default: string | null; back_default: string | null }; "official-artwork"?: { front_default: string | null } };
  };
  cries?: { latest: string | null; legacy: string | null };
}

interface RawSpecies {
  names: { name: string; language: { name: string } }[];
  varieties: { is_default: boolean; pokemon: { name: string } }[];
}

const FORM_LABEL: [RegExp, (n: string) => string][] = [
  [/-alola$/, (n) => `Alolan ${n}`], [/-galar$/, (n) => `Galarian ${n}`], [/-hisui$/, (n) => `Hisuian ${n}`], [/-paldea/, (n) => `Paldean ${n}`],
  [/-gmax$/, (n) => `Gigantamax ${n}`], [/-mega-x$/, (n) => `Mega ${n} X`], [/-mega-y$/, (n) => `Mega ${n} Y`], [/-mega$/, (n) => `Mega ${n}`],
];

/** English species name ("Mr. Mime", "Farfetch’d", "Nidoran♀") plus a form label. */
function displayName(key: string, species: RawSpecies | null) {
  const base = species?.names.find((n) => n.language.name === "en")?.name ?? titleCase(key.split("-")[0]);
  const form = FORM_LABEL.find(([re]) => re.test(key));
  return form ? form[1](base) : base;
}

interface RawMove {
  name: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  type: { name: string };
  damage_class: { name: string };
  names: { name: string; language: { name: string } }[];
}

const titleCase = (s: string) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function toType(name: string): ElementType | null {
  const t = titleCase(name) as ElementType;
  return ELEMENT_TYPES.includes(t) ? t : null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`PokéAPI ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

const FALLBACK_MOVES: Omit<Move, "pp">[] = [
  { id: "tackle", name: "Tackle", type: "Normal", category: "physical", power: 40, accuracy: 100, maxPp: 35 },
  { id: "quick-attack", name: "Quick Attack", type: "Normal", category: "physical", power: 40, accuracy: 100, maxPp: 30 },
  { id: "body-slam", name: "Body Slam", type: "Normal", category: "physical", power: 85, accuracy: 100, maxPp: 15 },
  { id: "headbutt", name: "Headbutt", type: "Normal", category: "physical", power: 70, accuracy: 100, maxPp: 15 },
];

function getMove(name: string): Promise<Omit<Move, "pp"> | null> {
  return cached(`pokeapi:${CACHE_VERSION}:move:${name}`, async () => {
    const m = await getJson<RawMove>(`/move/${name}`);
    const type = toType(m.type.name);
    if (!m.power || !type || (m.damage_class.name !== "physical" && m.damage_class.name !== "special")) return null;
    return {
      id: m.name,
      name: m.names.find((n) => n.language.name === "en")?.name ?? titleCase(m.name),
      type,
      category: m.damage_class.name as MoveCategory,
      power: m.power,
      accuracy: m.accuracy ?? 100,
      maxPp: m.pp ?? 10,
    };
  });
}

/** Two best same-type moves, then the strongest moves of other types for coverage. */
function pickMoves(candidates: Omit<Move, "pp">[], types: ElementType[]) {
  const score = (m: Omit<Move, "pp">) => m.power * (m.accuracy / 100) * (types.includes(m.type) ? 1.5 : 1);
  const sorted = [...candidates].sort((a, b) => score(b) - score(a));
  const picked: Omit<Move, "pp">[] = [];
  for (const m of sorted) if (picked.length < 2 && types.includes(m.type)) picked.push(m);
  for (const m of sorted) if (picked.length < 4 && !picked.includes(m) && !picked.some((p) => p.type === m.type)) picked.push(m);
  for (const m of sorted) if (picked.length < 4 && !picked.includes(m)) picked.push(m);
  for (const m of FALLBACK_MOVES) if (picked.length < 4 && !picked.some((p) => p.id === m.id)) picked.push(m);
  return picked;
}

export class PokeApiSpeciesService implements SpeciesService {
  getSpecies(key: string): Promise<SpeciesData> {
    return cached(`pokeapi:${CACHE_VERSION}:species:${key}`, async () => {
      const p = await getJson<RawPokemon>(`/pokemon/${key}`);
      const species = await getJson<RawSpecies>(`/pokemon-species/${p.species.name}`).catch(() => null);
      const defaultName = species?.varieties.find((v) => v.is_default)?.pokemon.name;
      const base = !p.is_default && defaultName && defaultName !== key ? await getJson<RawPokemon>(`/pokemon/${defaultName}`).catch(() => null) : null;
      const types = p.types.sort((a, b) => a.slot - b.slot).map((t) => toType(t.type.name)).filter((t): t is ElementType => !!t);
      const stat = (n: string) => p.stats.find((s) => s.stat.name === n)?.base_stat ?? 70;
      const levelUpOf = (src: RawPokemon) => src.moves
        .map((m) => ({ name: m.move.name, level: Math.max(-1, ...m.version_group_details.filter((v) => v.move_learn_method.name === "level-up").map((v) => v.level_learned_at)) }))
        .filter((m) => m.level >= 0)
        .sort((a, b) => b.level - a.level)
        .slice(0, 16);
      // Forms such as Gigantamax have no movepool of their own: borrow the default form's.
      let levelUp = levelUpOf(p);
      if (levelUp.length < 4 && base) levelUp = levelUpOf(base);
      const moves = (await Promise.all(levelUp.map((m) => getMove(m.name).catch(() => null)))).filter((m): m is Omit<Move, "pp"> => !!m);
      const artwork = p.sprites.other?.["official-artwork"]?.front_default ?? base?.sprites.other?.["official-artwork"]?.front_default ?? null;
      const front = p.sprites.front_default ?? base?.sprites.front_default ?? artwork ?? "";
      const back = p.sprites.back_default ?? base?.sprites.back_default ?? front;
      return {
        key,
        dex: p.id,
        name: displayName(key, species),
        types: types.length ? types : ["Normal"],
        base: { hp: stat("hp"), atk: stat("attack"), def: stat("defense"), spa: stat("special-attack"), spd: stat("special-defense"), spe: stat("speed") },
        moves: pickMoves(moves, types),
        sprites: {
          front: p.sprites.other?.showdown?.front_default ?? front,
          back: p.sprites.other?.showdown?.back_default ?? back,
          frontStatic: front,
          backStatic: back,
        },
        artwork,
        cry: p.cries?.latest ?? p.cries?.legacy ?? base?.cries?.latest ?? null,
      };
    });
  }
}

export const speciesService: SpeciesService = new PokeApiSpeciesService();
