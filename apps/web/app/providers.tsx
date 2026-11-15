"use client";

import type { ReactNode } from "react";
import { CurrencyProvider } from "../lib/market/currency";
import { WalletProvider } from "../lib/wallet/WalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <CurrencyProvider>{children}</CurrencyProvider>
    </WalletProvider>
  );
}
