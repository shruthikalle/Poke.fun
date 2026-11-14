import type { Address } from "@solana/kit";
import { truncateAddress } from "./phantom";

export interface SignInChallenge {
  nonce: string;
  message: string;
}

export interface PlayerSession {
  address: Address;
  displayName: string;
  token: string;
}

/**
 * Login seam (PRD W-01: signed, single-use nonce).
 * TODO(api): implement against the Go API (e.g. POST /api/auth/nonce and
 * POST /api/auth/verify) so the server checks the signature.
 */
export interface AuthService {
  challenge(address: Address): Promise<SignInChallenge>;
  verify(address: Address, signature: string | null, challenge: SignInChallenge): Promise<PlayerSession>;
}

export const mockAuthService: AuthService = {
  async challenge(address) {
    const nonce = Math.random().toString(36).slice(2, 10);
    return {
      nonce,
      message: `Sign in to Poke.fun\n\nThis confirms it's you. It's free and doesn't post anything.\n\nAccount: ${address}\nCode: ${nonce}`,
    };
  },
  async verify(address) {
    return { address, displayName: truncateAddress(address), token: `mock-${Date.now()}` };
  },
};
