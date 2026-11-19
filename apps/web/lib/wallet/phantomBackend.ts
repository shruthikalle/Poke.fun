"use client";

import { useCallback, useEffect, useState } from "react";
import { session } from "../storage";
import { connectPhantom, getPhantomProvider } from "./phantom";
import { signWithStandardWallet } from "./standardWallet";
import type { AuthBackend, AuthUser } from "./types";

const SESSION_KEY = "pf:devnet-wallet-session";
type WalletSession = { address: string; token: string; expiresAt: number };
async function request<T>(method: string, path = "", body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Wallet sign-in failed.");
  return result as T;
}

/** Wallet-only sign-in when email authentication is not configured. */
export function usePhantomBackend(): AuthBackend {
  const [ready, setReady] = useState(false);
  const [signed, setSigned] = useState<WalletSession | null>(null);
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const raw = session.get(SESSION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as WalletSession;
        const verified = await request<{ address: string; expiresAt: number }>("GET", "", undefined, saved.token);
        if (active) setSigned({ ...verified, token: saved.token });
      } catch { session.remove(SESSION_KEY); }
      finally { if (active) setReady(true); }
    };
    void restore();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!signed) return;
    const expire = () => { session.remove(SESSION_KEY); setSigned(null); };
    const timer = setTimeout(expire, Math.max(0, signed.expiresAt - Date.now()));
    const provider = getPhantomProvider();
    const changed = (key?: { toString(): string } | null) => { if (!key || key.toString() !== signed.address) expire(); };
    provider?.on?.("accountChanged", changed);
    provider?.on?.("disconnect", expire);
    return () => { clearTimeout(timer); provider?.removeListener?.("accountChanged", changed); provider?.removeListener?.("disconnect", expire); };
  }, [signed]);
  const loginWithPhantom = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider?.signMessage) throw new Error("Open this page in a browser with Phantom installed.");
    const address = await connectPhantom(provider);
    const { nonce, message } = await request<{ nonce: string; message: string }>("GET", `?address=${encodeURIComponent(address)}`);
    const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
    const verified = await request<WalletSession>("POST", "", { address, nonce, signature: btoa(String.fromCharCode(...signature)) });
    session.set(SESSION_KEY, JSON.stringify(verified));
    setSigned(verified);
  }, []);
  const signOut = useCallback(async () => {
    if (signed) await request("DELETE", "", undefined, signed.token).catch(() => {});
    session.remove(SESSION_KEY);
    setSigned(null);
  }, [signed]);
  const user: AuthUser | null = signed ? { id: `wallet-${signed.address}`, address: signed.address, linkedAddress: signed.address, email: null, walletAuthToken: signed.token } : null;
  const emailUnavailable = async () => { throw new Error("Email sign-in is not configured. Continue with Phantom."); };
  return {
    kind: "phantom", ready, user, sendCode: emailUnavailable, verifyCode: emailUnavailable,
    loginWithPhantom, linkPhantom: loginWithPhantom, signOut,
    signTransaction: signed ? (wire) => signWithStandardWallet(signed.address, wire) : undefined,
  };
}
