import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { NextResponse } from "next/server";
import type { DasAsset, DasAttribute } from "../../../lib/cards/collection";

export const dynamic = "force-dynamic";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Metadata = {
  name?: string;
  image?: string;
  attributes?: DasAttribute[];
};

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  if (!BASE58.test(owner)) {
    return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }

  const collectionId = process.env.DEVNET_TEST_COLLECTION_ID;
  const assetIds = [process.env.DEVNET_TEST_PIKACHU_ASSET, process.env.DEVNET_TEST_CHARMANDER_ASSET];
  if (!collectionId || assetIds.some((id) => !id)) {
    return NextResponse.json({ error: "Devnet test assets are not configured" }, { status: 503 });
  }

  try {
    const umi = createUmi(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com").use(mplCore());
    const assets: DasAsset[] = [];
    for (const id of assetIds) {
      const asset = await fetchAsset(umi, publicKey(id!));
      if (asset.owner !== owner) continue;
      if (asset.updateAuthority.type !== "Collection" || asset.updateAuthority.address !== collectionId) continue;

      const response = await fetch(asset.uri, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
      const metadata = await response.json() as Metadata;
      if (!Array.isArray(metadata.attributes)) throw new Error("Test NFT metadata has no attributes");
      assets.push({
        id: asset.publicKey,
        interface: "MplCoreAsset",
        content: {
          metadata: { name: metadata.name ?? asset.name, attributes: metadata.attributes },
          links: { image: metadata.image ?? "" },
        },
        grouping: [{ group_key: "collection", group_value: collectionId }],
        ownership: { owner: asset.owner, frozen: false },
      });
    }
    return NextResponse.json(assets, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Devnet card lookup failed:", error);
    return NextResponse.json({ error: "Could not verify devnet cards right now" }, { status: 502 });
  }
}
