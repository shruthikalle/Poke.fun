"use client";

import { PrivyProvider, useLinkAccount, useLoginWithEmail, useLogout, usePrivy, type User } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { AuthBackend, AuthUser } from "./types";

const DEVNET_HTTP = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DEVNET_WS = DEVNET_HTTP.replace(/^http/, "ws");

type Wallet = { type: string; chainType?: string; walletClientType?: string; address?: string };

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet") as Wallet[];
  const solana = wallets.filter((w) => w.chainType === "solana");
  const embedded = solana.find((w) => w.walletClientType === "privy");
  const external = solana.find((w) => w.walletClientType !== "privy");
  return { id: user.id, email: user.email?.address ?? null, address: embedded?.address ?? null, linkedAddress: external?.address ?? null };
}

function usePrivyBackend(): AuthBackend {
  const { ready, authenticated, user } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { logout } = useLogout();
  const linkWaiter = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
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
    ready,
    user: authenticated ? toAuthUser(user) : null,
    sendCode: (email) => sendCode({ email }),
    verifyCode: (code) => loginWithCode({ code }),
    linkPhantom,
    signOut: logout,
  };
}

/** Privy-backed sign-in: email + one-time code, with a Solana devnet account created silently on sign-up. */
export function PrivyBridge({ appId, children }: { appId: string; children: (backend: AuthBackend) => ReactNode }) {
  const config = useMemo(() => ({
    loginMethods: ["email" as const],
    appearance: { theme: "light" as const, accentColor: "#5a7bb5" as `#${string}`, walletChainType: "solana-only" as const, showWalletLoginFirst: false },
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
