"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SignInDialog } from "../../components/SignInDialog";
import { local } from "../storage";
import { useMockBackend } from "./mockBackend";
import { truncateAddress } from "./phantom";
import { PrivyBridge } from "./privyBackend";
import type { AuthBackend, AuthUser, PlayerSession } from "./types";

export type SignInStatus = "idle" | "signed-in" | "guest";

export interface WalletContextValue {
  /** False until a saved session has been restored (or ruled out). */
  ready: boolean;
  status: SignInStatus;
  /** True once signed in with an account (not a guest). */
  connected: boolean;
  /** Account address, shown truncated in the UI. */
  address: string | null;
  email: string | null;
  linkedAddress: string | null;
  session: PlayerSession | null;
  /** Name shown in battles: email name, guest name, or null. */
  playerName: string | null;
  provider: AuthBackend["kind"];
  /** Opens the sign-in dialog; `onSignedIn` runs once the person is signed in or chose guest play. */
  signIn(options?: { onSignedIn?: () => void; onCancel?: () => void; mode?: "sign-in" | "create" }): void;
  linkPhantom(): Promise<void>;
  playAsGuest(): void;
  signOut(): Promise<void>;
  /** Lower-level steps used by the dialog. */
  auth: Pick<AuthBackend, "sendCode" | "verifyCode" | "loginWithPhantom">;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const GUEST_KEY = "pf:guest";
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const nameFor = (user: AuthUser) => user.email?.split("@")[0] ?? (user.address ? truncateAddress(user.address) : "Trainer");

function WalletState({ backend, children }: { backend: AuthBackend; children: ReactNode }) {
  const [guestName, setGuestName] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "sign-in" | "create" } | null>(null);
  const after = useRef<(() => void) | undefined>(undefined);
  const cancel = useRef<(() => void) | undefined>(undefined);

  useEffect(() => { setGuestName(local.get(GUEST_KEY)); setRestored(true); }, []);

  const user = backend.user;
  useEffect(() => {
    if (user && guestName) { setGuestName(null); local.remove(GUEST_KEY); }
  }, [user, guestName]);

  const finish = useCallback(() => {
    setDialog(null);
    const cb = after.current;
    after.current = undefined;
    cancel.current = undefined;
    cb?.();
  }, []);

  const signIn = useCallback<WalletContextValue["signIn"]>((options) => {
    after.current = options?.onSignedIn;
    cancel.current = options?.onCancel;
    setDialog({ mode: options?.mode ?? "sign-in" });
  }, []);

  const playAsGuest = useCallback(() => {
    const name = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    setGuestName(name);
    local.set(GUEST_KEY, name);
  }, []);

  const { signOut: backendSignOut, linkPhantom, loginWithPhantom, sendCode, verifyCode } = backend;
  const signOut = useCallback(async () => {
    local.remove(GUEST_KEY);
    setGuestName(null);
    if (user) await backendSignOut();
  }, [user, backendSignOut]);

  const value = useMemo<WalletContextValue>(() => {
    const signedIn = !!user;
    const playerName = user ? nameFor(user) : guestName;
    return {
      ready: backend.ready && restored,
      status: signedIn ? "signed-in" : guestName ? "guest" : "idle",
      connected: signedIn,
      address: user?.address ?? null,
      email: user?.email ?? null,
      linkedAddress: user?.linkedAddress ?? null,
      session: user?.address ? { address: user.address, displayName: playerName ?? "", token: user.id } : null,
      playerName,
      provider: backend.kind,
      signIn,
      linkPhantom,
      playAsGuest,
      signOut,
      auth: { sendCode, verifyCode, loginWithPhantom },
    };
  }, [user, guestName, backend.ready, backend.kind, restored, signIn, linkPhantom, playAsGuest, signOut, sendCode, verifyCode, loginWithPhantom]);

  return (
    <WalletContext.Provider value={value}>
      {children}
      <SignInDialog open={!!dialog} initialMode={dialog?.mode ?? "sign-in"} onClose={() => { const cb = cancel.current; after.current = cancel.current = undefined; setDialog(null); cb?.(); }} onSignedIn={finish} />
    </WalletContext.Provider>
  );
}

function MockBridge({ children }: { children: (backend: AuthBackend) => ReactNode }) {
  return <>{children(useMockBackend())}</>;
}

/** Uses Privy when NEXT_PUBLIC_PRIVY_APP_ID is set, otherwise the mock sign-in. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const render = (backend: AuthBackend) => <WalletState backend={backend}>{children}</WalletState>;
  return PRIVY_APP_ID ? <PrivyBridge appId={PRIVY_APP_ID}>{render}</PrivyBridge> : <MockBridge>{render}</MockBridge>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
