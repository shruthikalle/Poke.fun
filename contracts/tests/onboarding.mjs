// Exercises the Go mint/faucet API and index against real Core and market programs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey as umiKey } from "@metaplex-foundation/umi";

export async function verifyOnboarding({ admin, program, collection, treasury, connection, RPC, BN }) {
  const dir = mkdtempSync(resolve(tmpdir(), "pokefun-onboarding-"));
  const repo = resolve(import.meta.dirname, "../..");
  const binary = resolve(dir, "api");
  const go = process.env.GO_BIN ?? "go";
  execFileSync(go, ["build", "-o", binary, "./cmd/server"], { cwd: resolve(repo, "services/api") });
  const port = process.env.MARKET_TEST_API_PORT ?? "18081";
  const base = `http://127.0.0.1:${port}`;
  let logs = "";
  const api = spawn(binary, [], { cwd: dir, env: {
    ...process.env, API_ADDR: `127.0.0.1:${port}`, MARKET_PROGRAM_ID: program.programId.toBase58(),
    MARKET_RPC_URL: RPC, DEVNET_RPC_URL: RPC, MARKET_MINT_COLLECTION: collection.toBase58(),
    MARKET_MINTER_KEYPAIR: JSON.stringify([...admin.secretKey]), MARKET_FAUCET_SOL: "0.25",
  }, stdio: ["ignore", "pipe", "pipe"] });
  api.stdout.on("data", (data) => { logs += data; });
  api.stderr.on("data", (data) => { logs += data; });
  const request = async (path, body) => {
    const response = await fetch(`${base}/api/market${path}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      if (i > 60 || api.exitCode !== null) throw new Error(`API failed to start: ${logs}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const seller = Keypair.generate(), buyer = Keypair.generate();
    const minted = await request("/mint", { owner: seller.publicKey.toBase58() });
    const asset = new PublicKey(minted.mint);
    const umi = createUmi(RPC, "confirmed").use(mplCore());
    assert.equal((await fetchAsset(umi, umiKey(minted.mint))).owner.toString(), seller.publicKey.toBase58());
    const grant = await request("/faucet", { owner: seller.publicKey.toBase58() });
    assert.equal(grant.lamports, 250_000_000);
    await request("/faucet", { owner: buyer.publicKey.toBase58() });
    const secondGrant = await fetch(`${base}/api/market/faucet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: buyer.publicKey.toBase58() }) });
    assert.equal(secondGrant.status, 409);
    const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
    const config = pda(Buffer.from("market")), authority = pda(Buffer.from("authority"));
    const listing = pda(Buffer.from("listing"), asset.toBuffer());
    const core = { config, authority, asset, collection, coreProgram: new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"), systemProgram: SystemProgram.programId };
    const price = new BN(10_000_000);
    await program.methods.list(price).accountsStrict({ seller: seller.publicKey, listing, approved: pda(Buffer.from("collection"), collection.toBuffer()), ...core }).signers([seller]).rpc();
    let snapshot = await request("/refresh", {});
    assert.ok(snapshot.listings.some((l) => l.mint === minted.mint && l.status === "active"));
    assert.ok(snapshot.cards.some((c) => c.mint === minted.mint && c.owner === seller.publicKey.toBase58()));
    await program.methods.buy(price).accountsStrict({ buyer: buyer.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, listing, ...core }).signers([buyer]).rpc();
    assert.equal((await fetchAsset(umi, umiKey(minted.mint))).owner.toString(), buyer.publicKey.toBase58());
    snapshot = await request("/refresh", {});
    assert.ok(snapshot.cards.some((c) => c.mint === minted.mint && c.owner === buyer.publicKey.toBase58()));
    const owned = await request(`/wallet/${buyer.publicKey.toBase58()}`);
    assert.ok(owned.cards.some((c) => c.mint === minted.mint));
    const former = await request(`/wallet/${seller.publicKey.toBase58()}`);
    assert.ok(!former.cards.some((c) => c.mint === minted.mint));
    assert.ok(snapshot.sales.some((s) => s.mint === minted.mint && s.buyer === buyer.publicKey.toBase58()));
    console.log("  ✓ API mint → faucet → list → buy → on-chain ownership → buyer collection and sale history");
  } finally {
    api.kill("SIGTERM");
    if (api.exitCode === null) await once(api, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
}
