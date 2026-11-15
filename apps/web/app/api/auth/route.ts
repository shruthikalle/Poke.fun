import { createPublicKey, verify } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";
import { NextRequest, NextResponse } from "next/server";
import { issueChallenge, issueSession, readChallenge, readSession, SESSION_TTL_MS } from "../../../lib/auth/walletSession";

export const runtime = "nodejs";

const COOKIE = "pf_wallet_session";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEV_SECRET = "pokefun-local-dev-only-wallet-session-secret";

function secret() {
  const configured = process.env.AUTH_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  return process.env.NODE_ENV === "production" ? null : DEV_SECRET;
}

const notConfigured = () => error("Phantom sign-in is not available right now", 503);

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function publicKey(address: string) {
  const bytes = getBase58Encoder().encode(address);
  if (bytes.length !== 32) throw new Error("Invalid Solana address");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(bytes)]), format: "der", type: "spki" });
}

export async function GET(request: NextRequest) {
  const key = secret();
  if (!key) return notConfigured();
  const address = request.nextUrl.searchParams.get("address");
  if (!address) {
    const token = request.cookies.get(COOKIE)?.value;
    const saved = token ? readSession(token, key) : null;
    if (!saved) {
      const response = error("Session expired", 401);
      if (token) response.cookies.delete(COOKIE);
      return response;
    }
    return NextResponse.json(saved);
  }

  try { publicKey(address); } catch { return error("Invalid Solana address", 400); }
  return NextResponse.json(issueChallenge(address, request.nextUrl.host, request.nextUrl.origin, key));
}

export async function POST(request: NextRequest) {
  const key = secret();
  if (!key) return notConfigured();
  let body: { address?: unknown; challenge?: unknown; signature?: unknown };
  try { body = await request.json(); } catch { return error("Invalid request", 400); }
  const { address, challenge, signature } = body;
  if (typeof address !== "string" || typeof challenge !== "string" || typeof signature !== "string") return error("Missing login fields", 400);
  const message = readChallenge(challenge, address, key);
  if (!message) return error("Login challenge expired", 401);
  try {
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || !verify(null, Buffer.from(message), publicKey(address), bytes)) return error("Invalid wallet signature", 401);
  } catch { return error("Invalid wallet signature", 401); }
  const { token, ...saved } = issueSession(address, key);
  const response = NextResponse.json(saved);
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE);
  return response;
}
