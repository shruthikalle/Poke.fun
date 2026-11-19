"use client";

import type { SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { StandardConnectFeature } from "@wallet-standard/features";

/** Signs with an injected Wallet Standard wallet (e.g. Phantom) that controls `owner`. */
export async function signWithStandardWallet(owner: string, transaction: Uint8Array): Promise<Uint8Array> {
  const wallets = getWallets().get().filter((w) => "solana:signTransaction" in w.features);
  const wallet = wallets.find((w) => w.accounts.some((a) => a.address === owner)) ?? wallets.find((w) => w.name === "Phantom") ?? wallets[0];
  if (!wallet) throw new Error("Open this page in a browser with Phantom to sign.");
  let account = wallet.accounts.find((a) => a.address === owner);
  if (!account && "standard:connect" in wallet.features) {
    const connect = (wallet.features as StandardConnectFeature)["standard:connect"];
    account = (await connect.connect()).accounts.find((a) => a.address === owner);
  }
  if (!account) throw new Error(`Switch ${wallet.name} to the account you signed in with.`);
  const feature = (wallet.features as SolanaSignTransactionFeature)["solana:signTransaction"];
  const [signed] = await feature.signTransaction({ account, transaction, chain: "solana:devnet" });
  return signed.signedTransaction;
}
