import { apiRequest } from "../battle/battleApi";
import type { CreatureSprites, ElementType, Move } from "../battle/types";
import { cached } from "./cache";

export interface BaseStats { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }

export interface SpeciesData {
  /** PokéAPI species key, e.g. "pikachu". */
  key: string;
  dex: number;
  name: string;
  types: ElementType[];
  base: BaseStats;
  /** Up to four actual damaging moves from the versioned embedded learnset. */
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

async function getJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`PokéAPI ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** Explicit offline provider, using exactly the server's embedded definitions. */
export class EmbeddedSpeciesService implements SpeciesService {
  async getSpecies(key: string): Promise<SpeciesData> {
    const { getEmbeddedSpecies } = await import("./embeddedSpecies");
    return getEmbeddedSpecies(key);
  }
}

// Compatibility for callers of the old provider; combat is now fully offline.
export class PokeApiSpeciesService extends EmbeddedSpeciesService {}

/** Presentation metadata can fail without changing authoritative combat data. */
async function withPresentation(data: SpeciesData): Promise<SpeciesData> {
  try {
    const pokemon = await cached(`presentation:v1:${data.key}`, () => getJson<RawPokemon>(`/pokemon/${data.key}`, 2000));
    const front = pokemon.sprites.front_default ?? data.sprites.frontStatic;
    const back = pokemon.sprites.back_default ?? front;
    return {
      ...data,
      sprites: {
        front: pokemon.sprites.other?.showdown?.front_default ?? front,
        back: pokemon.sprites.other?.showdown?.back_default ?? back,
        frontStatic: front,
        backStatic: back,
      },
      artwork: pokemon.sprites.other?.["official-artwork"]?.front_default ?? data.artwork,
      cry: pokemon.cries?.latest ?? pokemon.cries?.legacy ?? data.cry,
    };
  } catch { return data; }
}

/** Uses exactly the versioned definitions with which the server builds teams. */
export class ServerSpeciesService implements SpeciesService {
  private readonly pending = new Map<string, Promise<SpeciesData>>();

  getSpecies(key: string): Promise<SpeciesData> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = apiRequest<SpeciesData>("GET", `/api/species/${encodeURIComponent(key)}`).then(withPresentation);
    this.pending.set(key, request);
    void request.finally(() => this.pending.delete(key)).catch(() => {});
    return request;
  }
}

// Offline mode is explicit and uses the same versioned combat dataset.
export const speciesService: SpeciesService = process.env.NEXT_PUBLIC_LIVE_BATTLE === "0"
  ? new EmbeddedSpeciesService()
  : new ServerSpeciesService();
