import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchAsset, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

const statePath = process.env.POKEFUN_DEVNET_STATE_PATH ?? "/private/tmp/pokefun-devnet-mints.json";
const state = JSON.parse(await readFile(statePath, "utf8"));
const umi = createUmi(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com").use(mplCore());

const collection = await fetchCollection(umi, publicKey(state.collection));
assert.equal(collection.publicKey, state.collection);
const collectionResponse = await fetch(collection.uri);
assert.equal(collectionResponse.ok, true);
const collectionMetadata = await collectionResponse.json();
assert.equal(collectionMetadata.symbol, "POKEFUN");
assert.equal(collectionMetadata.properties?.files?.[0]?.uri, collectionMetadata.image);
assert.equal(collectionMetadata.properties?.files?.[0]?.type, "image/png");
console.log(`Collection verified: ${collection.publicKey}`);

for (const expected of state.assets) {
  const asset = await fetchAsset(umi, publicKey(expected.address));
  assert.equal(asset.owner, expected.owner);
  assert.equal(asset.updateAuthority.type, "Collection");
  assert.equal(asset.updateAuthority.address, state.collection);
  const response = await fetch(asset.uri);
  assert.equal(response.ok, true, `Metadata missing for ${expected.address}`);
  const metadata = await response.json();
  assert.equal(metadata.attributes?.some((a) => a.trait_type === "Test Asset"), true);
  assert.equal(metadata.symbol, "POKEFUN");
  assert.equal(metadata.category, "image");
  assert.equal(metadata.properties?.files?.[0]?.uri, metadata.image);
  assert.equal(metadata.properties?.files?.[0]?.type, "image/png");
  const imageResponse = await fetch(metadata.image);
  assert.equal(imageResponse.ok, true, `Image missing for ${expected.address}`);
  assert.match(imageResponse.headers.get("content-type") ?? "", /^image\/png/);
  console.log(`${expected.id}: ${asset.publicKey} owned by ${asset.owner}; metadata verified`);
}
