import { createPublicKey, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "./pokefun_wager.json";
import { FAUX_ART_WINDOW, findCatalogEntry, type CardPick, type PowerTier } from "../cards/mapping";
import { speciesForCardName } from "../cards/cardNames";
import type { MatchTicket } from "../match/MatchmakingService";
import { tierFor } from "../rank/RankService";

const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const API = process.env.ARENA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const CONFIG = new PublicKey("8ReWdmFQhDwcexEs8ZoW1o5xRP95mq3DKBugrJynVx8S");
type Stage = "waiting" | "open_required" | "awaiting_open" | "join_required" | "awaiting_join" | "cancel_required" | "matched" | "cancelled";
export type PaidTicket = { id: string; token: string; status: Stage; stakeLamports: number; opponent?: string; wager?: string; openTx?: string; joinTx?: string; settlementTx?: string; match?: MatchTicket; arena?: { id: string; token: string; stakeLamports: number; wager: string; makerAddress: string; opponentAddress: string; expiresAt: number } };
type Entry = PaidTicket & { address: string; name: string; cardId: string; assetId: string; rating: number; tier: number; created: number; peer?: string; maker?: boolean; busy?: boolean; pairKey?: string; battleQueueTicket?: string; battleReply?: QueueMatched };
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
  const card = await response.json() as { name?: string; image?: string; attributes?: { trait_type: string; value: string }[] };
  const attribute = (name: string) => card.attributes?.find((a) => a.trait_type === name)?.value;
  const species = findCatalogEntry(attribute("Set"), attribute("Card Number"))?.species
    ?? speciesForCardName(attribute("Card Name") ?? "")?.key;
  if (attribute("Category") !== "Pokemon" || species !== entry.cardId) throw new Error("Card does not match selected fighter");
  return card;
}

