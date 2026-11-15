import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Stateless, HMAC-signed wallet sign-in challenges and sessions. Nothing is kept in server
 * memory, so a dev-server reload or a second server instance never signs a player out.
 */
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 24 * 60 * 60_000;

type SessionClaims = { kind: "session"; address: string; expiresAt: number };
type ChallengeClaims = { kind: "challenge"; address: string; message: string; expiresAt: number };

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function seal(claims: SessionClaims | ChallengeClaims, secret: string) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function open(token: string, secret: string, now: number): SessionClaims | ChallengeClaims | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof claims?.expiresAt === "number" && claims.expiresAt > now ? claims : null;
  } catch { return null; }
}

export function issueSession(address: string, secret: string, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  return { address, expiresAt, token: seal({ kind: "session", address, expiresAt }, secret) };
}

export function readSession(token: string, secret: string, now = Date.now()) {
  const claims = open(token, secret, now);
  return claims?.kind === "session" && typeof claims.address === "string" ? { address: claims.address, expiresAt: claims.expiresAt } : null;
}

export function issueChallenge(address: string, host: string, origin: string, secret: string, now = Date.now()) {
  const message = `${host} wants you to sign in with your Solana account:\n${address}\n\nSign in to Poke.fun on Devnet. This does not send a transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: devnet\nNonce: ${randomBytes(16).toString("hex")}\nIssued At: ${new Date(now).toISOString()}`;
  return { message, challenge: seal({ kind: "challenge", address, message, expiresAt: now + CHALLENGE_TTL_MS }, secret) };
}

/** Returns the signed message when the challenge is genuine, unexpired and for this address. */
export function readChallenge(challenge: string, address: string, secret: string, now = Date.now()) {
  const claims = open(challenge, secret, now);
  return claims?.kind === "challenge" && claims.address === address ? claims.message : null;
}
