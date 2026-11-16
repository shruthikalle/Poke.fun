import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "./pokefun_wager.json";
import { findCatalogEntry } from "../cards/mapping";
import { speciesForCardName } from "../cards/cardNames";

const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const API = process.env.ARENA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const CONFIG = new PublicKey("8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S");
type Stage = "waiting" | "open_required" | "awaiting_open" | "join_required" | "awaiting_join" | "cancel_required" | "matched" | "cancelled";
export type PaidTicket = { id: string; token: string; status: Stage; stakeLamports: number; opponent?: string; wager?: string; openTx?: string; joinTx?: string; settlementTx?: string; arena?: { id: string; token: string; stakeLamports: number; wager: string; makerAddress: string; opponentAddress: string; expiresAt: number } };
type Entry = PaidTicket & { address: string; name: string; cardId: string; assetId: string; rating: number; tier: number; created: number; peer?: string; maker?: boolean; busy?: boolean };
const globalState = globalThis as typeof globalThis & { pokeFunPaidQueue?: Map<string, Entry>; pokeFunPaidWorkers?: Set<string> };
const entries = globalState.pokeFunPaidQueue ??= new Map<string, Entry>();
const workers = globalState.pokeFunPaidWorkers ??= new Set<string>();
const connection = new Connection(DEVNET_RPC, "confirmed");

function refereeProgram() {
  const path = process.env.POKEFUN_REFEREE_KEYPAIR;
  if (!path) throw new Error("Devnet wager referee is not configured");
  const referee = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([referee]);
    else tx.partialSign(referee);
    return tx;
  };
  const wallet: Wallet = { publicKey: referee.publicKey, payer: referee, signTransaction: async (tx) => sign(tx), signAllTransactions: async (txs) => txs.map(sign) };
  const program = new Program(idl as Idl, new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
  return { referee, program };
}

