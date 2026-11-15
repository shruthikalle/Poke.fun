import index from "./species.generated.json";

// Recognises the Pokémon on any card from its printed name, for cards outside
// the catalog (a real collection can hold any card from any set). This is the
// browser's copy of SpeciesForCardName in services/api/internal/pokedex/cards.go,
// so the loadout and the server agree on what a card is. Keep the two in step;
// the shared cases are in services/api/internal/pokedex/testdata/card_names.json.
//
// The name index is written by scripts/build-pokedex.mjs.

export interface SpeciesEntry {
  key: string; // PokéAPI key, e.g. "pikachu" or "zoroark-hisui"
  species: string; // base species, e.g. "zoroark"
  default: boolean; // the species' default form, which a plain name means
  name: string;
  dex: number;
  tier: number;
}

const ENTRIES = (index as { species: SpeciesEntry[] }).species;
const BY_KEY = new Map(ENTRIES.map((e) => [e.key, e]));

/**
 * Lowercases, folds accents, spells ♀ and ♂ as f and m (so the two Nidoran stay
 * distinct) and keeps only ASCII letters and digits, like normalize() in cards.go.
 */
export function normalizeName(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f").replace(/♂/g, "m").replace(/[^a-z0-9]/g, "");
}

// Default forms by normalised name; "" marks a name shared by two species, so
// we never guess between them.
const BY_NAME = new Map<string, string>();
for (const e of ENTRIES) {
  if (!e.default) continue;
  const n = normalizeName(e.name);
  BY_NAME.set(n, BY_NAME.has(n) && BY_NAME.get(n) !== e.key ? "" : e.key);
}

const PARENTHETICAL = /\([^)]*\)|\[[^\]]*\]/g;
const WITH_CLAUSE = /\s+with\s+.*$/i;
const OWNER = /^.*?['’]s\s+/;
const REGIONAL: Record<string, string> = { alolan: "alola", galarian: "galar", hisuian: "hisui", paldean: "paldea" };

/**
 * The Pokémon a card shows, by the same steps as the server:
 *  1. drop parentheticals, "with …" clauses and an owner ("Team Rocket's");
 *  2. find the longest run of up to four words that is a species' name, so
 *     words like "Dark", "Radiant", "ex" or "LV.X" don't matter;
 *  3. apply a form marker (Alolan/Galarian/Hisuian/Paldean, M/Mega + X/Y,
 *     Primal, VMAX/Gigantamax) if the species has that form.
 * Returns null when no species is named.
 */
export function speciesForCardName(raw: string): SpeciesEntry | null {
  const name = raw.replace(PARENTHETICAL, " ").replace(WITH_CLAUSE, "").trim().replace(OWNER, "");
  const words = name.split(/\s+/).filter(Boolean);
  const found = findSpecies(words);
  if (!found) return null;
  const form = formMarker(words, found.start, found.end);
  if (form) {
    const hints = [...words.slice(0, found.start), ...words.slice(found.end)];
    const formKey = findForm(found.key, form, hints);
    if (formKey) return BY_KEY.get(formKey) ?? null;
  }
  return BY_KEY.get(found.key) ?? null;
}

/** The longest (then leftmost) run of words naming a species. */
function findSpecies(words: string[]) {
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const key = BY_NAME.get(normalizeName(words.slice(i, i + size).join(" ")));
      if (key) return { key, start: i, end: i + size };
    }
  }
  return null;
}

/** "galar", "mega", "mega-x", "primal" or "gmax" from the card's words, or "". */
function formMarker(words: string[], start: number, end: number) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lower = w.toLowerCase();
    if (REGIONAL[lower]) return REGIONAL[lower];
    if (lower === "primal") return "primal";
    if (lower === "vmax" || lower === "gigantamax") return "gmax";
    if ((w === "M" || lower === "mega") && i < start) {
      return end < words.length && (words[end] === "X" || words[end] === "Y") ? `mega-${words[end].toLowerCase()}` : "mega";
    }
  }
  return "";
}

/**
 * The species' form whose key contains the marker: the one naming most of the
 * card's other words ("single", "strike"), then an exact suffix, then Dex order.
 */
function findForm(key: string, form: string, hints: string[]) {
  const species = BY_KEY.get(key)?.species;
  let best = "", bestScore = -1;
  for (const e of ENTRIES) {
    if (e.species !== species || e.default || !`${e.key}-`.includes(`-${form}-`)) continue;
    let score = 0;
    for (const h of hints) {
      const n = normalizeName(h);
      if (n && `${e.key}-`.includes(`-${n}-`)) score += 2;
    }
    if (e.key.endsWith(`-${form}`)) score++;
    if (score > bestScore) { best = e.key; bestScore = score; }
  }
  return best;
}
