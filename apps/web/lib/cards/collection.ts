import { local } from "../storage";
/**
 * Collectible card seam. Shapes follow the Metaplex DAS `getAssetsByOwner`
 * response so a real RPC result can be passed straight through.
 */

export interface DasAttribute { trait_type: string; value: string }

export interface DasAsset {
  id: string;
  interface: "V1_NFT" | "ProgrammableNFT" | "MplCoreAsset";
  content: {
    metadata: { name: string; symbol?: string; attributes: DasAttribute[] };
    links: { image: string };
  };
  grouping: { group_key: "collection"; group_value: string }[];
  ownership: { owner: string; frozen: boolean };
}

import { CARD_CATALOG, type CatalogEntry } from "./mapping";

export interface CollectionService {
  getOwnedCollectibles(owner: string): Promise<DasAsset[]>;
}

export const MOCK_COLLECTION_ADDRESS = "MockVau1tedCards11111111111111111111111111";

/** Mock wallet contents, switchable from /dev/summons to exercise edge cases. */
export type MockScenario = "default" | "empty" | "ineligible" | "one" | "large";
export const MOCK_SCENARIO_KEY = "pf:mock-collection";

const GRADES = ["10", "9", "9", "8", "7"];

const fromCatalog = (owner: string, e: CatalogEntry, i: number): DasAsset => asset(owner, {
  id: `mock-${e.id}`, name: e.name, set: e.setName, number: e.number, image: e.image, grade: GRADES[i % GRADES.length],
});

interface MockCard { id: string; name: string; set: string; number: string; image: string; grade: string; category?: string }

const asset = (owner: string, c: MockCard): DasAsset => ({
  id: c.id,
  interface: "ProgrammableNFT",
  content: {
    metadata: {
      name: `${c.name} – ${c.set} PSA ${c.grade}`,
      symbol: "CARD",
      attributes: [
        { trait_type: "Category", value: c.category ?? "Pokemon" },
        { trait_type: "Card Name", value: c.name },
        { trait_type: "Set", value: c.set },
        { trait_type: "Card Number", value: c.number },
        { trait_type: "Grading Company", value: "PSA" },
        { trait_type: "Grade", value: c.grade },
      ],
    },
    links: { image: c.image },
  },
  grouping: [{ group_key: "collection", group_value: MOCK_COLLECTION_ADDRESS }],
  ownership: { owner, frozen: false },
});

const art = (set: string, n: string) => `https://images.pokemontcg.io/${set}/${n}.png`;
const byId = (id: string) => CARD_CATALOG.entries.find((e) => e.id === id);

/** Owned cards spanning vintage, modern and full-art layouts plus tricky names and forms. */
const MY_CARD_IDS = ["base1-58", "base1-4", "base3-5", "base2-11", "base1-6", "sv3pt5-199", "sv3pt5-173", "base2-6", "base1-27", "base1-55", "swsh12pt5gg-GG01", "swsh12pt5gg-GG56"];

const INELIGIBLE: MockCard[] = [
  { id: "mock-oak-base-88", name: "Professor Oak", set: "Base Set", number: "88/102", image: art("base1", "88"), grade: "9", category: "Trainer" },
  { id: "mock-energy-base-98", name: "Fire Energy", set: "Base Set", number: "98/102", image: art("base1", "98"), grade: "8", category: "Energy" },
  { id: "mock-dark-charizard-tr-4", name: "Dark Charizard", set: "Team Rocket", number: "4/82", image: art("base5", "4"), grade: "9" },
];

function scenario(): MockScenario {
  return (local.get(MOCK_SCENARIO_KEY) as MockScenario | null) ?? "default";
}

export function mockCollection(owner: string, which: MockScenario = "default"): DasAsset[] {
  const owned = MY_CARD_IDS.map(byId).filter((e): e is CatalogEntry => !!e).map((e, i) => fromCatalog(owner, e, i));
  const ineligible = INELIGIBLE.map((c) => asset(owner, c));
  switch (which) {
    case "empty": return [];
    case "ineligible": return ineligible;
    case "one": return [owned[0], ...ineligible];
    case "large": return [...CARD_CATALOG.entries.map((e, i) => fromCatalog(owner, e, i)), ...ineligible];
    default: return [...owned, ...ineligible];
  }
}

/** Opponents draw from the whole catalog. */
export const opponentAssets = (owner: string, count = 8) => {
  let seed = [...owner].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, Date.now() >>> 0);
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pool = [...CARD_CATALOG.entries].sort(() => rand() - 0.5).slice(0, Math.max(count, 24));
  return pool.map((e, i) => fromCatalog(owner, e, i));
};

/** TODO(collectibles): call `getAssetsByOwner` on a DAS-enabled RPC (QuickNode) and filter by supported collections. */
export class MockCollectionService implements CollectionService {
  async getOwnedCollectibles(owner: string): Promise<DasAsset[]> {
    await new Promise((r) => setTimeout(r, 350));
    return mockCollection(owner, scenario());
  }
}

export const collectionService: CollectionService = new MockCollectionService();
