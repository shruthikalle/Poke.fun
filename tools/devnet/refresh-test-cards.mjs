import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fetchAsset, fetchCollection, mplCore, update, updateCollection } from "@metaplex-foundation/mpl-core";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { cards, cardMetadata, collectionMetadata, imageFile } from "./card-metadata.mjs";

const rpcUrl = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const payerPath = process.env.POKEFUN_DEVNET_PAYER_PATH ?? "/private/tmp/pokefun-devnet-payer.json";
const statePath = process.env.POKEFUN_DEVNET_STATE_PATH ?? "/private/tmp/pokefun-devnet-mints.json";
if (!rpcUrl.includes("devnet")) throw new Error("DEVNET_RPC_URL must point to Solana Devnet.");

const state = JSON.parse(await readFile(statePath, "utf8"));
assert.equal(state.network, "devnet");
assert.equal(state.assets.length, cards.length);
const umi = createUmi(rpcUrl, "confirmed")
  .use(mplCore())
  .use(irysUploader({ address: "https://devnet.irys.xyz" }));
const secret = JSON.parse(await readFile(payerPath, "utf8"));
const payer = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
umi.use(keypairIdentity(payer));

const collection = await fetchCollection(umi, publicKey(state.collection));
assert.equal(collection.updateAuthority, payer.publicKey, "Mint payer must control the test collection");
for (let i = 0; i < cards.length; i++) {
  const record = state.assets.find((asset) => asset.id === cards[i].id && asset.owner === state.owners[cards[i].ownerIndex]);
  assert.ok(record, `Missing ${cards[i].id} in mint state`);
  assert.equal(record.owner, state.owners[cards[i].ownerIndex]);
  const asset = await fetchAsset(umi, publicKey(record.address));
  assert.equal(asset.owner, record.owner, `Owner changed for ${record.address}`);
  assert.equal(asset.updateAuthority.type, "Collection");
  assert.equal(asset.updateAuthority.address, state.collection);
}

const [collectionImage] = await umi.uploader.upload([await imageFile("Test Collection", "★", "#83dbc6", "pokefun-test-collection.png")]);
const collectionUri = await umi.uploader.uploadJson(collectionMetadata(collectionImage));
await updateCollection(umi, { collection: collection.publicKey, uri: collectionUri }).sendAndConfirm(umi);
state.collectionMetadataUri = collectionUri;
await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log(`Updated collection metadata: ${collection.publicKey}`);

for (let i = 0; i < cards.length; i++) {
  const record = state.assets.find((asset) => asset.id === cards[i].id && asset.owner === state.owners[cards[i].ownerIndex]);
  const asset = await fetchAsset(umi, publicKey(record.address));
  const card = cards[i];
  const image = card.image ?? (await umi.uploader.upload([await imageFile(card.name, card.icon, card.hue, `pokefun-test-${card.name.toLowerCase()}.png`)]))[0];
  const uri = await umi.uploader.uploadJson(cardMetadata(card, image));
  await update(umi, { asset, collection, uri }).sendAndConfirm(umi);
  record.metadataUri = uri;
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`Updated ${cards[i].name} metadata: ${asset.publicKey}`);
}
