"use client";

import type { ReactNode } from "react";
import { AudioProvider } from "../lib/audio/AudioProvider";
import { CurrencyProvider } from "../lib/market/currency";
import { WalletProvider } from "../lib/wallet/WalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <CurrencyProvider>
        <AudioProvider>{children}</AudioProvider>
      </CurrencyProvider>
    </WalletProvider>
  );
}
