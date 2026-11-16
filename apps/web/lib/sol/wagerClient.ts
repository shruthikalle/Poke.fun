import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { getPhantomProvider } from "../wallet/phantom";
import type { PaidTicket } from "./paidQueue";

export const WAGER_PROGRAM = new PublicKey("FphH5qUaMxam8wvewVXNxaLVGvY8UqDBHBRhwbxNYF1J");
export const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function wagerAddress(maker: PublicKey, nonce: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, nonce, true);
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("wager"), maker.toBytes(), bytes], WAGER_PROGRAM)[0];
}

async function send(ix: TransactionInstruction, expectedAddress: string) {
  const provider = getPhantomProvider();
  if (!provider?.publicKey || !provider.signAndSendTransaction || provider.publicKey.toString() !== expectedAddress) {
    throw new Error("Connect the same Devnet Phantom wallet used to sign in, then try again.");
  }
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: new PublicKey(expectedAddress), blockhash, lastValidBlockHeight }).add(ix);
  const { signature } = await provider.signAndSendTransaction(transaction);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

export async function openSolWager(makerAddress: string, stakeLamports: number) {
  const maker = new PublicKey(makerAddress);
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
  const wager = wagerAddress(maker, nonce);
  const data = new Uint8Array(24);
  data.set([31, 94, 33, 208, 123, 90, 206, 116]);
  new DataView(data.buffer).setBigUint64(8, nonce, true);
  new DataView(data.buffer).setBigUint64(16, BigInt(stakeLamports), true);
  const signature = await send(new TransactionInstruction({ programId: WAGER_PROGRAM, keys: [
    { pubkey: maker, isSigner: true, isWritable: true },
    { pubkey: wager, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.from(data) }), makerAddress);
  return { wager: wager.toBase58(), signature };
}

export async function joinSolWager(opponentAddress: string, wagerAddressValue: string) {
  const signature = await send(new TransactionInstruction({ programId: WAGER_PROGRAM, keys: [
    { pubkey: new PublicKey(opponentAddress), isSigner: true, isWritable: true },
    { pubkey: new PublicKey(wagerAddressValue), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.from([50, 190, 215, 138, 4, 124, 51, 18]) }), opponentAddress);
  return signature;
}

export async function cancelSolWager(makerAddress: string, wagerAddressValue: string) {
  return send(new TransactionInstruction({ programId: WAGER_PROGRAM, keys: [
    { pubkey: new PublicKey(makerAddress), isSigner: true, isWritable: true },
    { pubkey: new PublicKey(wagerAddressValue), isSigner: false, isWritable: true },
  ], data: Buffer.from([35, 43, 35, 60, 251, 82, 254, 107]) }), makerAddress);
}

export async function expireSolWager(callerAddress: string, makerAddress: string, opponentAddress: string, wagerAddressValue: string) {
  return send(new TransactionInstruction({ programId: WAGER_PROGRAM, keys: [
    { pubkey: new PublicKey(callerAddress), isSigner: true, isWritable: false },
    { pubkey: new PublicKey(makerAddress), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(wagerAddressValue), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(opponentAddress), isSigner: false, isWritable: true },
  ], data: Buffer.from([107, 76, 51, 138, 234, 154, 48, 187]) }), callerAddress);
}

/** Recovers a timed-out escrow even if the match server has restarted. */
export async function recoverExpiredWager(callerAddress: string, wagerAddressValue: string) {
  const info = await new Connection(DEVNET_RPC, "confirmed").getAccountInfo(new PublicKey(wagerAddressValue));
  if (!info || !info.owner.equals(WAGER_PROGRAM) || info.data.length < 162) throw new Error("Wager is already closed or is not a Poke.fun escrow.");
  const deadline = Number(info.data.readBigInt64LE(152)) * 1000;
  if (Date.now() < deadline) throw new Error(`This escrow can be refunded after ${new Date(deadline).toLocaleString()}.`);
  const maker = new PublicKey(info.data.subarray(8, 40)).toBase58();
  const opponent = new PublicKey(info.data.subarray(40, 72)).toBase58();
  return expireSolWager(callerAddress, maker, opponent, wagerAddressValue);
}

async function paidRequest<T>(path: string, authToken: string, ticketToken?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/sol-wagers${path}`, { ...init, headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${authToken}`,
    ...(ticketToken ? { "x-queue-token": ticketToken } : {}), ...init?.headers,
  } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Wager request failed (${response.status})`);
  return result as T;
}

export const paidQueueApi = {
  enqueue: (auth: string, input: { name: string; cardId: string; assetId: string; rating: number; stakeLamports: number }) => paidRequest<PaidTicket>("", auth, undefined, { method: "POST", body: JSON.stringify(input) }),
  status: (auth: string, ticket: Pick<PaidTicket, "id" | "token">) => paidRequest<PaidTicket>(`/${ticket.id}`, auth, ticket.token),
  action: (auth: string, ticket: PaidTicket, body: Record<string, string>) => paidRequest<PaidTicket>(`/${ticket.id}`, auth, ticket.token, { method: "POST", body: JSON.stringify(body) }),
  cancel: (auth: string, ticket: PaidTicket) => paidRequest<PaidTicket>(`/${ticket.id}`, auth, ticket.token, { method: "DELETE" }),
};
