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

export interface CollectionService {
  getOwnedCollectibles(owner: string): Promise<DasAsset[]>;
}

export const MOCK_COLLECTION_ADDRESS = "MockVau1tedCards11111111111111111111111111";

const art = (set: string, n: number) => `https://images.pokemontcg.io/${set}/${n}.png`;

interface MockCard { id: string; name: string; set: string; setCode: string; number: number; of: number; grade: string; category?: string }

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
        { trait_type: "Card Number", value: `${c.number}/${c.of}` },
        { trait_type: "Grading Company", value: "PSA" },
        { trait_type: "Grade", value: c.grade },
      ],
    },
    links: { image: art(c.setCode, c.number) },
  },
  grouping: [{ group_key: "collection", group_value: MOCK_COLLECTION_ADDRESS }],
  ownership: { owner, frozen: false },
});

const MY_CARDS: MockCard[] = [
  { id: "mock-pikachu-base-58", name: "Pikachu", set: "Base Set", setCode: "base1", number: 58, of: 102, grade: "9" },
  { id: "mock-charizard-base-4", name: "Charizard", set: "Base Set", setCode: "base1", number: 4, of: 102, grade: "8" },
  { id: "mock-gengar-fossil-5", name: "Gengar", set: "Fossil", setCode: "base3", number: 5, of: 62, grade: "10" },
  { id: "mock-snorlax-jungle-11", name: "Snorlax", set: "Jungle", setCode: "base2", number: 11, of: 64, grade: "9" },
  { id: "mock-gyarados-base-6", name: "Gyarados", set: "Base Set", setCode: "base1", number: 6, of: 102, grade: "7" },
  { id: "mock-oak-base-88", name: "Professor Oak", set: "Base Set", setCode: "base1", number: 88, of: 102, grade: "9", category: "Trainer" },
];

export const OPPONENT_CARDS: MockCard[] = [
  { id: "opp-mewtwo-base-10", name: "Mewtwo", set: "Base Set", setCode: "base1", number: 10, of: 102, grade: "9" },
  { id: "opp-blastoise-base-2", name: "Blastoise", set: "Base Set", setCode: "base1", number: 2, of: 102, grade: "8" },
  { id: "opp-alakazam-base-1", name: "Alakazam", set: "Base Set", setCode: "base1", number: 1, of: 102, grade: "9" },
  { id: "opp-machamp-base-8", name: "Machamp", set: "Base Set", setCode: "base1", number: 8, of: 102, grade: "8" },
  { id: "opp-venusaur-base-15", name: "Venusaur", set: "Base Set", setCode: "base1", number: 15, of: 102, grade: "9" },
  { id: "opp-ninetales-base-12", name: "Ninetales", set: "Base Set", setCode: "base1", number: 12, of: 102, grade: "10" },
];

export const opponentAssets = (owner: string) => OPPONENT_CARDS.map((c) => asset(owner, c));

/** TODO(collectibles): call `getAssetsByOwner` on a DAS-enabled RPC (QuickNode) and filter by supported collections. */
export class MockCollectionService implements CollectionService {
  async getOwnedCollectibles(owner: string): Promise<DasAsset[]> {
    await new Promise((r) => setTimeout(r, 350));
    return MY_CARDS.map((c) => asset(owner, c));
  }
}

export const collectionService: CollectionService = new MockCollectionService();
