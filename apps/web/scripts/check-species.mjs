#!/usr/bin/env node
/** Checks every catalog species against PokéAPI and lists which summon fallbacks it will need. */
import { readFile } from "node:fs/promises";
const { entries } = JSON.parse(await readFile(new URL("../lib/cards/catalog.generated.json", import.meta.url), "utf8"));
const species = [...new Set(entries.map((e) => e.species))];
const report = { ok: 0, noShowdown: [], noArtwork: [], noCry: [], noLevelUp: [], missing: [] };
for (let i = 0; i < species.length; i += 12) {
  await Promise.all(species.slice(i, i + 12).map(async (s) => {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${s}`);
    if (!res.ok) { report.missing.push(s); return; }
    const p = await res.json();
    const sd = p.sprites.other?.showdown;
    if (!sd?.front_default || !sd?.back_default) report.noShowdown.push(s);
    if (!p.sprites.other?.["official-artwork"]?.front_default) report.noArtwork.push(s);
    if (!p.cries?.latest && !p.cries?.legacy) report.noCry.push(s);
    if (!p.moves.some((m) => m.version_group_details.some((v) => v.move_learn_method.name === "level-up"))) report.noLevelUp.push(s);
    report.ok++;
  }));
}
console.log(JSON.stringify(report));
