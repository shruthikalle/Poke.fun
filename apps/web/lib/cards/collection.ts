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
export const DEVNET_TEST_COLLECTION_ADDRESS = "9cu8Rf7ryTHPrN24D62Q4xsEHnP8aBHS28mBdy4WRuCv";
const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

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

/** Reads our test collection from Solana DAS. Marketplace purchases are real assets, so they show up here too. */
async function devnetCollection(owner: string): Promise<DasAsset[]> {
  const response = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetsByOwner", params: { ownerAddress: owner, limit: 1000 } }),
  });
  if (!response.ok) throw new Error(`Solana RPC returned ${response.status}`);
  const data = await response.json() as { result?: { items?: (DasAsset & { burnt?: boolean })[]; total?: number }; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "Could not read wallet cards");
  if (!Array.isArray(data.result?.items)) throw new Error("Invalid wallet card response");
  return data.result.items.filter((a) =>
    a.interface === "MplCoreAsset" &&
    a.ownership?.owner === owner &&
    !a.burnt &&
    a.grouping?.some((g) => g.group_key === "collection" && g.group_value === DEVNET_TEST_COLLECTION_ADDRESS),
  );
}

export class MockCollectionService implements CollectionService {
  async getOwnedCollectibles(owner: string): Promise<DasAsset[]> {
    const which = scenario();
    if (which !== "default") return mockCollection(owner, which);
    return devnetCollection(owner);
  }
}

export class DevnetCollectionService implements CollectionService {
  async getOwnedCollectibles(owner: string): Promise<DasAsset[]> {
    const response = await fetch(`/api/devnet-cards?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not verify devnet card ownership");
    return response.json() as Promise<DasAsset[]>;
  }
}

export const collectionService: CollectionService = process.env.NEXT_PUBLIC_COLLECTION_SOURCE === "devnet"
  ? new DevnetCollectionService()
  : new MockCollectionService();
