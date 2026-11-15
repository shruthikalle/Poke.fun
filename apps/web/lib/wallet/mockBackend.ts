"use client";

import { getBase58Decoder } from "@solana/kit";
import { useCallback, useEffect, useState } from "react";
import { local } from "../storage";
import { connectPhantom, getPhantomProvider } from "./phantom";
import type { AuthBackend, AuthUser } from "./types";

const USER_KEY = "pf:mock-user";
const ACCOUNTS_KEY = "pf:mock-accounts";

function randomAddress(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return getBase58Decoder().decode(bytes);
}

function accounts(): Record<string, AuthUser> {
  try { return JSON.parse(local.get(ACCOUNTS_KEY) ?? "{}") as Record<string, AuthUser>; } catch { return {}; }
}

/** Mock sign-in used when NEXT_PUBLIC_PRIVY_APP_ID is unset: any 6-digit code works and each email keeps one address. */
export function useMockBackend(): AuthBackend {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    try { const saved = local.get(USER_KEY); if (saved) setUser(JSON.parse(saved) as AuthUser); } catch { local.remove(USER_KEY); }
    setReady(true);
  }, []);

  const save = (next: AuthUser | null) => {
    setUser(next);
    if (!next) { local.remove(USER_KEY); return; }
    local.set(USER_KEY, JSON.stringify(next));
    if (next.email) local.set(ACCOUNTS_KEY, JSON.stringify({ ...accounts(), [next.email]: next }));
  };

  const sendCode = useCallback(async (email: string) => {
    await new Promise((r) => setTimeout(r, 450));
    setPendingEmail(email.trim().toLowerCase());
  }, []);

  const verifyCode = useCallback(async (code: string) => {
    await new Promise((r) => setTimeout(r, 450));
    if (!pendingEmail) throw new Error("Request a code first");
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code");
    const existing = accounts()[pendingEmail];
    save(existing ?? { id: `mock-${Date.now()}`, email: pendingEmail, address: randomAddress(), linkedAddress: null });
    setPendingEmail(null);
  }, [pendingEmail]);

  const linkPhantom = useCallback(async () => {
    if (!user) throw new Error("Sign in first");
    const provider = getPhantomProvider();
    const linked = provider ? await connectPhantom(provider) : randomAddress();
    save({ ...user, linkedAddress: linked });
  }, [user]);

  const signOut = useCallback(async () => { save(null); }, []);

  return { kind: "mock", ready, user, sendCode, verifyCode, linkPhantom, signOut };
}
