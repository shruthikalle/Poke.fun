// End-to-end marketplace test against a local validator running the real
// Metaplex Core program. See contracts/README.md for the validator command.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { create, createCollection, fetchAsset, mplCore, transferV1 } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;
const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const idl = JSON.parse(readFileSync(new URL("../target/idl/pokefun_market.json", import.meta.url)));
const connection = new Connection(RPC, "confirmed");
const programId = new PublicKey(idl.address);

const [admin, treasury, alice, bob, carol, stranger] = Array.from({ length: 6 }, () => Keypair.generate());
const program = new Program(idl, new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" }));
const sol = (n) => new BN(Math.round(n * LAMPORTS_PER_SOL));
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const config = pda(Buffer.from("market"));
const authority = pda(Buffer.from("authority"));
const listingOf = (asset) => pda(Buffer.from("listing"), asset.toBuffer());
const offerOf = (asset, buyer) => pda(Buffer.from("offer"), asset.toBuffer(), buyer.toBuffer());
const tradeOf = (proposer, nonce) => pda(Buffer.from("trade"), proposer.toBuffer(), new BN(nonce).toArrayLike(Buffer, "le", 8));
const balance = (kp) => connection.getBalance(kp.publicKey ?? kp);
const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })];
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

async function rejects(promise, pattern, name) {
  await assert.rejects(promise, (e) => { const text = `${e.message} ${(e.logs ?? []).join(" ")}`; assert.match(text, pattern); return true; });
  ok(name);
}

for (const kp of [admin, alice, bob, carol, stranger]) {
  await connection.confirmTransaction(await connection.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL), "confirmed");
}
await connection.confirmTransaction(await connection.requestAirdrop(treasury.publicKey, LAMPORTS_PER_SOL), "confirmed");

// --- Core collection + cards ------------------------------------------------
const umi = createUmi(RPC, "confirmed").use(mplCore());
const umiSigner = (kp) => createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(kp.secretKey));
umi.use(keypairIdentity(umiSigner(admin)));
async function makeCollection(name) {
  const signer = generateSigner(umi);
  await createCollection(umi, { collection: signer, name, uri: "https://example.com/c.json" }).sendAndConfirm(umi);
  return new PublicKey(signer.publicKey);
}
const collection = await makeCollection("Test Cards");
const otherCollection = await makeCollection("Unapproved");
async function mint(owner, coll = collection) {
  const asset = generateSigner(umi);
  await create(umi, { asset, collection: { publicKey: publicKey(coll.toBase58()) }, name: "Card", uri: "https://example.com/a.json", owner: publicKey(owner.publicKey.toBase58()) }).sendAndConfirm(umi);
  return new PublicKey(asset.publicKey);
}
const [A1, A2, A3, A4, A5, A6, A7] = await Promise.all(Array.from({ length: 7 }, () => mint(alice)));
const [B1, B2] = await Promise.all([mint(bob), mint(bob)]);
const stray = await mint(alice, otherCollection);
const assetState = (id) => fetchAsset(umi, publicKey(id.toBase58()));
const ownerOf = async (id) => (await assetState(id)).owner.toString();
async function ownerTransfer(asset, from, to) {
  await transferV1(umi, { asset: publicKey(asset.toBase58()), collection: publicKey(collection.toBase58()), newOwner: publicKey(to.publicKey.toBase58()), authority: umiSigner(from), payer: umiSigner(from) }).sendAndConfirm(umi);
}