async function verifiedCard(entry: Pick<Entry, "address" | "cardId" | "assetId">) {
  const response = await fetch(`${API}/api/collectibles/${encodeURIComponent(entry.assetId)}?owner=${encodeURIComponent(entry.address)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify this card is still owned by your wallet");
  const card = await response.json() as { attributes?: { trait_type: string; value: string }[] };
  const attribute = (name: string) => card.attributes?.find((a) => a.trait_type === name)?.value;
  const species = findCatalogEntry(attribute("Set"), attribute("Card Number"))?.species
    ?? speciesForCardName(attribute("Card Name") ?? "")?.key;
  if (attribute("Category") !== "Pokemon" || species !== entry.cardId) throw new Error("Card does not match selected fighter");
}

async function fighterTier(cardId: string) {
  const response = await fetch(`${API}/api/arena-cards?ids=${encodeURIComponent(cardId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify this fighter with the arena server");
  const cards = await response.json() as { id: string; tier: number }[];
  const fighter = cards.find((card) => card.id === cardId);
  if (!fighter || ![1, 2, 3].includes(fighter.tier)) throw new Error("This Pokémon is not supported in the live arena");
  return fighter.tier;
}

async function readWager(address: string) {
  const { program } = refereeProgram();
  const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info || !info.owner.equals(program.programId)) throw new Error("Wager account not found on Devnet");
  const account = program.coder.accounts.decode("wager", info.data) as {
    maker: PublicKey; opponent: PublicKey; mint: PublicKey; stake: { toNumber(): number }; state: Record<string, unknown>; deadline: { toNumber(): number };
  };
  if (!account.mint.equals(PublicKey.default) || account.deadline.toNumber() <= Date.now() / 1000) throw new Error("Wager is not an active Devnet SOL escrow");
  return account;
}

async function arenaCall<T>(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Arena server rejected match");
  return result as T;
}

export async function enterPaidQueue(address: string, input: { name: string; cardId: string; assetId: string; rating: number; stakeLamports: number }): Promise<PaidTicket> {
  refereeProgram();
  if (!input.name?.trim() || input.name.length > 24 || /[\x00-\x1f\x7f]/.test(input.name) || !/^[a-z0-9-]{1,80}$/.test(input.cardId) || !Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5000 || !Number.isInteger(input.stakeLamports) || input.stakeLamports < 1_000_000 || input.stakeLamports > 1_000_000_000) throw new Error("Invalid paid match request");
  new PublicKey(address);
  new PublicKey(input.assetId);
  if ([...entries.values()].some((e) => e.address === address && e.status !== "cancelled" && !(e.status === "matched" && e.settlementTx))) throw new Error("This wallet already has an active SOL match");
  await verifiedCard({ address, cardId: input.cardId, assetId: input.assetId });
  const tier = await fighterTier(input.cardId);
  const id = randomBytes(12).toString("hex");
  const entry: Entry = { ...input, tier, id, token: randomBytes(32).toString("base64url"), address, status: "waiting", created: Date.now() };
  entries.set(id, entry);
  const candidates = [...entries.values()].filter((e) => e.id !== id && e.status === "waiting" && e.address !== address && e.name.toLowerCase() !== entry.name.toLowerCase() && e.tier === tier && e.stakeLamports === entry.stakeLamports);
  candidates.sort((a, b) => Math.abs(a.rating - entry.rating) - Math.abs(b.rating - entry.rating) || a.created - b.created);
  const maker = candidates[0];
  if (maker) {
    maker.peer = entry.id; entry.peer = maker.id; maker.maker = true; entry.maker = false;
    maker.status = "open_required"; entry.status = "awaiting_open";
    maker.opponent = entry.name; entry.opponent = maker.name;
  }
  return publicTicket(entry);
}

function publicTicket(entry: Entry): PaidTicket {
  const { id, token, status, stakeLamports, opponent, wager, openTx, joinTx, settlementTx, arena } = entry;
  return { id, token, status, stakeLamports, opponent, wager, openTx, joinTx, settlementTx, arena };
}

export function getPaidTicket(id: string, token: string, address: string) {
  const entry = entries.get(id);
  if (!entry || entry.token !== token || entry.address !== address) throw new Error("Paid queue ticket not found");
  return entry;
}

export function paidStatus(entry: Entry): PaidTicket {
  if (entry.status === "matched" && entry.wager && !entry.settlementTx) void settleWhenFinished(entry.maker ? entry.id : entry.peer!);
  return publicTicket(entry);
}

export async function confirmOpen(entry: Entry, wagerAddress: string, signature: string) {
  if (entry.status !== "open_required" || entry.busy || !entry.peer) throw new Error("Match is not ready for this deposit");
  entry.busy = true;
  try {
    const peer = entries.get(entry.peer);
    if (!peer || peer.status !== "awaiting_open") throw new Error("Opponent left the queue");
    await verifiedCard(entry);
    await verifiedCard(peer);
    const wager = await readWager(wagerAddress);
    if (!wager.maker.equals(new PublicKey(entry.address)) || wager.stake.toNumber() !== entry.stakeLamports || !("waiting" in wager.state)) throw new Error("Deposit does not match this queue ticket");
    const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!transaction || transaction.meta?.err || !transaction.transaction.message.getAccountKeys().staticAccountKeys.some((key: PublicKey) => key.equals(new PublicKey(wagerAddress)))) throw new Error("Deposit transaction is not confirmed");
    const { program, referee } = refereeProgram();
    await program.methods.reserveWager(new PublicKey(peer.address)).accountsStrict({ referee: referee.publicKey, config: CONFIG, wager: new PublicKey(wagerAddress) }).signers([referee]).rpc();
    entry.wager = peer.wager = wagerAddress;
    entry.openTx = peer.openTx = signature;
    entry.status = "awaiting_join"; peer.status = "join_required";
    return publicTicket(entry);
  } finally { entry.busy = false; }
}

export async function confirmJoin(entry: Entry, signature: string) {
  if (entry.status !== "join_required" || entry.busy || !entry.peer || !entry.wager) throw new Error("Match is not ready for your deposit");
  entry.busy = true;
  try {
    const maker = entries.get(entry.peer);
    if (!maker || maker.status !== "awaiting_join" || maker.wager !== entry.wager) throw new Error("Opponent left the queue");
    const wager = await readWager(entry.wager);
    if (!wager.maker.equals(new PublicKey(maker.address)) || !wager.opponent.equals(new PublicKey(entry.address)) || wager.stake.toNumber() !== entry.stakeLamports || !("playing" in wager.state)) throw new Error("Second deposit is not confirmed in escrow");
    const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!transaction || transaction.meta?.err || !transaction.transaction.message.getAccountKeys().staticAccountKeys.some((key: PublicKey) => key.equals(new PublicKey(entry.wager!)))) throw new Error("Join transaction is not confirmed");
    await verifiedCard(maker);
    await verifiedCard(entry);
    const first = await arenaCall<{ id: string; token: string }>("/api/arenas", { name: maker.name, cardId: maker.cardId, assetId: maker.assetId, walletAddress: maker.address, rental: false });
    const second = await arenaCall<{ id: string; token: string }>(`/api/arenas/${first.id}/join`, { name: entry.name, cardId: entry.cardId, assetId: entry.assetId, walletAddress: entry.address, rental: false });
    const paidArena = { stakeLamports: maker.stakeLamports, wager: entry.wager, makerAddress: maker.address, opponentAddress: entry.address, expiresAt: wager.deadline.toNumber() * 1000 };
    maker.arena = { ...first, ...paidArena };
    entry.arena = { ...second, ...paidArena };
    maker.joinTx = entry.joinTx = signature;
    maker.status = entry.status = "matched";
    void settleWhenFinished(maker.id);
    return publicTicket(entry);
  } finally { entry.busy = false; }
}

