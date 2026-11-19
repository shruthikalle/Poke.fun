/** Signed-in account as the UI sees it. Addresses are Solana devnet. */
export interface AuthUser {
  id: string;
  email: string | null;
  /** Account address (embedded wallet, created silently on sign-up). */
  address: string | null;
  /** External wallet the person linked themselves, e.g. Phantom. */
  linkedAddress: string | null;
  /** Server-issued session after a Phantom Devnet message signature. */
  walletAuthToken?: string;
}

/**
 * Sign-in provider seam. `PrivyBridge` implements it with Privy; `PhantomBridge` keeps the
 * app runnable without a Privy app id. Swap providers here without touching the UI.
 */
export interface AuthBackend {
  kind: "privy" | "phantom";
  ready: boolean;
  user: AuthUser | null;
  sendCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  loginWithPhantom?(): Promise<void>;
  linkPhantom(): Promise<void>;
  signOut(): Promise<void>;
  /** Signs a serialized Solana transaction for the signed-in address. Absent until a wallet can sign. */
  signTransaction?(transaction: Uint8Array): Promise<Uint8Array>;
}

/** Kept for the Go API login seam (PRD W-01). TODO(api): exchange the provider access token for a game session. */
export interface PlayerSession {
  address: string;
  displayName: string;
  token: string;
}
