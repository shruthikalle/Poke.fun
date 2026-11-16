import type { DasAsset, DasAttribute } from "../../../lib/cards/collection";

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const INTERFACES = new Set(["MplCoreAsset", "V1_NFT", "ProgrammableNFT"]);
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

function normalizeAsset(value: unknown, owner: string, approved: Set<string>): DasAsset | null {
  const asset = object(value);
  const ownership = object(asset.ownership);
  if (!text(asset.id) || !INTERFACES.has(text(asset.interface)) || asset.burnt === true || ownership.owner !== owner) return null;
  const grouping = (Array.isArray(asset.grouping) ? asset.grouping : []).map(object)
    .filter((group) => group.group_key === "collection" && approved.has(text(group.group_value)) && group.verified !== false)
    .map((group) => ({ group_key: "collection" as const, group_value: text(group.group_value) }));
  if (!grouping.length) return null;

  const content = object(asset.content);
  const metadata = object(content.metadata);
  const attributes: DasAttribute[] = (Array.isArray(metadata.attributes) ? metadata.attributes : []).flatMap((value) => {
    const attribute = object(value);
    if (typeof attribute.trait_type !== "string" || !["string", "number", "boolean"].includes(typeof attribute.value)) return [];
    return [{ trait_type: attribute.trait_type, value: String(attribute.value) }];
  });
  return {
    id: text(asset.id),
    interface: asset.interface as DasAsset["interface"],
    content: {
      metadata: { name: text(metadata.name), symbol: text(metadata.symbol), attributes },
      links: { image: text(object(content.links).image) },
    },
    grouping,
    ownership: { owner, frozen: ownership.frozen === true },
  };
}

/** Read every page before returning; a partial inventory must not look complete. */
export async function discoverOwnedAssets(rpcUrl: string, owner: string, collections: string[]): Promise<DasAsset[]> {
  const approved = new Set(collections);
  const assets = new Map<string, DasAsset>();
  const seenIds = new Set<string>();
  const signal = AbortSignal.timeout(30_000);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({
        jsonrpc: "2.0", id: page, method: "getAssetsByOwner",
        params: {
          ownerAddress: owner, page, limit: PAGE_SIZE,
          options: { showUnverifiedCollections: false },
        },
      }),
    });
    if (!response.ok) throw new Error("DAS request failed");
    const data = object(await response.json());
    const result = object(data.result);
    if (data.error || !Array.isArray(result.items) || (Array.isArray(result.errors) && result.errors.length)) {
      throw new Error("DAS returned an incomplete or invalid asset response");
    }
    if (result.page !== undefined && result.page !== page) throw new Error("DAS returned the wrong page");
    const limit = result.limit === undefined ? PAGE_SIZE : result.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0 || limit > PAGE_SIZE || result.items.length > limit) {
      throw new Error("DAS returned an invalid page size");
    }
    let newIds = 0;
    for (const item of result.items) {
      const id = text(object(item).id);
      if (!id) throw new Error("DAS asset has no identifier");
      if (!seenIds.has(id)) { seenIds.add(id); newIds++; }
      const asset = normalizeAsset(item, owner, approved);
      if (asset) assets.set(asset.id, asset);
    }
    if (result.items.length && !newIds) throw new Error("DAS pagination did not advance");
    // `total` is a page count on some DAS providers, not the owner's total.
    if (result.items.length < limit) return [...assets.values()];
  }
  throw new Error("DAS inventory exceeds the discovery limit");
}
