import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { isAddress } from "@solana/kit";
import { NextResponse } from "next/server";
import type { DasAsset, DasAttribute } from "../../../lib/cards/collection";
import { discoverOwnedAssets } from "./discovery";

export const dynamic = "force-dynamic";

type Metadata = {
  name?: string;
  image?: string;
  attributes?: DasAttribute[];
};

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  if (!isAddress(owner)) {
    return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }

  const collectionId = process.env.DEVNET_TEST_COLLECTION_ID;
  // Opt in only with a DAS endpoint; ordinary Solana RPCs need not implement DAS.
  // Preserve the existing Core lookup when this integration is not configured.
  const dasRpc = process.env.DAS_RPC_URL;
  if (dasRpc) {
    const collections = (process.env.APPROVED_COLLECTION_IDS ?? collectionId ?? "")
      .split(/[\s,]+/).filter(Boolean);
    if (!collections.length || collections.some((id) => !isAddress(id))) {
      return NextResponse.json({ error: "Approved asset collections are not configured correctly" }, { status: 503 });
    }
    try {
      const assets = await discoverOwnedAssets(dasRpc, owner, collections);
      return NextResponse.json(assets, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "Could not discover wallet cards right now. Check the configured DAS endpoint and retry." }, { status: 502 });
    }
  }
  const assetIds = [process.env.DEVNET_TEST_PIKACHU_ASSET, process.env.DEVNET_TEST_CHARMANDER_ASSET];
  if (!collectionId || assetIds.some((id) => !id)) {
    return NextResponse.json({ error: "Devnet test assets are not configured" }, { status: 503 });
  }

  try {
    const umi = createUmi(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com").use(mplCore());
    const assets: DasAsset[] = [];
    for (const id of assetIds) {
      const asset = await fetchAsset(umi, publicKey(id!));
      if (asset.owner.toString() !== owner) continue;
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
