/** Signed-in account as the UI sees it. Addresses are Solana devnet. */
export interface AuthUser {
  id: string;
  email: string | null;
  /** Account address (embedded wallet, created silently on sign-up). */
  address: string | null;
  /** External wallet the person linked themselves, e.g. Phantom. */
  linkedAddress: string | null;
}

/**
 * Sign-in provider seam. `PrivyBridge` implements it with Privy; `MockBridge` keeps the
 * app runnable without a Privy app id. Swap providers here without touching the UI.
 */
export interface AuthBackend {
  kind: "privy" | "mock";
  ready: boolean;
  user: AuthUser | null;
  sendCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  linkPhantom(): Promise<void>;
  signOut(): Promise<void>;
}

/** Kept for the Go API login seam (PRD W-01). TODO(api): exchange the provider access token for a game session. */
export interface PlayerSession {
  address: string;
  displayName: string;
  token: string;
}
