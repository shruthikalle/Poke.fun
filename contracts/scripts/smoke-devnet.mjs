import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
if (!rpc.includes("devnet") && !process.env.POKEFUN_ALLOW_CUSTOM_DEVNET_RPC) throw new Error("Devnet RPC required");
const loadKey = (name) => {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
};
const payer = loadKey("POKEFUN_PAYER_KEYPAIR");
const referee = loadKey("POKEFUN_REFEREE_KEYPAIR");
const bob = Keypair.generate();
const connection = new Connection(rpc, "confirmed");
const idl = JSON.parse(readFileSync(new URL("../idl/pokefun_wager.json", import.meta.url)));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
const setup = await program.account.config.fetch(config);
assert.equal(setup.referee.toBase58(), referee.publicKey.toBase58());
const mint = setup.mint;
const payerToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
const bobToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, bob.publicKey)).address;
await mintTo(connection, payer, mint, payerToken, payer, 2_000_000);
await mintTo(connection, payer, mint, bobToken, payer, 2_000_000);
const fundSignature = await connection.sendTransaction(new anchor.web3.Transaction().add(
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: bob.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
), [payer]);
await connection.confirmTransaction(fundSignature, "confirmed");

const nonce = BigInt(Date.now());
const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(nonce);
const wager = PublicKey.findProgramAddressSync([Buffer.from("wager"), payer.publicKey.toBuffer(), nonceBytes], program.programId)[0];
const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), wager.toBuffer()], program.programId)[0];
const opened = await program.methods.openWager(new BN(nonce.toString()), new BN(1_000_000)).accountsStrict({
  maker: payer.publicKey, config, mint, wager, vault, makerToken: payerToken,
  tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
}).rpc();
assert.equal((await getAccount(connection, vault)).amount, 1_000_000n);
const reserved = await program.methods.reserveWager(bob.publicKey).accountsStrict({
  referee: referee.publicKey, config, wager,
}).signers([referee]).rpc();
const joined = await program.methods.joinWager().accountsStrict({
  opponent: bob.publicKey, wager, mint, vault, opponentToken: bobToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([bob]).rpc();
assert.equal((await getAccount(connection, vault)).amount, 2_000_000n);
const settled = await program.methods.settleWager(bob.publicKey).accountsStrict({
  referee: referee.publicKey, config, maker: payer.publicKey, wager, mint, vault,
  winnerToken: bobToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([referee]).rpc();
assert.equal((await getAccount(connection, bobToken)).amount, 3_000_000n);
assert.equal((await program.account.wager.fetch(wager)).winner.toBase58(), bob.publicKey.toBase58());
assert.equal(await connection.getAccountInfo(vault), null);
console.log(JSON.stringify({ wager: wager.toBase58(), opened, reserved, joined, settled, winner: bob.publicKey.toBase58(), amountWon: "2 test tokens" }, null, 2));
