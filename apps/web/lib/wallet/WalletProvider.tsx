"use client";

import { session as tabStorage } from "../storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mockAuthService, type AuthService, type PlayerSession } from "./auth";
import { connectPhantom, getPhantomProvider, isUserRejection, signText } from "./phantom";

export type SignInStatus = "idle" | "connecting" | "confirming" | "signed-in" | "guest" | "not-installed" | "rejected" | "error";

interface WalletContextValue {
  status: SignInStatus;
  /** False until a saved session has been restored (or ruled out). */
  ready: boolean;
  session: PlayerSession | null;
  /** Name shown in battles: short account id, guest name, or null. */
  playerName: string | null;
  signIn(): Promise<void>;
  playAsGuest(): void;
  signOut(): Promise<void>;
  reset(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const SESSION_KEY = "pokefun-player";

export function WalletProvider({ children, auth = mockAuthService }: { children: ReactNode; auth?: AuthService }) {
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = tabStorage.get(SESSION_KEY);
    if (!saved) {
      setReady(true);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as { guest?: string; session?: PlayerSession };
      if (parsed.guest) {
        setGuestName(parsed.guest);
        setStatus("guest");
        setReady(true);
        return;
      }
      const provider = getPhantomProvider();
      if (!parsed.session || !provider) {
        tabStorage.remove(SESSION_KEY);
        setReady(true);
        return;
      }
      connectPhantom(provider, true)
        .then((addr) => {
          if (addr !== parsed.session!.address) throw new Error("account changed");
          setSession(parsed.session!);
          setStatus("signed-in");
        })
        .catch(() => tabStorage.remove(SESSION_KEY))
        .finally(() => setReady(true));
    } catch {
      tabStorage.remove(SESSION_KEY);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider?.on || !session) return;
    const clearSession = () => {
      setSession(null);
      setStatus("idle");
      tabStorage.remove(SESSION_KEY);
    };
    const onAccountChanged = (next?: { toString(): string } | null) => {
      const current = next === null ? null : next?.toString() ?? provider.publicKey?.toString();
      if (!current || current !== session.address) clearSession();
    };
    // Some wallets switch accounts without an event; re-check when the tab regains focus.
    const recheck = () => {
      const current = provider.publicKey?.toString();
      if (current && current !== session.address) clearSession();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    recheck();
    provider.on("accountChanged", onAccountChanged);
    provider.on("disconnect", clearSession);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      provider.removeListener?.("accountChanged", onAccountChanged);
      provider.removeListener?.("disconnect", clearSession);
    };
  }, [session]);

  const signIn = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider) {
      setStatus("not-installed");
      return;
    }
    try {
      setStatus("connecting");
      const addr = await connectPhantom(provider);
      setStatus("confirming");
      const challenge = await auth.challenge(addr);
      const signature = await signText(provider, challenge.message);
      const next = await auth.verify(addr, signature, challenge);
      setSession(next);
      setGuestName(null);
      setStatus("signed-in");
      tabStorage.set(SESSION_KEY, JSON.stringify({ session: next }));
    } catch (error) {
      setStatus(isUserRejection(error) ? "rejected" : "error");
    }
  }, [auth]);

  const playAsGuest = useCallback(() => {
    const name = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    setGuestName(name);
    setSession(null);
    setStatus("guest");
    tabStorage.set(SESSION_KEY, JSON.stringify({ guest: name }));
  }, []);

  const signOut = useCallback(async () => {
    tabStorage.remove(SESSION_KEY);
    setSession(null);
    setGuestName(null);
    setStatus("idle");
    // Sign out of this app tab without disconnecting Phantom in other tabs.
  }, []);

  const reset = useCallback(() => {
    setStatus((s) => (s === "signed-in" || s === "guest" ? s : "idle"));
  }, []);

  const value = useMemo<WalletContextValue>(() => ({
    status,
    ready,
    session,
    playerName: session?.displayName ?? guestName,
    signIn,
    playAsGuest,
    signOut,
    reset,
  }), [status, ready, session, guestName, signIn, playAsGuest, signOut, reset]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
