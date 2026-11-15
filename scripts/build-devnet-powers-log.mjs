import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const statePath = process.env.POKEFUN_DEVNET_STATE_PATH ?? "/private/tmp/pokefun-devnet-mints.json";
const state = JSON.parse(await readFile(statePath, "utf8"));
const catalog = JSON.parse(await readFile(new URL("../apps/web/lib/cards/catalog.generated.json", import.meta.url), "utf8"));
const output = resolve(new URL("../docs/", import.meta.url).pathname);
const fetched = new Map();

async function json(url) {
  if (!fetched.has(url)) fetched.set(url, (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url);
      if (response.ok) return response.json();
      if (attempt === 2 || (response.status < 500 && response.status !== 429)) throw new Error(`${url}: ${response.status}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  })());
  return fetched.get(url);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

const title = (s) => s.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
const fallback = [
  { id: "tackle", name: "Tackle", type: "Normal", category: "physical", power: 40, accuracy: 100, maxPp: 35 },
  { id: "quick-attack", name: "Quick Attack", type: "Normal", category: "physical", power: 40, accuracy: 100, maxPp: 30 },
  { id: "body-slam", name: "Body Slam", type: "Normal", category: "physical", power: 85, accuracy: 100, maxPp: 15 },
  { id: "headbutt", name: "Headbutt", type: "Normal", category: "physical", power: 70, accuracy: 100, maxPp: 15 },
];

async function powers(entry) {
  const pokemonUrl = `https://pokeapi.co/api/v2/pokemon/${entry.species}`;
  const pokemon = await json(pokemonUrl);
  const types = pokemon.types.sort((a, b) => a.slot - b.slot).map((x) => title(x.type.name));
  const base = Object.fromEntries(pokemon.stats.map((x) => [x.stat.name, x.base_stat]));
  const candidates = pokemon.moves
    .map((x) => ({ id: x.move.name, level: Math.max(-1, ...x.version_group_details.filter((d) => d.move_learn_method.name === "level-up").map((d) => d.level_learned_at)) }))
    .filter((x) => x.level >= 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, 16);
  const moves = (await mapLimit(candidates, 4, async (candidate) => {
    const m = await json(`https://pokeapi.co/api/v2/move/${candidate.id}`);
    if (!m.power || !["physical", "special"].includes(m.damage_class.name)) return null;
    return { id: m.name, name: m.names.find((n) => n.language.name === "en")?.name ?? title(m.name), type: title(m.type.name), category: m.damage_class.name, power: m.power, accuracy: m.accuracy ?? 100, maxPp: m.pp ?? 10, source: `https://pokeapi.co/api/v2/move/${m.name}` };
  })).filter(Boolean);
  const score = (m) => m.power * (m.accuracy / 100) * (types.includes(m.type) ? 1.5 : 1);
  moves.sort((a, b) => score(b) - score(a));
  const chosen = [];
  for (const m of moves) if (chosen.length < 2 && types.includes(m.type)) chosen.push(m);
  for (const m of moves) if (chosen.length < 4 && !chosen.includes(m) && !chosen.some((p) => p.type === m.type)) chosen.push(m);
  for (const m of moves) if (chosen.length < 4 && !chosen.includes(m)) chosen.push(m);
  for (const m of fallback) if (chosen.length < 4 && !chosen.some((p) => p.id === m.id)) chosen.push({ ...m, source: `https://pokeapi.co/api/v2/move/${m.id}` });
  const level = entry.level;
  const stat = (b) => Math.floor(((2 * b + 31) * level) / 100) + 5;
  return {
    level, tier: entry.tier, types, base,
    battle: { hp: Math.floor(((2 * base.hp + 31) * level) / 100) + level + 10, attack: stat(base.attack), defense: stat(base.defense), specialAttack: stat(base["special-attack"]), specialDefense: stat(base["special-defense"]), speed: base.speed },
    moves: chosen,
    source: pokemonUrl,
  };
}

const cards = [];
for (const asset of state.assets) {
  const entry = catalog.entries.find((x) => x.id === asset.id);
  if (!entry) throw new Error(`No battle catalog entry for ${asset.id}`);
  const data = await powers(entry);
  cards.push({ asset: asset.address, owner: asset.owner, cardId: entry.id, card: entry.name, set: entry.setName, number: entry.number, image: entry.image, ...data });
  console.log(`Read PokéAPI powers for ${entry.name}`);
}

const generatedAt = new Date().toISOString();
const jsonLog = { network: "solana:devnet", collection: state.collection, generatedAt, cards };
await writeFile(`${output}/devnet-test-card-powers.json`, JSON.stringify(jsonLog, null, 2) + "\n");

const lines = [
  "# Devnet test card powers",
  "",
  `Generated ${generatedAt} from [PokéAPI](https://pokeapi.co/docs/v2) for the Poke.fun test collection \`${state.collection}\`. These NFTs are **not vaulted or graded**. PokéAPI base stats and move power are inputs; battle HP and other combat stats use Poke.fun's level 50 formula. Move selection mirrors \`SpeciesService\` and may change if the game rules change.`,
  "",
  "| Card | Owner | Asset | Type | Lv | HP | Atk | Def | SpA | SpD | Speed | Tier |",
  "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...cards.map((c) => `| ${c.card} | \`${c.owner.slice(0, 4)}…${c.owner.slice(-4)}\` | [Explorer](https://explorer.solana.com/address/${c.asset}?cluster=devnet) | ${c.types.join("/")} | ${c.level} | ${c.battle.hp} | ${c.battle.attack} | ${c.battle.defense} | ${c.battle.specialAttack} | ${c.battle.specialDefense} | ${c.battle.speed} | ${c.tier} |`),
  "",
  ...cards.flatMap((c) => [
    `## ${c.card} — ${c.set} #${c.number}`,
    "",
    `NFT: \`${c.asset}\` · [PokéAPI species](${c.source})`,
    "",
    "| Move | Type | Class | Power | Accuracy | PP |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...c.moves.map((m) => `| [${m.name}](${m.source}) | ${m.type} | ${m.category} | ${m.power} | ${m.accuracy}% | ${m.maxPp} |`),
    "",
  ]),
];
await writeFile(`${output}/devnet-test-card-powers.md`, lines.join("\n"));
console.log(`Wrote ${cards.length} card power records to docs/devnet-test-card-powers.{json,md}`);
