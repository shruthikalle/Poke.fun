import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { create, createCollection, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { generateSigner, keypairIdentity, publicKey, sol } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { cards, cardMetadata, collectionMetadata, imageFile } from "./card-metadata.mjs";

const [firstOwner, secondOwner] = process.argv.slice(2);
const rpcUrl = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const payerPath = process.env.POKEFUN_DEVNET_PAYER_PATH ?? "/private/tmp/pokefun-devnet-payer.json";
const statePath = process.env.POKEFUN_DEVNET_STATE_PATH ?? "/private/tmp/pokefun-devnet-mints.json";

if (!firstOwner || !secondOwner || firstOwner === secondOwner) {
  console.error("Usage: npm run mint:test-cards -- <first Solana wallet> <second Solana wallet>");
  process.exit(1);
}
if (!rpcUrl.includes("devnet")) {
  console.error("DEVNET_RPC_URL must point to Solana Devnet; refusing to mint on another network.");
  process.exit(1);
}

const recipients = [firstOwner, secondOwner];

const umi = createUmi(rpcUrl, "confirmed")
  .use(mplCore())
  .use(irysUploader({ address: "https://devnet.irys.xyz" }));

for (const owner of recipients) publicKey(owner);

async function loadOrCreatePayer() {
  try {
    const secret = JSON.parse(await readFile(payerPath, "utf8"));
    return umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const keypair = umi.eddsa.generateKeypair();
    await mkdir(dirname(payerPath), { recursive: true });
    await writeFile(payerPath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600, flag: "wx" });
    return keypair;
  }
}

async function saveState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function main() {
  const payer = await loadOrCreatePayer();
  umi.use(keypairIdentity(payer));
  console.log(`Devnet mint payer: ${payer.publicKey}`);

  const balance = await umi.rpc.getBalance(payer.publicKey);
  if (balance.basisPoints < 100_000_000n) {
    console.log("Requesting 1 devnet SOL for mint fees...");
    try {
      await umi.rpc.airdrop(payer.publicKey, sol(1));
    } catch {
      throw new Error(`The RPC faucet is unavailable. Request at least 0.1 devnet SOL for the temporary mint payer ${payer.publicKey} at https://faucet.solana.com/ and rerun this command.`);
    }
  }

  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.owners[0] !== firstOwner || state.owners[1] !== secondOwner) {
      throw new Error(`Existing mint state at ${statePath} belongs to different wallets`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { network: "devnet", owners: [firstOwner, secondOwner], collection: null, assets: [] };
  }

  if (!state.collection) {
    const [collectionImage] = await umi.uploader.upload([await imageFile("Test Collection", "★", "#83dbc6", "pokefun-test-collection.png")]);
    const uri = await umi.uploader.uploadJson(collectionMetadata(collectionImage));
    const collectionSigner = generateSigner(umi);
    console.log("Creating devnet test collection...");
    await createCollection(umi, { collection: collectionSigner, name: "Poke.fun Devnet Test Cards", uri }).sendAndConfirm(umi);
    state.collection = collectionSigner.publicKey;
    await saveState(state);
  }

  const collection = await fetchCollection(umi, publicKey(state.collection));
  for (const card of cards) {
    const owner = recipients[card.ownerIndex];
    if (state.assets.some((asset) => asset.id === card.id && asset.owner === owner)) continue;
    const image = card.image ?? (await umi.uploader.upload([await imageFile(card.name, card.icon, card.hue, `pokefun-test-${card.name.toLowerCase()}.png`)]))[0];
    const uri = await umi.uploader.uploadJson(cardMetadata(card, image));
    const asset = generateSigner(umi);
    console.log(`Minting ${card.name} to ${owner}...`);
    await create(umi, {
      asset,
      collection,
      owner: publicKey(owner),
      name: `Poke.fun Devnet Test ${card.name}`,
      uri,
    }).sendAndConfirm(umi);
    state.assets.push({ id: card.id, owner, address: asset.publicKey, metadataUri: uri });
    await saveState(state);
  }

  console.log(JSON.stringify({ collection: state.collection, assets: state.assets }, null, 2));
  console.log(`Mint state saved to ${statePath}. Payer keypair saved to ${payerPath}; keep it private.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
