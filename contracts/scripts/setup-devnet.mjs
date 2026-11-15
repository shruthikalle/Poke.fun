import { existsSync, readFileSync, writeFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, Program, Wallet } = anchor;
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
if (!rpc.includes("devnet") && !process.env.POKEFUN_ALLOW_CUSTOM_DEVNET_RPC) {
  throw new Error("Refusing to configure a non-Devnet RPC");
}
const payerPath = process.env.POKEFUN_PAYER_KEYPAIR;
const refereePath = process.env.POKEFUN_REFEREE_KEYPAIR;
if (!payerPath || !refereePath) {
  throw new Error("Set POKEFUN_PAYER_KEYPAIR and POKEFUN_REFEREE_KEYPAIR to local keypair paths");
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
const connection = new Connection(rpc, "confirmed");
const idl = JSON.parse(readFileSync(new URL("../idl/pokefun_wager.json", import.meta.url)));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
if (await connection.getAccountInfo(config)) {
  throw new Error(`Already initialized: ${config}. Use the existing mint and referee; config is immutable.`);
}
if (existsSync(refereePath)) {
  throw new Error(`Referee keypair path already exists: ${refereePath}`);
}
const referee = Keypair.generate();
writeFileSync(refereePath, JSON.stringify(Array.from(referee.secretKey)), { mode: 0o600, flag: "wx" });
const mint = await createMint(connection, payer, payer.publicKey, null, 6);
const initSignature = await program.methods.initialize(referee.publicKey).accountsStrict({
  admin: payer.publicKey, config, mint, systemProgram: SystemProgram.programId,
}).rpc();
console.log(JSON.stringify({ program: program.programId.toBase58(), config: config.toBase58(), mint: mint.toBase58(), referee: referee.publicKey.toBase58(), initSignature }, null, 2));

for (const address of process.argv.slice(2)) {
  const owner = new PublicKey(address);
  const token = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
  const signature = await mintTo(connection, payer, mint, token.address, payer, 10_000_000);
  console.log(JSON.stringify({ owner: address, tokenAccount: token.address.toBase58(), amount: "10 test tokens", signature }));
}
