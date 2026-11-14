"use client";

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
    const saved = localStorage.getItem(SESSION_KEY);
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
        localStorage.removeItem(SESSION_KEY);
        setReady(true);
        return;
      }
      connectPhantom(provider, true)
        .then((addr) => {
          if (addr !== parsed.session!.address) throw new Error("account changed");
          setSession(parsed.session!);
          setStatus("signed-in");
        })
        .catch(() => localStorage.removeItem(SESSION_KEY))
        .finally(() => setReady(true));
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider?.on || !session) return;
    const onChange = () => {
      setSession(null);
      setStatus("idle");
      localStorage.removeItem(SESSION_KEY);
    };
    provider.on("accountChanged", onChange);
    provider.on("disconnect", onChange);
    return () => {
      provider.removeListener?.("accountChanged", onChange);
      provider.removeListener?.("disconnect", onChange);
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
      localStorage.setItem(SESSION_KEY, JSON.stringify({ session: next }));
    } catch (error) {
      setStatus(isUserRejection(error) ? "rejected" : "error");
    }
  }, [auth]);

  const playAsGuest = useCallback(() => {
    const name = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    setGuestName(name);
    setSession(null);
    setStatus("guest");
    localStorage.setItem(SESSION_KEY, JSON.stringify({ guest: name }));
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setGuestName(null);
    setStatus("idle");
    try { await getPhantomProvider()?.disconnect(); } catch { /* already disconnected */ }
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
