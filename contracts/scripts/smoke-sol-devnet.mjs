import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
if (!rpc.includes("devnet") && !process.env.POKEFUN_ALLOW_CUSTOM_DEVNET_RPC) throw new Error("Devnet RPC required");
function keypair(name) {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const payer = keypair("POKEFUN_PAYER_KEYPAIR");
const referee = keypair("POKEFUN_REFEREE_KEYPAIR");
const opponent = Keypair.generate();
const connection = new Connection(rpc, "confirmed");
const idl = JSON.parse(readFileSync(new URL("../idl/pokefun_wager.json", import.meta.url)));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
const setup = await program.account.config.fetch(config);
assert.equal(setup.referee.toBase58(), referee.publicKey.toBase58());
const nonce = BigInt(Date.now());
const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(nonce);
const wager = PublicKey.findProgramAddressSync([Buffer.from("wager"), payer.publicKey.toBuffer(), nonceBytes], program.programId)[0];
const stake = 10_000_000; // 0.01 Devnet SOL per player.
const funded = await connection.sendTransaction(new Transaction().add(
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: opponent.publicKey, lamports: 30_000_000 }),
), [payer]);
await connection.confirmTransaction(funded, "confirmed");
const opened = await program.methods.openSolWager(new BN(nonce.toString()), new BN(stake)).accountsStrict({
  maker: payer.publicKey, wager, systemProgram: SystemProgram.programId,
}).rpc();
const rent = await connection.getMinimumBalanceForRentExemption(162);
assert.equal((await connection.getAccountInfo(wager)).lamports, rent + stake);
const reserved = await program.methods.reserveWager(opponent.publicKey).accountsStrict({
  referee: referee.publicKey, config, wager,
}).signers([referee]).rpc();
const joined = await program.methods.joinSolWager().accountsStrict({
  opponent: opponent.publicKey, wager, systemProgram: SystemProgram.programId,
}).signers([opponent]).rpc();
assert.equal((await connection.getAccountInfo(wager)).lamports, rent + 2 * stake);
const beforePayout = await connection.getBalance(opponent.publicKey);
const settled = await program.methods.settleSolWager(opponent.publicKey).accountsStrict({
  referee: referee.publicKey, config, maker: payer.publicKey, wager, winner: opponent.publicKey,
}).signers([referee]).rpc();
assert.equal((await connection.getBalance(opponent.publicKey)) - beforePayout, 2 * stake);
assert.equal(await connection.getAccountInfo(wager), null);
console.log(JSON.stringify({ wager: wager.toBase58(), opened, reserved, joined, settled, winner: opponent.publicKey.toBase58(), payoutSol: 2 * stake / LAMPORTS_PER_SOL }, null, 2));
