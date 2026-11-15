// Imports the Pokémon data the battle server needs from PokéAPI into a versioned
// dataset that the Go API embeds: services/api/internal/pokedex/pokedex.json.
//
// It covers every Pokémon: all species' default forms, plus the alternate forms
// printed on cards (Alolan, Galarian, Hisuian and Paldean forms, Mega,
// Gigantamax and Primal), plus any form the card catalog uses. For each one it
// stores types, base stats, sprite, power tier and every damaging move it can
// learn: level-up moves with their level, plus TM, tutor and egg moves. Each move
// is stored once in a shared move table. The catalog's card →
// species mapping is copied too, so the server can check an NFT's set and number.
//
// It also writes apps/web/lib/cards/species.generated.json, a small name index the
// web app uses to recognise cards outside the catalog by their printed name.
//
// Usage (from the repo root):
//   node scripts/build-pokedex.mjs            # uses cached responses when present
//   node scripts/build-pokedex.mjs --refresh  # download everything again
//
// Responses are cached in scripts/.cache/pokeapi/ (gitignored). Re-run after
// `npm run catalog` adds card sets, then commit the updated pokedex.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOG = resolve(ROOT, "apps/web/lib/cards/catalog.generated.json");
const OUTPUT = resolve(ROOT, "services/api/internal/pokedex/pokedex.json");
const NAME_INDEX = resolve(ROOT, "apps/web/lib/cards/species.generated.json");
const CACHE = resolve(ROOT, "scripts/.cache/pokeapi");
const API = "https://pokeapi.co/api/v2";
const REFRESH = process.argv.includes("--refresh");
const CONCURRENCY = 6;

const STAT_KEYS = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };
// Alternate forms worth a fighter: the ones printed on cards. Cosmetic and
// event forms (Pikachu in a cap, Totem Pokémon such as raticate-totem-alola) are left out.
const CARD_FORMS = /-(alola|galar|hisui|paldea)(-|$)|-mega(-[xy])?$|-gmax$|-primal$/;
// Card-style display prefixes for forms, matching SpeciesService's names.
const FORM_LABELS = [[/-hisui(-|$)/, "Hisuian"], [/-alola(-|$)/, "Alolan"], [/-galar(-|$)/, "Galarian"], [/-paldea(-|$)/, "Paldean"], [/-gmax$/, "Gigantamax"], [/-primal$/, "Primal"]];

const titleCase = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const english = (names) => names?.find((n) => n.language.name === "en")?.name;