async function fighterTier(cardId: string) {
  const response = await fetch(`${API}/api/species/${encodeURIComponent(cardId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("This Pokémon is not supported in the turn-based battle");
  const fighter = await response.json() as { tier: number };
  if (![1, 2, 3].includes(fighter.tier)) throw new Error("This Pokémon has no valid battle tier");
  return fighter.tier;
}

async function readWager(address: string) {
  const { program } = refereeProgram();
  const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info || !info.owner.equals(program.programId)) throw new Error("Wager account not found on Devnet");
  const account = program.coder.accounts.decode("Wager", info.data) as {
    maker: PublicKey; opponent: PublicKey; mint: PublicKey; stake: { toNumber(): number }; state: Record<string, unknown>; deadline: { toNumber(): number };
  };
  if (!account.mint.equals(PublicKey.default) || account.deadline.toNumber() <= Date.now() / 1000) throw new Error("Wager is not an active Devnet SOL escrow");
  return account;
}

async function battleCall<T>(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Battle server rejected match");
  return result as T;
}

type QueuePlayer = { trainer: { id: string; name: string; avatar: string }; rating: number; wins: number; losses: number; team: CardPick[] };
type QueueMatched = { status: "matched"; id: string; token: string; side: "p1" | "p2"; you: QueuePlayer; opponent: QueuePlayer };
type QueueReply = QueueMatched | { status: "searching"; ticket: string };

function battlePick(entry: Entry, card: Awaited<ReturnType<typeof verifiedCard>>) {
  const attribute = (name: string) => card.attributes?.find((a) => a.trait_type === name)?.value;
  return {
    key: entry.assetId, assetId: entry.assetId, walletAddress: entry.address,
    species: entry.cardId, label: attribute("Card Name") ?? card.name ?? entry.cardId,
    image: card.image ?? null, grade: null, level: 50, tier: entry.tier as PowerTier,
    rental: false, artWindow: FAUX_ART_WINDOW,
  };
}

function matchTicket(reply: QueueMatched, entry: Entry, wager: string): MatchTicket {
  return {
    matchId: reply.id, format: "champion", entry: 0,
    you: { name: reply.you.trainer.name, rating: reply.you.rating, team: reply.you.team },
    opponent: { trainer: reply.opponent.trainer, rating: reply.opponent.rating, tier: tierFor(reply.opponent.rating),
      wins: reply.opponent.wins, losses: reply.opponent.losses, team: reply.opponent.team },
    live: { battleId: reply.id, token: reply.token, side: reply.side },
    paidWager: { id: entry.id, token: entry.token, wager, stakeLamports: entry.stakeLamports },
  };
}

async function createPaidBattle(maker: Entry, opponent: Entry, wager: string) {
  if (!maker.pairKey || maker.pairKey !== opponent.pairKey) throw new Error("Funded match pairing key is missing");
  const [makerCard, opponentCard] = await Promise.all([verifiedCard(maker), verifiedCard(opponent)]);
  const request = (entry: Entry, card: typeof makerCard) => ({
    trainer: { id: entry.name, name: entry.name, avatar: "maya" },
    rating: entry.rating, format: "champion", tier: entry.tier, entry: 0,
    pairKey: maker.pairKey, team: [battlePick(entry, card)],
  });
  if (!maker.battleQueueTicket) {
    const queued = await battleCall<QueueReply>("POST", "/api/queue", request(maker, makerCard));
    if (queued.status !== "searching") throw new Error("Paid match paired with the wrong opponent");
    maker.battleQueueTicket = queued.ticket;
  }
  if (!opponent.battleReply) {
    const joined = await battleCall<QueueReply>("POST", "/api/queue", request(opponent, opponentCard));
    if (joined.status !== "matched") throw new Error("Battle server did not pair the funded wallets");
    opponent.battleReply = joined;
  }
  const first = await battleCall<QueueReply>("GET", `/api/queue/${encodeURIComponent(maker.battleQueueTicket)}`);
  const second = opponent.battleReply;
  if (first.status !== "matched" || first.id !== second.id || first.side !== "p1" || second.side !== "p2") {
    throw new Error("The funded players were not paired in the same battle");
  }
  return { maker: matchTicket(first, maker, wager), opponent: matchTicket(second, opponent, wager) };
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
  const { id, token, status, stakeLamports, opponent, wager, openTx, joinTx, settlementTx, match, arena } = entry;
  return { id, token, status, stakeLamports, opponent, wager, openTx, joinTx, settlementTx, match, arena };
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
    entry.pairKey = peer.pairKey = Keypair.generate().publicKey.toBase58();
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
    const battle = await createPaidBattle(maker, entry, entry.wager);
    maker.match = battle.maker;
    entry.match = battle.opponent;
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
  if ((!maker?.match?.live && !maker?.arena) || !maker.wager || !maker.peer) return;
  workers.add(makerId);
  try {
    const deadline = (await readWager(maker.wager)).deadline.toNumber() * 1000;
    while (Date.now() < deadline && !maker.settlementTx) {
      const peer = entries.get(maker.peer);
      if (!peer) return;
      const winner = maker.match?.live ? await paidBattleWinner(maker, peer) : await legacyArenaWinner(maker);
      if (winner) {
        const { program, referee } = refereeProgram();
        const wager = new PublicKey(maker.wager);
        const makerKey = new PublicKey(maker.address);
        const opponentKey = new PublicKey(peer.address);
        const signature = winner === "draw"
          ? await program.methods.settleSolDraw().accountsStrict({ referee: referee.publicKey, config: CONFIG, maker: makerKey, wager, opponent: opponentKey }).signers([referee]).rpc()
          : await program.methods.settleSolWager(winner === "p1" ? makerKey : opponentKey).accountsStrict({ referee: referee.publicKey, config: CONFIG, maker: makerKey, wager, winner: winner === "p1" ? makerKey : opponentKey }).signers([referee]).rpc();
        maker.settlementTx = peer.settlementTx = signature;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) { console.error("Devnet wager settlement failed", error); }
  finally { workers.delete(makerId); }
}

async function legacyArenaWinner(maker: Entry): Promise<"p1" | "p2" | "draw" | null> {
  if (!maker.arena) return null;
  const response = await fetch(`${API}/api/arenas/${maker.arena.id}`, { headers: { Authorization: `Bearer ${maker.arena.token}` }, cache: "no-store" });
  if (!response.ok) return null;
  const view = await response.json() as { status: string; winner?: string };
  if (view.status !== "finished") return null;
  if (view.winner === "player1") return "p1";
  if (view.winner === "player2") return "p2";
  if (view.winner === "draw") return "draw";
  throw new Error("Arena result has no valid winner");
}

async function paidBattleWinner(maker: Entry, peer: Entry): Promise<"p1" | "p2" | "draw" | null> {
  const live = maker.match?.live;
  if (!live || !peer.match?.live || live.battleId !== peer.match.live.battleId) throw new Error("Paid battle tickets disagree");
  const response = await fetch(`${API}/api/battles/${encodeURIComponent(live.battleId)}/result`, {
    headers: { Authorization: `Bearer ${live.token}` }, cache: "no-store",
  });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error(`Could not read authoritative battle result (${response.status})`);
  const proof = await response.json() as { payload: string; signature: string; publicKey: string; algorithm: string;
    result: { matchId: string; mode: string; round: number; winner: string; players: { seat: string; name: string; assets?: string[]; species: string[] }[] } };
  const payload = Buffer.from(proof.payload, "base64url");
  const publicKey = Buffer.from(proof.publicKey, "base64url");
  const referee = await battleCall<{ publicKey: string }>("GET", "/api/referee");
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]), format: "der", type: "spki" });
  if (proof.algorithm !== "Ed25519" || proof.publicKey !== referee.publicKey || publicKey.length !== 32 || !verify(null, payload, key, Buffer.from(proof.signature, "base64url"))
    || JSON.stringify(JSON.parse(payload.toString("utf8"))) !== JSON.stringify(proof.result)) throw new Error("Battle result signature is invalid");
  const result = proof.result;
  if (result.matchId !== live.battleId || result.mode !== "team" || result.round !== 1
    || result.players[0]?.seat !== "p1" || result.players[1]?.seat !== "p2"
    || result.players[0]?.name !== maker.name || result.players[1]?.name !== peer.name
    || result.players[0]?.assets?.[0] !== maker.assetId || result.players[1]?.assets?.[0] !== peer.assetId
    || result.players[0]?.species?.[0] !== maker.cardId || result.players[1]?.species?.[0] !== peer.cardId
    || !["p1", "p2", "draw"].includes(result.winner)) throw new Error("Battle result does not match funded players and cards");
  return result.winner as "p1" | "p2" | "draw";
}