export async function cancelPaid(entry: Entry) {
  if (entry.busy || entry.status === "matched") throw new Error("Battle has started; wager settles after the result");
  if (entry.wager && entry.maker) throw new Error("Cancel the on-chain deposit with Phantom before leaving this queue");
  const peer = entry.peer ? entries.get(entry.peer) : null;
  entry.status = "cancelled";
  if (peer && peer.status !== "matched") {
    peer.peer = undefined; peer.opponent = undefined; peer.status = peer.wager ? "cancel_required" : "waiting";
  }
  return publicTicket(entry);
}

export async function confirmCancel(entry: Entry) {
  if (!entry.maker || !entry.wager || !["awaiting_join", "cancel_required"].includes(entry.status)) throw new Error("No cancellable deposit");
  if (await connection.getAccountInfo(new PublicKey(entry.wager))) throw new Error("Wager is still on-chain; approve Phantom cancellation first");
  const peer = entry.peer ? entries.get(entry.peer) : null;
  entry.status = "cancelled";
  if (peer && peer.status !== "matched") { peer.peer = undefined; peer.opponent = undefined; peer.wager = undefined; peer.status = "waiting"; }
  return publicTicket(entry);
}

async function settleWhenFinished(makerId: string) {
  if (workers.has(makerId)) return;
  const maker = entries.get(makerId);
  if (!maker?.arena || !maker.wager || !maker.peer) return;
  workers.add(makerId);
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await fetch(`${API}/api/arenas/${maker.arena.id}`, { headers: { Authorization: `Bearer ${maker.arena.token}` }, cache: "no-store" });
      if (response.ok) {
        const view = await response.json() as { status: string; winner?: string };
        if (view.status === "finished") {
          if (!["player1", "player2", "draw"].includes(view.winner ?? "")) throw new Error("Arena result has no valid winner");
          const peer = entries.get(maker.peer);
          if (!peer) return;
          const { program, referee } = refereeProgram();
          const wager = new PublicKey(maker.wager);
          const makerKey = new PublicKey(maker.address);
          const opponentKey = new PublicKey(peer.address);
          const signature = view.winner === "draw"
            ? await program.methods.settleSolDraw().accountsStrict({ referee: referee.publicKey, config: CONFIG, maker: makerKey, wager, opponent: opponentKey }).signers([referee]).rpc()
            : await program.methods.settleSolWager(view.winner === "player1" ? makerKey : opponentKey).accountsStrict({ referee: referee.publicKey, config: CONFIG, maker: makerKey, wager, winner: view.winner === "player1" ? makerKey : opponentKey }).signers([referee]).rpc();
          maker.settlementTx = peer.settlementTx = signature;
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) { console.error("Devnet wager settlement failed", error); }
  finally { workers.delete(makerId); }
}
