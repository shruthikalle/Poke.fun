import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { create, createCollection, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { createGenericFile, generateSigner, keypairIdentity, publicKey, sol } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";

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

const cards = [
  { owner: firstOwner, name: "Pikachu", number: "58/102", id: "base1-58", hue: "#f8ca58", icon: "P" },
  { owner: secondOwner, name: "Charmander", number: "46/102", id: "base1-46", hue: "#fa9a62", icon: "C" },
];

const umi = createUmi(rpcUrl, "confirmed")
  .use(mplCore())
  .use(irysUploader({ address: "https://devnet.irys.xyz" }));

for (const card of cards) publicKey(card.owner);

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

function svg(label, icon, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="880" viewBox="0 0 640 880"><rect width="640" height="880" rx="36" fill="#142232"/><rect x="25" y="25" width="590" height="830" rx="25" fill="${color}"/><rect x="52" y="52" width="536" height="776" rx="18" fill="#152332"/><text x="320" y="126" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="38" font-weight="bold">POKE.FUN TEST CARD</text><circle cx="320" cy="388" r="180" fill="${color}"/><text x="320" y="460" text-anchor="middle" fill="#152332" font-family="sans-serif" font-size="210" font-weight="bold">${icon}</text><text x="320" y="665" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="48" font-weight="bold">${label}</text><text x="320" y="745" text-anchor="middle" fill="#ffdb8f" font-family="sans-serif" font-size="33">DEVNET ONLY · NOT VAULTED</text></svg>`;
}

function imageFile(label, icon, color, filename) {
  return createGenericFile(new TextEncoder().encode(svg(label, icon, color)), filename, {
    contentType: "image/svg+xml",
    tags: [{ name: "Content-Type", value: "image/svg+xml" }],
  });
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

  const [collectionImage, firstImage, secondImage] = await umi.uploader.upload([
    imageFile("Test Collection", "★", "#83dbc6", "pokefun-test-collection.svg"),
    imageFile("Pikachu", "P", cards[0].hue, "pokefun-test-pikachu.svg"),
    imageFile("Charmander", "C", cards[1].hue, "pokefun-test-charmander.svg"),
  ]);

  if (!state.collection) {
    const uri = await umi.uploader.uploadJson({
      name: "Poke.fun Devnet Test Cards",
      description: "Fictional test assets for Poke.fun. No physical card or redemption rights.",
      image: collectionImage,
    });
    const collectionSigner = generateSigner(umi);
    console.log("Creating devnet test collection...");
    await createCollection(umi, { collection: collectionSigner, name: "Poke.fun Devnet Test Cards", uri }).sendAndConfirm(umi);
    state.collection = collectionSigner.publicKey;
    await saveState(state);
  }

  const collection = await fetchCollection(umi, publicKey(state.collection));
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (state.assets.some((asset) => asset.id === card.id && asset.owner === card.owner)) continue;
    const uri = await umi.uploader.uploadJson({
      name: `Poke.fun Devnet Test ${card.name}`,
      description: "Demo NFT only. This is not a vaulted collectible and has no physical redemption rights.",
      image: i === 0 ? firstImage : secondImage,
      attributes: [
        { trait_type: "Category", value: "Pokemon" },
        { trait_type: "Card Name", value: card.name },
        { trait_type: "Set", value: "Base Set" },
        { trait_type: "Card Number", value: card.number },
        { trait_type: "Test Asset", value: "Devnet only; not vaulted" },
      ],
    });
    const asset = generateSigner(umi);
    console.log(`Minting ${card.name} to ${card.owner}...`);
    await create(umi, {
      asset,
      collection,
      owner: publicKey(card.owner),
      name: `Poke.fun Devnet Test ${card.name}`,
      uri,
    }).sendAndConfirm(umi);
    state.assets.push({ id: card.id, owner: card.owner, address: asset.publicKey, metadataUri: uri });
    await saveState(state);
  }

  console.log(JSON.stringify({ collection: state.collection, assets: state.assets }, null, 2));
  console.log(`Mint state saved to ${statePath}. Payer keypair saved to ${payerPath}; keep it private.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
