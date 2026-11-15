import { createPublicKey, randomBytes, verify } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 24 * 60 * 60_000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
type Challenge = { address: string; message: string; expiresAt: number };
type WalletSession = { address: string; expiresAt: number };
const challenges = new Map<string, Challenge>();
const sessions = new Map<string, WalletSession>();

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function publicKey(address: string) {
  const bytes = getBase58Encoder().encode(address);
  if (bytes.length !== 32) throw new Error("Invalid Solana address");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(bytes)]), format: "der", type: "spki" });
}

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) {
    const token = bearer(request);
    const saved = token ? sessions.get(token) : null;
    if (!saved || saved.expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      return error("Session expired", 401);
    }
    return NextResponse.json(saved);
  }

  try { publicKey(address); } catch { return error("Invalid Solana address", 400); }
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = `${request.nextUrl.host} wants you to sign in with your Solana account:\n${address}\n\nSign in to Poke.fun on Devnet. This does not send a transaction.\n\nURI: ${request.nextUrl.origin}\nVersion: 1\nChain ID: devnet\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  challenges.set(nonce, { address, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return NextResponse.json({ nonce, message });
}

export async function POST(request: NextRequest) {
  let body: { address?: unknown; nonce?: unknown; signature?: unknown };
  try { body = await request.json(); } catch { return error("Invalid request", 400); }
  const { address, nonce, signature } = body;
  if (typeof address !== "string" || typeof nonce !== "string" || typeof signature !== "string") return error("Missing login fields", 400);
  const challenge = challenges.get(nonce);
  challenges.delete(nonce);
  if (!challenge || challenge.address !== address || challenge.expiresAt <= Date.now()) return error("Login challenge expired", 401);
  try {
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || !verify(null, Buffer.from(challenge.message), publicKey(address), bytes)) return error("Invalid wallet signature", 401);
  } catch { return error("Invalid wallet signature", 401); }
  const token = randomBytes(32).toString("base64url");
  const saved = { address, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(token, saved);
  return NextResponse.json({ ...saved, token });
}

export async function DELETE(request: NextRequest) {
  const token = bearer(request);
  if (token) sessions.delete(token);
  return NextResponse.json({ ok: true });
}
