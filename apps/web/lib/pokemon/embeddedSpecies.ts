// Generated from the Go server's Pokédex by scripts/build-offline-dex.mjs.
import data from "./offlineDex.generated.json";
import { createCreature, createStruggleMove } from "../battle/roster";
import type { Creature, ElementType, Move } from "../battle/types";
import type { SpeciesData } from "./SpeciesService";
import { cryUrl } from "../audio/AudioEngine";

interface Definition {
  key: string; species: string; name: string; dex: number; types: string[]; tier: number;
  base: SpeciesData["base"]; sprite: string; learnset: string[]; otherMoves: string[];
}
interface DefinitionMove { name: string; type: string; category: string; power: number; accuracy: number; pp: number }
const definitions = data.species as Definition[];
const moves = data.moves as Record<string, DefinitionMove>;
const byKey = new Map(definitions.map((s) => [s.key, s]));
export const EMBEDDED_VERSION = data.version;
export const EMBEDDED_SPECIES = definitions;

/** Mirrors livebattle.SpeciesMoves, including stable score ties and no padding. */
export function embeddedMoves(s: Definition): Omit<Move, "pp">[] {
  let candidates = s.learnset.filter((id) => moves[id]);
  if (!candidates.length) candidates = s.otherMoves.filter((id) => moves[id]);
  const score = (id: string) => moves[id].power * moves[id].accuracy * (s.types.includes(moves[id].type) ? 1.5 : 1);
  candidates.sort((a, b) => score(b) - score(a) || (a < b ? -1 : a > b ? 1 : 0));
  const picked: string[] = [];
  const add = (id: string) => { if (picked.length < 4 && !picked.includes(id)) picked.push(id); };
  for (const id of candidates) if (picked.length < 2 && s.types.includes(moves[id].type)) add(id);
  for (const id of candidates) if (!picked.some((p) => moves[p].type === moves[id].type)) add(id);
  for (const id of candidates) add(id);
  if (!picked.length) return [createStruggleMove()];
  return picked.map((id) => {
    const m = moves[id];
    return { id, name: m.name, type: m.type as ElementType, category: m.category as Move["category"], power: m.power, accuracy: m.accuracy, maxPp: m.pp };
  });
}

/** Offline combat never fetches live PokéAPI definitions or trusts stored teams. */
export function getEmbeddedSpecies(key: string): SpeciesData {
  const s = byKey.get(key);
  if (!s) throw new Error(`Unknown embedded Pokémon: ${key}`);
  const back = s.sprite.replace("/pokemon/", "/pokemon/back/");
  return { key: s.key, dex: s.dex, name: s.name, types: [...s.types] as ElementType[], base: { ...s.base }, moves: embeddedMoves(s),
    sprites: { front: s.sprite, back, frontStatic: s.sprite, backStatic: back }, artwork: null, cry: cryUrl(s.dex) };
}

export function canonicalOfflineTeam(team: Creature[], side: string): Creature[] {
  if (team.length < 1 || team.length > 3) throw new Error("A team must contain 1 to 3 Pokémon");
  const seen = new Set<string>();
  return team.map((pick, i) => {
    const s = byKey.get(pick.spriteId || pick.species);
    if (!s) throw new Error(`Unknown embedded Pokémon: ${pick.spriteId || pick.species}`);
    if (seen.has(s.species)) throw new Error(`Species clause: duplicate ${s.name}`);
    seen.add(s.species);
    return createCreature(getEmbeddedSpecies(s.key), 50, `${side}-${i}-${s.key}`, pick.cardArt);
  });
}
