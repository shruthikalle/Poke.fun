/**
 * Builds lib/pokemon/offlineDex.generated.json, the explicit offline mode's copy
 * of the Go server's Pokédex (services/api/internal/pokedex/pokedex.json),
 * trimmed to the fields offline combat reads. Next.js cannot bundle files
 * outside apps/web, so the copy is generated; `npm run offline-dex:check`
 * (and the battle tests) fail if it drifts from the server's data.
 *
 *   node scripts/build-offline-dex.mjs          # write
 *   node scripts/build-offline-dex.mjs --check  # verify only
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../../../services/api/internal/pokedex/pokedex.json", import.meta.url);
const target = new URL("../lib/pokemon/offlineDex.generated.json", import.meta.url);

export function trimDex(dex) {
  const species = dex.species.map((s) => ({
    key: s.key, species: s.species, name: s.name, dex: s.dex, types: s.types, tier: s.tier, base: s.base,
    sprite: s.sprite, learnset: (s.learnset ?? []).map((l) => l.move), otherMoves: s.otherMoves ?? [],
  }));
  const used = new Set(species.flatMap((s) => [...s.learnset, ...s.otherMoves]));
  const moves = Object.fromEntries(Object.entries(dex.moves).filter(([id]) => used.has(id)));
  return { version: dex.version, species, moves };
}

export async function expectedOfflineDex() {
  return `${JSON.stringify(trimDex(JSON.parse(await readFile(source, "utf8"))))}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = await expectedOfflineDex();
  if (process.argv.includes("--check")) {
    const actual = await readFile(target, "utf8").catch(() => "");
    if (actual !== expected) {
      console.error("offlineDex.generated.json is out of date; run npm run offline-dex");
      process.exit(1);
    }
    console.log("offline Pokédex matches the server");
  } else {
    await writeFile(target, expected);
    console.log(`wrote ${fileURLToPath(target)} (${(expected.length / 1024).toFixed(0)} KB)`);
  }
}
