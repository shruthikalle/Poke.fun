// Initializes the pokefun_market program and approves a Metaplex Core collection.
//
//   node scripts/setup-market.mjs --rpc https://api.devnet.solana.com --collection <COLLECTION>
//   node scripts/setup-market.mjs --rpc http://127.0.0.1:8899 --demo <OWNER_A>,<OWNER_B>   # localnet: new collection + 4 cards each
//
// --demo-uris <file.json> maps card names to metadata URIs (e.g. the devnet test cards' Irys
// metadata) so demo cards show real art; its entries are dealt out to the owners in turn.
//
//   node scripts/setup-market.mjs --rpc https://api.devnet.solana.com --create-collection "Poke.fun Devnet Cards"
//     creates a Core collection whose update authority is the admin keypair (the API's
//     MARKET_MINTER_KEYPAIR, which mints free cards into it) and approves it for trading.
//
// Options: --admin <keypair.json> (default ~/.config/solana/id.json, also the fee treasury unless --treasury),
// --fee-bps 250. Safe to re-run: existing config and approvals are left alone.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import anchor from "@coral-xyz/anchor";
import { create, createCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, Program, Wallet } = anchor;
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const rpc = args.rpc ?? "http://127.0.0.1:8899";
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(args.admin ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const idl = JSON.parse(readFileSync(new URL("../idl/pokefun_market.json", import.meta.url)));
if (args.program) idl.address = args.program;
const connection = new Connection(rpc, "confirmed");
const program = new Program(idl, new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" }));
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const config = pda(Buffer.from("market"));
const authority = pda(Buffer.from("authority"));

console.log(`program ${program.programId.toBase58()} on ${rpc}; admin ${admin.publicKey.toBase58()}`);
if (!(await connection.getAccountInfo(config))) {
  const treasury = new PublicKey(args.treasury ?? admin.publicKey);
  await program.methods.initialize(Number(args["fee-bps"] ?? 250), treasury).accountsStrict({ admin: admin.publicKey, config, authority, systemProgram: SystemProgram.programId }).rpc();
  console.log(`initialized: fee ${args["fee-bps"] ?? 250} bps, treasury ${treasury.toBase58()}`);
} else {
  console.log("already initialized");
}

let collection = args.collection ? new PublicKey(args.collection) : null;
if (args["create-collection"]) {
  const umi = createUmi(rpc, "confirmed").use(mplCore());
  umi.use(keypairIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(admin.secretKey))));
  const signer = generateSigner(umi);
  await createCollection(umi, { collection: signer, name: args["create-collection"], uri: args["collection-uri"] ?? "https://gateway.irys.xyz/BLDDaHRTbehCarf56obFeFCWKmbBAZiaih4vahufusYm" }).sendAndConfirm(umi);
  collection = new PublicKey(signer.publicKey);
  console.log(`created collection ${collection.toBase58()} (update authority ${admin.publicKey.toBase58()})`);
}
if (args.demo) {
  if (args["create-collection"]) throw new Error("use --demo or --create-collection, not both");
  const umi = createUmi(rpc, "confirmed").use(mplCore());
  umi.use(keypairIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(admin.secretKey))));
  const signer = generateSigner(umi);
  await createCollection(umi, { collection: signer, name: "Poke.fun Local Test Cards", uri: "https://example.com/collection.json" }).sendAndConfirm(umi);
  collection = new PublicKey(signer.publicKey);
  const owners = args.demo.split(",");
  const uris = args["demo-uris"] ? Object.entries(JSON.parse(readFileSync(args["demo-uris"], "utf8"))) : null;
  const deck = uris ?? ["Charizard", "Blastoise", "Venusaur", "Pikachu"].flatMap((name) => owners.map(() => [name, "https://example.com/card.json"]));
  for (const [i, [name, uri]] of deck.entries()) {
    const owner = owners[i % owners.length];
    const asset = generateSigner(umi);
    await create(umi, { asset, collection: { publicKey: signer.publicKey }, name, uri, owner: publicKey(owner) }).sendAndConfirm(umi);
    console.log(`minted ${name} ${asset.publicKey} -> ${owner}`);
  }
}
if (collection) {
  const approved = pda(Buffer.from("collection"), collection.toBuffer());
  if (!(await connection.getAccountInfo(approved))) {
    await program.methods.addCollection().accountsStrict({ admin: admin.publicKey, config, collection, approved, systemProgram: SystemProgram.programId }).rpc();
    console.log(`approved collection ${collection.toBase58()}`);
  } else {
    console.log(`collection ${collection.toBase58()} already approved`);
  }
}
