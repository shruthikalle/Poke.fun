"use client";

import type { ReactNode } from "react";
import { WalletProvider } from "../lib/wallet/WalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
