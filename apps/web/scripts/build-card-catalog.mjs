#!/usr/bin/env node
/**
 * Builds lib/cards/catalog.generated.json: every Pokémon card in SETS, resolved to a PokéAPI
 * pokemon name, with a power tier and the card's art window. Raw API responses are cached in
 * scripts/.cache, so reruns are offline. Pass --refresh to refetch.
 *
 *   node scripts/build-card-catalog.mjs [--refresh]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2026.11-2";
const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, ".cache");
const outFile = join(here, "..", "lib", "cards", "catalog.generated.json");
const refresh = process.argv.includes("--refresh");

/** `era` picks the art window for non-full-art cards. `aliases` are set names seen in collectible metadata. */
const SETS = [
  { id: "base1", name: "Base Set", aliases: ["Base Set", "Base"], era: "vintage" },
  { id: "base2", name: "Jungle", aliases: ["Jungle"], era: "vintage" },
  { id: "base3", name: "Fossil", aliases: ["Fossil"], era: "vintage" },
  { id: "sv3pt5", name: "151", aliases: ["151", "Scarlet & Violet 151", "SV 151", "Scarlet & Violet—151"], era: "modern" },
  { id: "swsh12pt5gg", name: "Crown Zenith Galarian Gallery", aliases: ["Crown Zenith Galarian Gallery", "Galarian Gallery"], era: "gallery" },
];

/** Fractions of the card image: x, y, w, h. */
const WINDOWS = {
  vintage: { x: 0.09, y: 0.11, w: 0.82, h: 0.37 },
  modern: { x: 0.055, y: 0.108, w: 0.89, h: 0.355 },
  full: { x: 0, y: 0, w: 1, h: 1 },
};
const FULL_ART_RARITIES = /illustration|ultra|hyper|secret|gallery|rainbow/i;
const LEGENDARY = new Set([144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649]);
const FORM_PREFIX = [["Alolan ", "alola"], ["Galarian ", "galar"], ["Hisuian ", "hisui"], ["Paldean ", "paldea"]];

async function cached(name, url) {
  const file = join(cacheDir, name);
  if (!refresh) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* fetch below */ }
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: process.env.POKEMONTCG_API_KEY ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY } : {} });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (e) {
      if (attempt === 5) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

const pokemon = await cached("pokeapi-pokemon.json", "https://pokeapi.co/api/v2/pokemon?limit=2000");
const names = new Set(pokemon.results.map((r) => r.name));
const byDex = new Map(pokemon.results.map((r) => [Number(r.url.split("/").filter(Boolean).pop()), r.name]));

function resolveSpecies(cardName, dex) {
  const base = byDex.get(dex);
  if (!base) return null;
  for (const [prefix, form] of FORM_PREFIX) {
    if (cardName.startsWith(prefix) && names.has(`${base}-${form}`)) return `${base}-${form}`;
  }
  if (/^(M |Mega )/.test(cardName)) {
    const mega = [...names].find((n) => n === `${base}-mega` || n.startsWith(`${base}-mega-`));
    if (mega) return mega;
  }
  if (/\bVMAX\b/.test(cardName) && names.has(`${base}-gmax`)) return `${base}-gmax`;
  return base;
}

function tierFor(card, dex) {
  const subtypes = card.subtypes ?? [];
  if (LEGENDARY.has(dex) || subtypes.some((s) => /^(Stage 2|ex|EX|GX|V|VMAX|VSTAR)$/.test(s))) return 3;
  if (subtypes.includes("Stage 1")) return 2;
  return 1;
}

const entries = [];
const skipped = [];
for (const set of SETS) {
  const json = await cached(`tcg-${set.id}.json`, `https://api.pokemontcg.io/v2/cards?q=set.id:${set.id}&pageSize=250&select=id,name,number,supertype,subtypes,rarity,nationalPokedexNumbers,images,hp,types,set`);
  for (const card of json.data) {
    if (!card.supertype.startsWith("Pok")) continue;
    const dex = card.nationalPokedexNumbers?.[0];
    const species = dex ? resolveSpecies(card.name, dex) : null;
    if (!species) { skipped.push(`${card.id} ${card.name}`); continue; }
    const fullArt = set.era === "gallery" || FULL_ART_RARITIES.test(card.rarity ?? "");
    entries.push({
      id: card.id,
      set: set.id,
      setName: set.name,
      number: card.number,
      name: card.name,
      species,
      dex,
      level: 50,
      tier: tierFor(card, dex),
      rarity: card.rarity ?? null,
      image: card.images.small,
      artWindow: fullArt ? WINDOWS.full : WINDOWS[set.era],
    });
  }
}

entries.sort((a, b) => SETS.findIndex((s) => s.id === a.set) - SETS.findIndex((s) => s.id === b.set) || a.number.localeCompare(b.number, "en", { numeric: true }));
await writeFile(outFile, JSON.stringify({ version: VERSION, sets: SETS.map(({ id, name, aliases }) => ({ id, name, aliases })), entries }) + "\n");
console.log(`catalog ${VERSION}: ${entries.length} cards, ${new Set(entries.map((e) => e.species)).size} species → ${outFile}`);
if (skipped.length) console.log("skipped:", skipped.join(", "));
