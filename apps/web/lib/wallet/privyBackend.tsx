"use client";

import { PrivyProvider, useLinkAccount, useLoginWithEmail, useLogout, usePrivy, type User } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connectPhantom, getPhantomProvider } from "./phantom";
import { session } from "../storage";
import type { AuthBackend, AuthUser } from "./types";

const DEVNET_HTTP = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DEVNET_WS = DEVNET_HTTP.replace(/^http/, "ws");
const WALLET_SESSION_KEY = "pf:devnet-wallet-session";

type SignedWalletSession = { address: string; token: string; expiresAt: number };

async function authRequest<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Wallet sign-in failed (${response.status})`);
  return result as T;
}

type Wallet = { type: string; chainType?: string; walletClientType?: string; address?: string };

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet") as Wallet[];
  const solana = wallets.filter((w) => w.chainType === "solana");
  const embedded = solana.find((w) => w.walletClientType === "privy");
  const external = solana.find((w) => w.walletClientType !== "privy");
  const email = user.email?.address ?? null;
  return { id: user.id, email, address: email ? embedded?.address ?? external?.address ?? null : external?.address ?? embedded?.address ?? null, linkedAddress: external?.address ?? null };
}

function usePrivyBackend(): AuthBackend {
  const { ready, authenticated, user } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { logout } = useLogout();
  const [walletSession, setWalletSession] = useState<SignedWalletSession | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  const linkWaiter = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  useEffect(() => {
    const raw = session.get(WALLET_SESSION_KEY);
    if (!raw) { setWalletReady(true); return; }
    let saved: SignedWalletSession;
    try { saved = JSON.parse(raw) as SignedWalletSession; } catch { session.remove(WALLET_SESSION_KEY); setWalletReady(true); return; }
    authRequest<{ address: string; expiresAt: number }>("GET", "", undefined, saved.token)
      .then((verified) => setWalletSession({ ...verified, token: saved.token }))
      .catch(() => session.remove(WALLET_SESSION_KEY))
      .finally(() => setWalletReady(true));
  }, []);
  const { linkWallet } = useLinkAccount({
    onSuccess: () => { linkWaiter.current?.resolve(); linkWaiter.current = null; },
    onError: (error) => { linkWaiter.current?.reject(new Error(String(error))); linkWaiter.current = null; },
  });

  const linkPhantom = useCallback(() => new Promise<void>((resolve, reject) => {
    linkWaiter.current = { resolve, reject };
    linkWallet({ walletChainType: "solana-only", walletList: ["phantom", "detected_solana_wallets"] });
  }), [linkWallet]);

  return {
    kind: "privy",
    ready: walletReady && ready,
    user: walletSession
      ? { id: `wallet-${walletSession.address}`, email: null, address: walletSession.address, linkedAddress: walletSession.address }
      : authenticated ? toAuthUser(user) : null,
    sendCode: (email) => sendCode({ email }),
    verifyCode: (code) => loginWithCode({ code }),
    loginWithPhantom: () => {
      const provider = getPhantomProvider();
      if (!provider?.signMessage) throw new Error("Phantom with message signing is required. Open this page in a browser with Phantom installed.");
      const signMessage = provider.signMessage.bind(provider);
      return (async () => {
        const address = await connectPhantom(provider);
        const { nonce, message } = await authRequest<{ nonce: string; message: string }>("GET", `?address=${encodeURIComponent(address)}`);
        const { signature: rawSignature } = await signMessage(new TextEncoder().encode(message), "utf8");
        const signature = btoa(String.fromCharCode(...rawSignature));
        const signed = await authRequest<SignedWalletSession>("POST", "", { address, nonce, signature });
        session.set(WALLET_SESSION_KEY, JSON.stringify(signed));
        setWalletSession(signed);
      })();
    },
    linkPhantom: walletSession ? async () => {} : linkPhantom,
    signOut: async () => {
      if (walletSession) {
        await authRequest("DELETE", "", undefined, walletSession.token).catch(() => {});
        session.remove(WALLET_SESSION_KEY);
        setWalletSession(null);
      } else await logout();
    },
  };
}

/** Privy-backed sign-in: Phantom or email, with a Solana devnet account created on sign-up. */
export function PrivyBridge({ appId, children }: { appId: string; children: (backend: AuthBackend) => ReactNode }) {
  const config = useMemo(() => ({
    loginMethods: ["wallet" as const, "email" as const],
    appearance: { theme: "light" as const, accentColor: "#5a7bb5" as `#${string}`, walletChainType: "solana-only" as const, walletList: ["phantom" as const, "detected_solana_wallets" as const], showWalletLoginFirst: true },
    embeddedWallets: { solana: { createOnLogin: "all-users" as const }, ethereum: { createOnLogin: "off" as const }, showWalletUIs: false },
    externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
    solana: {
      rpcs: {
        "solana:devnet": { rpc: createSolanaRpc(DEVNET_HTTP), rpcSubscriptions: createSolanaRpcSubscriptions(DEVNET_WS), blockExplorerUrl: "https://explorer.solana.com?cluster=devnet" },
      },
    },
  }), []);
  return (
    <PrivyProvider appId={appId} config={config}>
      <Inner>{children}</Inner>
    </PrivyProvider>
  );
}

function Inner({ children }: { children: (backend: AuthBackend) => ReactNode }) {
  return <>{children(usePrivyBackend())}</>;
}