// GET a PokéAPI path, cached on disk, retrying transient failures.
async function get(path) {
  const file = resolve(CACHE, `${path.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "_")}.json`);
  if (!REFRESH) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* not cached yet */ }
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`);
    if (res.ok) {
      const body = await res.json();
      await writeFile(file, JSON.stringify(body));
      return body;
    }
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
  }
}

async function mapLimit(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// Highest level at which each move is learned by level-up, across game versions.
function levelUpMoves(pokemon) {
  return pokemon.moves
    .map((m) => ({
      move: m.move.name,
      level: Math.max(-1, ...m.version_group_details.filter((d) => d.move_learn_method.name === "level-up").map((d) => d.level_learned_at)),
    }))
    .filter((m) => m.level >= 0);
}

// Moves learned only some other way (TM, tutor, egg…).
function otherMoves(pokemon) {
  const levelUp = new Set(levelUpMoves(pokemon).map((m) => m.move));
  return pokemon.moves.map((m) => m.move.name).filter((id) => !levelUp.has(id));
}

// Evolution stage: 0 for a basic Pokémon, 1 for its first evolution, and so on.
// Baby Pokémon (Pichu, Mime Jr., Tyrogue…) don't count, as in the card game, so
// Pikachu and Mr. Mime are basics.
async function stageOf(species) {
  let stage = 0;
  for (let s = species; s.evolves_from_species; ) {
    s = await get(`/pokemon-species/${s.evolves_from_species.name}`);
    if (!s.is_baby) stage++;
  }
  return stage;
}

// Power tier, the species-level version of the catalog's card tiers: legendary,
// mythical, Mega/Gigantamax or fully evolved (stage 2) is 3, stage 1 is 2,
// a basic Pokémon is 1. Matchmaking only pairs fighters of the same tier.
async function tierOf(key, species) {
  if (species.is_legendary || species.is_mythical || /-(mega|gmax)(-|$)/.test(key)) return 3;
  return [1, 2, 3][Math.min(2, await stageOf(species))];
}

function displayName(key, species) {
  const base = english(species.names) ?? titleCase(species.name);
  const mega = key.match(/-mega(?:-([xy]))?$/);
  if (mega) return `Mega ${base}${mega[1] ? ` ${mega[1].toUpperCase()}` : ""}`;
  const form = FORM_LABELS.find(([re]) => re.test(key));
  return form ? `${form[1]} ${base}` : base;
}

async function importSpecies(key) {
  const pokemon = await get(`/pokemon/${key}`);
  const species = await get(`/pokemon-species/${pokemon.species.name}`);
  // Forms such as Gigantamax have no movepool of their own; use the default variety's.
  const defaultKey = species.varieties.find((v) => v.is_default)?.pokemon.name;
  const base = !pokemon.is_default && defaultKey && defaultKey !== key ? await get(`/pokemon/${defaultKey}`) : null;
  const source = pokemon.moves.length ? pokemon : base ?? pokemon;
  return {
    key,
    species: species.name, // the base species, e.g. "darmanitan" for darmanitan-galar-standard
    default: pokemon.is_default,
    name: displayName(key, species),
    dex: species.id,
    types: pokemon.types.sort((a, b) => a.slot - b.slot).map((t) => titleCase(t.type.name)),
    tier: await tierOf(key, species),
    base: Object.fromEntries(pokemon.stats.map((s) => [STAT_KEYS[s.stat.name], s.base_stat])),
    sprite: pokemon.sprites.front_default ?? base?.sprites.front_default ?? pokemon.sprites.other?.["official-artwork"]?.front_default
      ?? base?.sprites.other?.["official-artwork"]?.front_default ?? "",
    learnset: levelUpMoves(source),
    otherMoves: otherMoves(source),
  };
}

async function importMove(id) {
  const m = await get(`/move/${id}`);
  if (!m.power || !["physical", "special"].includes(m.damage_class.name)) return null; // status or variable-power move
  return {
    id,
    name: english(m.names) ?? titleCase(m.name),
    type: titleCase(m.type.name),
    category: m.damage_class.name,
    power: m.power,
    accuracy: m.accuracy ?? 100, // moves that never miss have no accuracy
    pp: m.pp ?? 10,
  };
}

const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
await mkdir(CACHE, { recursive: true });

// Every species' default form and card-relevant alternate forms, plus whatever
// the card catalog uses.
const allSpecies = (await get("/pokemon-species?limit=5000")).results.map((r) => r.name);
console.log(`Reading ${allSpecies.length} species from PokéAPI…`);
const keySet = new Set(catalog.entries.map((e) => e.species));
for (const sp of await mapLimit(allSpecies, (name) => get(`/pokemon-species/${name}`))) {
  for (const v of sp.varieties) {
    if (v.is_default || (CARD_FORMS.test(v.pokemon.name) && !v.pokemon.name.includes("-totem"))) keySet.add(v.pokemon.name);
  }
}
const keys = [...keySet].sort();
console.log(`Importing ${keys.length} Pokémon (species and forms)…`);
const species = await mapLimit(keys, importSpecies);

const moveIds = [...new Set(species.flatMap((s) => [...s.learnset.map((l) => l.move), ...s.otherMoves]))].sort();
console.log(`Importing ${moveIds.length} moves…`);
const moves = Object.fromEntries((await mapLimit(moveIds, importMove)).filter(Boolean).map((m) => [m.id, m]));

for (const s of species) {
  // Keep only damaging moves, in a stable order so re-imports diff cleanly.
  s.learnset = s.learnset.filter((l) => moves[l.move]).sort((a, b) => a.level - b.level || a.move.localeCompare(b.move));
  s.otherMoves = s.otherMoves.filter((id) => moves[id]).sort();
}
// A few species (Ditto, for one) only learn non-damaging moves. That is real data,
// so keep them; the battle engines fall back to standard Normal-type moves.
const moveless = species.filter((s) => !s.learnset.length && !s.otherMoves.length).map((s) => s.key);
if (moveless.length) console.warn(`No damaging moves (engines use fallback moves): ${moveless.join(", ")}`);
species.sort((a, b) => a.dex - b.dex || a.key.localeCompare(b.key));

const dataset = {
  version: catalog.version,
  source: API,
  species,
  moves: Object.fromEntries(Object.entries(moves).map(([id, { id: _, ...m }]) => [id, m])),
  cards: {
    sets: catalog.sets.map(({ id, aliases }) => ({ id, aliases })),
    entries: catalog.entries.map(({ id, set, number, species: key }) => ({ id, set, number, species: key })),
  },
};
// One species, move or card per line: compact, and a re-import diffs line by line.
const lines = (items) => items.map((x) => `  ${x}`).join(",\n");
await writeFile(OUTPUT, [
  "{",
  ` "version": ${JSON.stringify(dataset.version)},`,
  ` "source": ${JSON.stringify(dataset.source)},`,
  ` "species": [\n${lines(dataset.species.map((x) => JSON.stringify(x)))}\n ],`,
  ` "moves": {\n${lines(Object.entries(dataset.moves).map(([id, m]) => `${JSON.stringify(id)}: ${JSON.stringify(m)}`))}\n },`,
  ` "cards": {\n  "sets": ${JSON.stringify(dataset.cards.sets)},\n  "entries": [\n${lines(dataset.cards.entries.map((x) => ` ${JSON.stringify(x)}`))}\n  ]\n }`,
  "}",
].join("\n") + "\n");
const missingSprite = species.filter((s) => !s.sprite).map((s) => s.key);
if (missingSprite.length) console.warn(`No sprite on PokéAPI: ${missingSprite.join(", ")}`);

// The browser's name index: just enough to recognise a card by its printed name.
await writeFile(NAME_INDEX, `${JSON.stringify({
  version: dataset.version,
  species: species.map(({ key, species: base, default: isDefault, name, dex, tier }) => ({ key, species: base, default: isDefault, name, dex, tier })),
}, null, 0).replace(/},{/g, "},\n{")}\n`);
console.log(`Wrote ${species.length} Pokémon, ${Object.keys(moves).length} moves and ${dataset.cards.entries.length} cards to ${OUTPUT.replace(ROOT, "")}`);
console.log(`Wrote the name index to ${NAME_INDEX.replace(ROOT, "")}`);
