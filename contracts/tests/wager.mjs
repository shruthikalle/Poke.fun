import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;

const idl = JSON.parse(readFileSync(new URL("../target/idl/pokefun_wager.json", import.meta.url)));
const connection = new Connection(process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const programId = new PublicKey(idl.address);
const admin = Keypair.generate();
const referee = Keypair.generate();
const alice = Keypair.generate();
const bob = Keypair.generate();
const stranger = Keypair.generate();
const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
const program = new Program(idl, provider);

async function fund(keypair) {
  const signature = await connection.requestAirdrop(keypair.publicKey, 2_000_000_000);
  await connection.confirmTransaction(signature, "confirmed");
}

function wagerAddress(maker, nonce) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync([Buffer.from("wager"), maker.toBuffer(), bytes], programId)[0];
}

function vaultAddress(wager) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), wager.toBuffer()], programId)[0];
}

const config = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];

await Promise.all([admin, referee, alice, bob, stranger].map(fund));
const mint = await createMint(connection, admin, admin.publicKey, null, 6);
const aliceToken = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, alice.publicKey)).address;
const bobToken = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, bob.publicKey)).address;
const strangerToken = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, stranger.publicKey)).address;
await mintTo(connection, admin, mint, aliceToken, admin, 3_000_000);
await mintTo(connection, admin, mint, bobToken, admin, 3_000_000);
await mintTo(connection, admin, mint, strangerToken, admin, 3_000_000);

await program.methods.initialize(referee.publicKey).accountsStrict({
  admin: admin.publicKey, config, mint, systemProgram: SystemProgram.programId,
}).rpc();

async function open(nonce) {
  const wager = wagerAddress(alice.publicKey, nonce);
  const vault = vaultAddress(wager);
  await program.methods.openWager(new BN(nonce), new BN(1_000_000)).accountsStrict({
    maker: alice.publicKey, config, mint, wager, vault, makerToken: aliceToken,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).signers([alice]).rpc();
  assert.equal((await getAccount(connection, vault)).amount, 1_000_000n);
  return { wager, vault };
}

const first = await open(1);
await program.methods.reserveWager(bob.publicKey).accountsStrict({
  referee: referee.publicKey, config, wager: first.wager,
}).signers([referee]).rpc();

await assert.rejects(() => program.methods.joinWager().accountsStrict({
  opponent: stranger.publicKey, wager: first.wager, mint, vault: first.vault,
  opponentToken: strangerToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([stranger]).rpc(), /Only the reserved opponent can join|WrongOpponent|0x/);
assert.equal((await getAccount(connection, first.vault)).amount, 1_000_000n);

await program.methods.joinWager().accountsStrict({
  opponent: bob.publicKey, wager: first.wager, mint, vault: first.vault,
  opponentToken: bobToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([bob]).rpc();
assert.equal((await getAccount(connection, first.vault)).amount, 2_000_000n);

await assert.rejects(() => program.methods.cancelWager().accountsStrict({
  maker: alice.publicKey, wager: first.wager, mint, vault: first.vault,
  makerToken: aliceToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([alice]).rpc());
await assert.rejects(() => program.methods.settleWager(stranger.publicKey).accountsStrict({
  referee: referee.publicKey, config, maker: alice.publicKey, wager: first.wager, mint,
  vault: first.vault, winnerToken: strangerToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([referee]).rpc());
await assert.rejects(() => program.methods.settleWager(bob.publicKey).accountsStrict({
  referee: stranger.publicKey, config, maker: alice.publicKey, wager: first.wager, mint,
  vault: first.vault, winnerToken: bobToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([stranger]).rpc());
assert.equal((await getAccount(connection, first.vault)).amount, 2_000_000n);

await program.methods.settleWager(bob.publicKey).accountsStrict({
  referee: referee.publicKey, config, maker: alice.publicKey, wager: first.wager, mint,
  vault: first.vault, winnerToken: bobToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([referee]).rpc();
assert.equal((await getAccount(connection, bobToken)).amount, 4_000_000n);
const settled = await program.account.wager.fetch(first.wager);
assert.equal(settled.state.settled !== undefined, true);
assert.equal(settled.winner.toBase58(), bob.publicKey.toBase58());
assert.equal(await connection.getAccountInfo(first.vault), null);

const second = await open(2);
await program.methods.cancelWager().accountsStrict({
  maker: alice.publicKey, wager: second.wager, mint, vault: second.vault,
  makerToken: aliceToken, tokenProgram: TOKEN_PROGRAM_ID,
}).signers([alice]).rpc();
assert.equal((await getAccount(connection, aliceToken)).amount, 2_000_000n);
assert.equal(await connection.getAccountInfo(second.vault), null);

console.log("Local validator: deposits, opponent restriction, unauthorized settlement, payout, and cancellation passed");