// --- instruction helpers ------------------------------------------------------
const coreAccounts = (asset) => ({ asset, collection, authority, coreProgram: CORE, systemProgram: SystemProgram.programId });
const list = (seller, asset, price, coll = collection) => program.methods.list(sol(price)).accountsStrict({
  seller: seller.publicKey, config, approved: pda(Buffer.from("collection"), coll.toBuffer()), listing: listingOf(asset), ...coreAccounts(asset), collection: coll,
}).signers([seller]).rpc();
const cancelListing = (seller, asset) => program.methods.cancelListing().accountsStrict({ seller: seller.publicKey, config, listing: listingOf(asset), ...coreAccounts(asset) }).signers([seller]).rpc();
const buy = (buyer, asset, sellerKey, price) => program.methods.buy(sol(price)).accountsStrict({
  buyer: buyer.publicKey, seller: sellerKey, treasury: treasury.publicKey, config, listing: listingOf(asset), ...coreAccounts(asset),
}).signers([buyer]).rpc();
const makeOffer = (buyer, asset, amount) => program.methods.makeOffer(sol(amount)).accountsStrict({
  buyer: buyer.publicKey, config, listing: listingOf(asset), offer: offerOf(asset, buyer.publicKey), systemProgram: SystemProgram.programId,
}).signers([buyer]).rpc();
const tradeCards = (keys) => keys.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }));
const propose = (proposer, counterparty, nonce, give, want, add) => program.methods.proposeTrade(new BN(nonce), give.length, sol(add)).accountsStrict({
  proposer: proposer.publicKey, counterparty: counterparty.publicKey, config, approved: pda(Buffer.from("collection"), collection.toBuffer()), collection,
  trade: tradeOf(proposer.publicKey, nonce), authority, coreProgram: CORE, systemProgram: SystemProgram.programId,
}).remainingAccounts(tradeCards([...give, ...want])).preInstructions(cu).signers([proposer]).rpc();
const closeTrade = (method, caller, proposer, nonce, give) => program.methods[method]().accountsStrict({
  caller: caller.publicKey, proposer: proposer.publicKey, config, trade: tradeOf(proposer.publicKey, nonce), collection, authority, coreProgram: CORE, systemProgram: SystemProgram.programId,
}).remainingAccounts(tradeCards(give)).preInstructions(cu).signers([caller]).rpc();

// --- admin ------------------------------------------------------------------------
console.log("admin");
await rejects(program.methods.initialize(1_001, treasury.publicKey).accountsStrict({ admin: admin.publicKey, config, authority, systemProgram: SystemProgram.programId }).rpc(), /FeeTooHigh/, "fee above 10% is rejected");
await program.methods.initialize(250, treasury.publicKey).accountsStrict({ admin: admin.publicKey, config, authority, systemProgram: SystemProgram.programId }).rpc();
await program.methods.addCollection().accountsStrict({ admin: admin.publicKey, config, collection, approved: pda(Buffer.from("collection"), collection.toBuffer()), systemProgram: SystemProgram.programId }).rpc();
await rejects(program.methods.addCollection().accountsStrict({ admin: stranger.publicKey, config, collection: otherCollection, approved: pda(Buffer.from("collection"), otherCollection.toBuffer()), systemProgram: SystemProgram.programId }).signers([stranger]).rpc(), /has_one|ConstraintHasOne|2001/, "only admin approves collections");
ok("initialized with 2.5% fee and one approved collection");

// --- listings -----------------------------------------------------------------------
console.log("listings");
await list(alice, A1, 1);
let a1 = await assetState(A1);
assert.equal(a1.owner.toString(), alice.publicKey.toBase58());
assert.equal(a1.freezeDelegate.frozen, true);
assert.equal(a1.freezeDelegate.authority.address.toString(), authority.toBase58());
assert.equal(a1.transferDelegate.authority.address.toString(), authority.toBase58());
ok("listed card stays in the seller's wallet, frozen and delegated to the program");
await rejects(ownerTransfer(A1, alice, carol), /frozen|Frozen|0x/i, "seller cannot move a listed card elsewhere");
await rejects(list(alice, A1, 2), /already in use|0x0/, "a card can only have one listing");
await rejects(list(bob, A2, 1), /NotOwner/, "cannot list a card you don't own");
await rejects(list(alice, stray, 1, otherCollection), /AccountNotInitialized|3012/, "cannot list from an unapproved collection");
await rejects(program.methods.updatePrice(sol(5)).accountsStrict({ seller: stranger.publicKey, listing: listingOf(A1) }).signers([stranger]).rpc(), /has_one|ConstraintHasOne|2001/, "only the seller changes the price");
await program.methods.updatePrice(sol(1.2)).accountsStrict({ seller: alice.publicKey, listing: listingOf(A1) }).signers([alice]).rpc();
await rejects(buy(bob, A1, alice.publicKey, 1), /PriceChanged/, "buy fails if the price changed under the buyer");
await rejects(buy(alice, A1, alice.publicKey, 1.2), /OwnListing/, "seller cannot buy their own listing");

