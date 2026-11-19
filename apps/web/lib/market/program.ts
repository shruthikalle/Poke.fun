/**
 * Client for the `pokefun_market` Solana program (contracts/programs/pokefun_market).
 * Instructions are encoded straight from the Anchor IDL, so the account order,
 * signer/writable flags and discriminators always match the deployed program.
 */
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
} from "@solana/kit";
import idl from "./pokefun_market.idl.json";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const PROGRAM_ID = address(process.env.NEXT_PUBLIC_MARKET_PROGRAM_ID ?? idl.address);
export const CORE_PROGRAM = address("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111");
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const rpc = createSolanaRpc(RPC_URL);

type IdlArgType = "u8" | "u16" | "u64" | "bool" | "pubkey";
interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: { name: string; writable?: boolean; signer?: boolean; address?: string }[];
  args: { name: string; type: IdlArgType | object }[];
}
const instructions = new Map((idl.instructions as IdlInstruction[]).map((ix) => [ix.name, ix]));
const errors = new Map((idl.errors as { code: number; name: string; msg: string }[]).map((e) => [e.code, e.msg]));

const addressEncoder = getAddressEncoder();
const enc = new TextEncoder();

function encodeArg(type: IdlArgType, value: bigint | number | boolean | string): Uint8Array {
  switch (type) {
    case "u8": return Uint8Array.of(Number(value));
    case "bool": return Uint8Array.of(value ? 1 : 0);
    case "u16": { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, Number(value), true); return b; }
    case "u64": { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(value as bigint | number), true); return b; }
    case "pubkey": return new Uint8Array(addressEncoder.encode(address(String(value))));
  }
}

export type MarketIx = "list" | "update_price" | "cancel_listing" | "buy" | "make_offer" | "cancel_offer" | "decline_offer" | "counter_offer"
  | "accept_offer" | "accept_counter" | "expire_offer" | "propose_trade" | "accept_trade" | "decline_trade" | "cancel_trade" | "expire_trade";

/** Builds one program instruction. `accounts` uses the IDL's snake_case names; fixed addresses fill themselves in. */
export function marketIx(name: MarketIx, accounts: Record<string, Address>, args: Record<string, bigint | number | boolean | string> = {}, remaining: Address[] = []): Instruction {
  const ix = instructions.get(name);
  if (!ix) throw new Error(`Unknown instruction ${name}`);
  const metas = ix.accounts.map((a) => {
    const key = accounts[a.name] ?? (a.address ? address(a.address) : undefined);
    if (!key) throw new Error(`${name}: missing account ${a.name}`);
    const role = a.signer ? (a.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : a.writable ? AccountRole.WRITABLE : AccountRole.READONLY;
    return { address: key, role };
  });
  remaining.forEach((key) => metas.push({ address: key, role: AccountRole.WRITABLE }));
  const parts = [Uint8Array.from(ix.discriminator), ...ix.args.map((a) => encodeArg(a.type as IdlArgType, args[a.name]))];
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => { data.set(p, at); return at + p.length; }, 0);
  return { programAddress: PROGRAM_ID, accounts: metas, data };
}

/** ComputeBudget SetComputeUnitLimit, for trades that move several cards. */
export function computeLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET, accounts: [], data };
}

// ------------------------------------------------------------------ PDAs

async function pda(...seeds: (string | Address | Uint8Array)[]): Promise<Address> {
  const bytes = seeds.map((s) => (s instanceof Uint8Array ? s : s.length >= 32 ? addressEncoder.encode(address(s)) : enc.encode(s)));
  const [found] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: bytes });
  return found;
}
export const configPda = () => pda("market");
export const authorityPda = () => pda("authority");
export const approvedPda = (collection: string) => pda("collection", address(collection));
export const listingPda = (asset: string) => pda("listing", address(asset));
export const offerPda = (asset: string, buyer: string) => pda("offer", address(asset), address(buyer));
export function tradePda(proposer: string, nonce: bigint) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, nonce, true);
  return pda("trade", address(proposer), b);
}

/** Accounts every card-moving instruction needs. */
export async function coreAccounts(asset: string, collection: string) {
  return {
    config: await configPda(), authority: await authorityPda(), asset: address(asset), collection: address(collection),
    core_program: CORE_PROGRAM, system_program: SYSTEM_PROGRAM,
  };
}

// ------------------------------------------------------------ transactions

/** Signs a serialized transaction and submits it; returns the signature. Provided by the wallet. */
export type TransactionSender = (wireTransaction: Uint8Array) => Promise<string>;

export async function buildTransaction(feePayer: string, ixs: Instruction[]): Promise<Uint8Array> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

function toBase64(bytes: Uint8Array): Base64EncodedWireTransaction {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s) as Base64EncodedWireTransaction;
}

/** Turns program logs into the program's own error message, when there is one. */
export function explainLogs(logs: readonly string[] | null | undefined, fallback: string): string {
  for (const line of logs ?? []) {
    const anchor = line.match(/Error Number: (\d+)\. Error Message: (.+?)\.?$/);
    if (anchor) {
      const code = Number(anchor[1]);
      if (errors.has(code)) return errors.get(code)!;
      if (code === 3012) return "That listing, offer or trade no longer exists. Refresh and try again.";
      if (code >= 2000 && code < 3000) return "Only the owner can do that, or it changed. Refresh and try again.";
      return anchor[2];
    }
    const custom = line.match(/custom program error: 0x([0-9a-f]+)/i);
    if (custom && errors.has(parseInt(custom[1], 16))) return errors.get(parseInt(custom[1], 16))!;
    if (/insufficient lamports|Attempt to debit an account but found no record of a prior credit/i.test(line)) return "Not enough SOL in your wallet for this.";
    if (/already in use/.test(line)) return "That's already been done. Refresh and try again.";
  }
  return fallback;
}

/** Simulates (to surface readable errors before the wallet prompt), signs, sends and confirms. */
export async function sendAndConfirm(feePayer: string, ixs: Instruction[], send: TransactionSender): Promise<string> {
  const wire = await buildTransaction(feePayer, ixs);
  const simulation = await rpc.simulateTransaction(toBase64(wire), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (simulation.value.err) {
    throw new Error(explainLogs(simulation.value.logs, "This transaction would fail. Refresh and try again."));
  }
  const signature = await send(wire);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature as never]).send();
    const status = value[0];
    if (status?.err) throw new Error("The transaction failed on-chain.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for confirmation. Check the explorer, then refresh.");
}

/** Sends an already-signed transaction through our RPC (used by wallets that only sign). */
export async function submitSigned(signed: Uint8Array): Promise<string> {
  return rpc.sendTransaction(toBase64(signed), { encoding: "base64", skipPreflight: true }).send();
}

export const toLamports = (sol: number) => BigInt(Math.round(sol * LAMPORTS_PER_SOL));
export const toSolNumber = (lamports: number | bigint) => Number(lamports) / LAMPORTS_PER_SOL;
