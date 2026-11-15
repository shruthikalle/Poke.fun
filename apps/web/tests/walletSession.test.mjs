import assert from "node:assert/strict";
import test from "node:test";
import { issueChallenge, issueSession, readChallenge, readSession } from "../lib/auth/walletSession.ts";

const SECRET = "test-secret-at-least-32-characters-long";
const ADDRESS = "7YWHMfk9JZe0LMHw7nV5YkqF1Zzqv2Wm1oX9cVHkM8xq";

test("a session token stays valid without any server-side state", () => {
  const { token } = issueSession(ADDRESS, SECRET, 1_000);
  assert.equal(readSession(token, SECRET, 2_000)?.address, ADDRESS);
});

test("a session signed with another secret is rejected", () => {
  const { token } = issueSession(ADDRESS, SECRET, 1_000);
  assert.equal(readSession(token, "another-secret-of-at-least-32-chars!!", 2_000), null);
});

test("a tampered session token is rejected", () => {
  const { token } = issueSession(ADDRESS, SECRET, 1_000);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ address: "Attacker111111111111111111111111111111111", expiresAt: 9e15 })).toString("base64url");
  assert.equal(readSession(`${forged}.${sig}`, SECRET, 2_000), null);
  assert.equal(readSession(`${body}x.${sig}`, SECRET, 2_000), null);
});

test("an expired session is rejected", () => {
  const { token, expiresAt } = issueSession(ADDRESS, SECRET, 1_000);
  assert.equal(readSession(token, SECRET, expiresAt + 1), null);
});

test("a challenge round-trips its message for the same address only", () => {
  const { challenge, message } = issueChallenge(ADDRESS, "localhost:3000", "http://localhost:3000", SECRET, 1_000);
  assert.equal(readChallenge(challenge, ADDRESS, SECRET, 2_000), message);
  assert.equal(readChallenge(challenge, "Other1111111111111111111111111111111111111", SECRET, 2_000), null);
  assert.equal(readChallenge(challenge, ADDRESS, SECRET, 1_000 + 5 * 60_000 + 1), null);
});