const [aliceBefore, treasuryBefore, bobBefore] = await Promise.all([balance(alice), balance(treasury), balance(bob)]);
await buy(bob, A1, alice.publicKey, 1.2);
const [aliceAfter, treasuryAfter, bobAfter] = await Promise.all([balance(alice), balance(treasury), balance(bob)]);
assert.equal(await ownerOf(A1), bob.publicKey.toBase58());
assert.equal(treasuryAfter - treasuryBefore, 0.03 * LAMPORTS_PER_SOL);
assert.ok(aliceAfter - aliceBefore >= 1.17 * LAMPORTS_PER_SOL, "seller gets price minus fee plus listing rent");
assert.ok(bobBefore - bobAfter >= 1.2 * LAMPORTS_PER_SOL);
assert.equal(await connection.getAccountInfo(listingOf(A1)), null);
a1 = await assetState(A1);
assert.equal(a1.freezeDelegate?.frozen ?? false, false);
console.log(`    after sale: freeze=${JSON.stringify(a1.freezeDelegate?.authority)} transfer=${JSON.stringify(a1.transferDelegate?.authority)}`);
ok("buy pays seller 97.5%, treasury 2.5%, moves the card, closes the listing");

await list(bob, A1, 3);
assert.equal((await assetState(A1)).freezeDelegate.frozen, true);
ok("new owner can re-list a card that already has plugins");
await rejects(cancelListing(stranger, A1), /has_one|ConstraintHasOne|ConstraintSeeds|2001|2006/, "only the seller cancels");
await cancelListing(bob, A1);
a1 = await assetState(A1);
assert.equal(a1.freezeDelegate.frozen, false);
assert.equal(a1.freezeDelegate.authority.type, "Owner");
assert.equal(a1.transferDelegate.authority.type, "Owner");
await ownerTransfer(A1, bob, carol);
assert.equal(await ownerOf(A1), carol.publicKey.toBase58());
ok("cancel thaws the card and hands plugin authority back to the owner");

// --- offers -----------------------------------------------------------------------------
console.log("offers");
await list(alice, A2, 2);
await rejects(makeOffer(alice, A2, 1), /OwnListing/, "seller cannot offer on own listing");
const bobPre = await balance(bob);
await makeOffer(bob, A2, 1.5);
assert.ok(bobPre - (await balance(bob)) >= 1.5 * LAMPORTS_PER_SOL);
ok("offer escrows the buyer's SOL");
await rejects(makeOffer(bob, A2, 1.6), /already in use|0x0/, "one live offer per buyer per card");
const counter = (seller, asset, buyer, amount) => program.methods.counterOffer(sol(amount)).accountsStrict({ seller: seller.publicKey, listing: listingOf(asset), offer: offerOf(asset, buyer.publicKey) }).signers([seller]).rpc();
await rejects(counter(alice, A2, bob, 1.4), /CounterTooLow/, "counter must be above the offer");
await rejects(counter(stranger, A2, bob, 1.8), /has_one|ConstraintHasOne|2001/, "only the seller counters");
await counter(alice, A2, bob, 1.8);
const acceptCounter = (buyer, asset, sellerKey, amount) => program.methods.acceptCounter(sol(amount)).accountsStrict({
  buyer: buyer.publicKey, seller: sellerKey, treasury: treasury.publicKey, config, listing: listingOf(asset), offer: offerOf(asset, buyer.publicKey), ...coreAccounts(asset),
}).signers([buyer]).rpc();
await rejects(acceptCounter(bob, A2, alice.publicKey, 1.7), /PriceChanged/, "buyer accepts the exact counter only");
const t0 = await balance(treasury);
await acceptCounter(bob, A2, alice.publicKey, 1.8);
assert.equal(await ownerOf(A2), bob.publicKey.toBase58());
assert.equal((await balance(treasury)) - t0, 0.045 * LAMPORTS_PER_SOL);
ok("accepting a counter tops up the difference and completes the sale");

await list(alice, A3, 1);
await makeOffer(carol, A3, 0.8);
const carolPre = await balance(carol);
await program.methods.declineOffer().accountsStrict({ seller: alice.publicKey, listing: listingOf(A3), buyer: carol.publicKey, offer: offerOf(A3, carol.publicKey) }).signers([alice]).rpc();
assert.ok((await balance(carol)) - carolPre >= 0.8 * LAMPORTS_PER_SOL);
ok("declined offer refunds the buyer");

