import type { DasAsset } from "./collection";

export type PowerTier = 1 | 2 | 3;

export interface CardMappingEntry { species: string; level: number; tier: PowerTier }

/** Reviewed card → battle definition table. Bump `version` on any balance change. */
export const CARD_MAPPING: { version: string; entries: Record<string, CardMappingEntry> } = {
  version: "2026.11-1",
  entries: {
    "Base Set#58": { species: "pikachu", level: 50, tier: 1 },
    "Base Set#4": { species: "charizard", level: 50, tier: 3 },
    "Fossil#5": { species: "gengar", level: 50, tier: 2 },
    "Jungle#11": { species: "snorlax", level: 50, tier: 2 },
    "Base Set#6": { species: "gyarados", level: 50, tier: 2 },
    "Base Set#10": { species: "mewtwo", level: 50, tier: 3 },
    "Base Set#2": { species: "blastoise", level: 50, tier: 3 },
    "Base Set#1": { species: "alakazam", level: 50, tier: 2 },
    "Base Set#8": { species: "machamp", level: 50, tier: 2 },
    "Base Set#15": { species: "venusaur", level: 50, tier: 3 },
    "Base Set#12": { species: "ninetales", level: 50, tier: 1 },
  },
};

/** A battle-ready pick: an owned card or a rental from the shared pool. */
export interface CardPick {
  key: string;
  species: string;
  label: string;
  image: string | null;
  grade: string | null;
  level: number;
  tier: PowerTier;
  rental: boolean;
}

export type CardResolution = { eligible: true; pick: CardPick } | { eligible: false; reason: string };

const attr = (a: DasAsset, trait: string) => a.content.metadata.attributes.find((x) => x.trait_type === trait)?.value;

export function resolveCard(asset: DasAsset): CardResolution {
  if (attr(asset, "Category") !== "Pokemon") return { eligible: false, reason: "Trainer cards can't battle" };
  const key = `${attr(asset, "Set")}#${attr(asset, "Card Number")?.split("/")[0]}`;
  const entry = CARD_MAPPING.entries[key];
  if (!entry) return { eligible: false, reason: "Not supported yet" };
  return {
    eligible: true,
    pick: {
      key: asset.id,
      species: entry.species,
      label: attr(asset, "Card Name") ?? asset.content.metadata.name,
      image: asset.content.links.image,
      grade: attr(asset, "Grade") ? `${attr(asset, "Grading Company") ?? ""} ${attr(asset, "Grade")}`.trim() : null,
      level: entry.level,
      tier: entry.tier,
      rental: false,
    },
  };
}

/** Same pool for both players, so squad depth never depends on collection size. */
export const RENTAL_POOL: CardPick[] = ["eevee", "lapras", "jolteon", "scyther", "onix", "hitmonchan"].map((species) => ({
  key: `rental-${species}`,
  species,
  label: species[0].toUpperCase() + species.slice(1),
  image: null,
  grade: null,
  level: 50,
  tier: 1,
  rental: true,
}));

export type MatchFormat = "champion" | "squad";

export const FORMAT_LABEL: Record<MatchFormat, string> = { champion: "Champion 1v1", squad: "Squad of 3" };

/** Lead card first, then other owned cards, then rentals the player hasn't brought. */
export function buildTeam(lead: CardPick, owned: CardPick[], format: MatchFormat): CardPick[] {
  if (format === "champion") return [lead];
  const bench = owned.filter((c) => c.key !== lead.key && c.species !== lead.species).slice(0, 2);
  const used = new Set([lead.species, ...bench.map((c) => c.species)]);
  for (const r of RENTAL_POOL) if (bench.length < 2 && !used.has(r.species)) { bench.push(r); used.add(r.species); }
  return [lead, ...bench];
}
