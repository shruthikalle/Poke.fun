/**
 * Collectible card seam. Shapes follow the Metaplex DAS `getAssetsByOwner`
 * response. Owned cards come from the Go marketplace index, which reads Metaplex
 * Core accounts on devnet for every collection approved by the market program.
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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface IndexedCard { mint: string; owner: string; collection: string; name: string; image?: string; attributes: DasAttribute[] | null }

/** A card the index verified on-chain: a Core asset in an approved collection. */
export function isVerifiedAsset(asset: DasAsset): boolean {
  return asset.interface === "MplCoreAsset" && asset.grouping.some((g) => g.group_key === "collection" && !!g.group_value);
}

export class IndexCollectionService implements CollectionService {
  async getOwnedCollectibles(owner: string): Promise<DasAsset[]> {
    const response = await fetch(`${API_URL}/api/market/wallet/${encodeURIComponent(owner)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not read wallet cards (${response.status})`);
    const body = await response.json() as { ready: boolean; cards: IndexedCard[] };
    if (!body.ready) throw new Error("The card index is still loading. Try again in a moment.");
    return body.cards.map((c) => ({
      id: c.mint,
      interface: "MplCoreAsset",
      content: { metadata: { name: c.name, attributes: c.attributes ?? [] }, links: { image: c.image ?? "" } },
      grouping: [{ group_key: "collection", group_value: c.collection }],
      ownership: { owner: c.owner, frozen: false },
    }));
  }
}

export const collectionService: CollectionService = new IndexCollectionService();