await makeOffer(carol, A3, 0.9);
const acceptOffer = (seller, asset, buyerKey) => program.methods.acceptOffer().accountsStrict({
  seller: seller.publicKey, buyer: buyerKey, treasury: treasury.publicKey, config, listing: listingOf(asset), offer: offerOf(asset, buyerKey), ...coreAccounts(asset),
}).signers([seller]).rpc();
await rejects(acceptOffer(stranger, A3, carol.publicKey), /has_one|ConstraintHasOne|2001/, "only the seller accepts an offer");
await acceptOffer(alice, A3, carol.publicKey);
assert.equal(await ownerOf(A3), carol.publicKey.toBase58());
ok("seller accepts an offer; card moves to the buyer");

await list(alice, A4, 1);
await makeOffer(bob, A4, 0.5);
const expireOffer = (caller, asset, buyerKey) => program.methods.expireOffer().accountsStrict({ caller: caller.publicKey, buyer: buyerKey, offer: offerOf(asset, buyerKey), listing: listingOf(asset) }).signers([caller]).rpc();
await rejects(expireOffer(stranger, A4, bob.publicKey), /NotExpired/, "live offers can't be expired early");
await cancelListing(alice, A4);
const bobPre2 = await balance(bob);
await expireOffer(stranger, A4, bob.publicKey);
assert.ok((await balance(bob)) - bobPre2 >= 0.5 * LAMPORTS_PER_SOL);
ok("anyone can refund an offer once its listing is gone");

await list(alice, A4, 1);
await makeOffer(carol, A4, 0.4);
await program.methods.cancelOffer().accountsStrict({ buyer: carol.publicKey, offer: offerOf(A4, carol.publicKey) }).signers([carol]).rpc();
await cancelListing(alice, A4);
ok("buyer can withdraw an offer");

// --- trades --------------------------------------------------------------------------------
console.log("trades");
await rejects(propose(alice, alice, 1, [A5], [A6], 0), /SelfTrade/, "cannot trade with yourself");
await rejects(propose(alice, bob, 1, [], [], 0), /BadTradeCards/, "a trade needs a wanted card");
await rejects(propose(alice, bob, 1, [], [B1], 0), /EmptyTrade/, "a trade needs something offered");
await rejects(propose(alice, bob, 1, [A5], [A6], 0), /CardMoved/, "wanted cards must belong to the counterparty");
const alicePre = await balance(alice);
await propose(alice, bob, 1, [A5], [B1], 0.1);
assert.equal((await assetState(A5)).freezeDelegate.frozen, true);
ok("proposal freezes the offered card and escrows the added SOL");
await rejects(list(alice, A5, 1), /AssetFrozen/, "a card committed to a trade can't also be listed");
await rejects(closeTrade("declineTrade", stranger, alice, 1, [A5]), /NotCounterparty/, "only the counterparty declines");
await closeTrade("declineTrade", bob, alice, 1, [A5]);
assert.equal((await assetState(A5)).freezeDelegate.frozen, false);
assert.ok((await balance(alice)) > alicePre - 0.01 * LAMPORTS_PER_SOL, "added SOL and rent refunded");
ok("decline releases the card and refunds the proposer");

await propose(alice, bob, 2, [A5, A6], [B1, B2], 0.25);
const bobPre3 = await balance(bob);
await program.methods.acceptTrade().accountsStrict({
  counterparty: bob.publicKey, proposer: alice.publicKey, config, trade: tradeOf(alice.publicKey, 2), collection, authority, coreProgram: CORE, systemProgram: SystemProgram.programId,
}).remainingAccounts(tradeCards([A5, A6, B1, B2])).preInstructions(cu).signers([bob]).rpc();
assert.deepEqual(await Promise.all([A5, A6].map(ownerOf)), [bob.publicKey.toBase58(), bob.publicKey.toBase58()]);
assert.deepEqual(await Promise.all([B1, B2].map(ownerOf)), [alice.publicKey.toBase58(), alice.publicKey.toBase58()]);
assert.ok((await balance(bob)) - bobPre3 >= 0.24 * LAMPORTS_PER_SOL);
ok("2-for-2 trade with added SOL swaps atomically");

await propose(alice, carol, 3, [A7], [A3], 0);
await rejects(closeTrade("expireTrade", stranger, alice, 3, [A7]), /NotExpired/, "live trades can't be expired early");
await closeTrade("cancelTrade", alice, alice, 3, [A7]);
await ownerTransfer(A7, alice, carol);
ok("proposer can cancel; card is free again");

console.log(`\n${passed} checks passed`);

const { verifyOnboarding } = await import("./onboarding.mjs");
await verifyOnboarding({ admin, program, collection, treasury, connection, RPC, BN });
