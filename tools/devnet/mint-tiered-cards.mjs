import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { create, fetchAsset, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { generateSigner, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { cardMetadata } from "./card-metadata.mjs";

const owners = process.argv.slice(2);
if (owners.length !== 2 || owners[0] === owners[1]) {
  throw new Error("Usage: npm run mint:tiered-cards -- <first Solana wallet> <second Solana wallet>");
}
owners.forEach(publicKey);

const rpcUrl = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
if (!rpcUrl.includes("devnet")) throw new Error("DEVNET_RPC_URL must point to Solana Devnet.");
const payerPath = process.env.POKEFUN_DEVNET_PAYER_PATH ?? "/private/tmp/pokefun-devnet-payer.json";
const originalStatePath = process.env.POKEFUN_DEVNET_STATE_PATH ?? "/private/tmp/pokefun-devnet-mints.json";
const batchPath = process.env.POKEFUN_DEVNET_BATCH_PATH ?? "/private/tmp/pokefun-devnet-tiered-2026-11-15.json";

const catalog = JSON.parse(await readFile(new URL("../../apps/web/lib/cards/catalog.generated.json", import.meta.url), "utf8"));
const original = JSON.parse(await readFile(originalStatePath, "utf8"));
assert.equal(original.network, "devnet");

const roster = [
  ["base1-58", "base1-46", "base1-6", "base1-12", "base1-4", "base1-2"],
  ["base1-58", "base1-46", "base1-14", "base1-18", "base1-15", "base1-16"],
];
const cards = roster.flatMap((ids, ownerIndex) => ids.map((id, index) => {
  const entry = catalog.entries.find((item) => item.id === id);
  assert.ok(entry, `Missing catalog card ${id}`);
  assert.equal(entry.tier, Math.floor(index / 2) + 1, `Unexpected tier for ${id}`);
  return { ...entry, ownerIndex };
}));

const umi = createUmi(rpcUrl, "confirmed")
  .use(mplCore())
  .use(irysUploader({ address: "https://devnet.irys.xyz" }));
const secret = JSON.parse(await readFile(payerPath, "utf8"));
const payer = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
umi.use(keypairIdentity(payer));
const collection = await fetchCollection(umi, publicKey(original.collection));
assert.equal(collection.updateAuthority, payer.publicKey, "Mint payer must control the test collection");

let state;
try {
  state = JSON.parse(await readFile(batchPath, "utf8"));
  assert.deepEqual(state.owners, owners, "Existing batch state belongs to different wallets");
  assert.equal(state.collection, original.collection);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { network: "devnet", collection: original.collection, owners, assets: [] };
}

for (const card of cards) {
  const owner = owners[card.ownerIndex];
  const existing = state.assets.find((asset) => asset.id === card.id && asset.owner === owner);
  if (existing) {
    const asset = await fetchAsset(umi, publicKey(existing.address));
    assert.equal(asset.owner, owner, `Previously minted ${card.id} changed owners`);
    continue;
  }

  const metadata = cardMetadata({ ...card, number: `${card.number}/102` }, card.image);
  metadata.attributes.push({ trait_type: "Power Tier", value: String(card.tier) });
  const uri = await umi.uploader.uploadJson(metadata);
  const asset = generateSigner(umi);
  console.log(`Minting tier ${card.tier} ${card.name} to ${owner}...`);
  await create(umi, {
    asset,
    collection,
    owner: publicKey(owner),
    name: `Poke.fun Devnet Test ${card.name}`,
    uri,
  }).sendAndConfirm(umi);
  state.assets.push({ id: card.id, tier: card.tier, name: card.name, owner, address: asset.publicKey, metadataUri: uri });
  await writeFile(batchPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`Explorer: https://explorer.solana.com/address/${asset.publicKey}?cluster=devnet`);
}

console.log(`Minted ${state.assets.length} tiered cards. Public addresses saved to ${batchPath}.`);
