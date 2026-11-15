import { address, getBase58Decoder, getUtf8Encoder, type Address } from "@solana/kit";

interface PhantomPublicKey { toString(): string }

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  signMessage?(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
  on?(event: "accountChanged" | "disconnect" | "connect", handler: (arg?: PhantomPublicKey | null) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana ?? window.solana;
  return provider?.isPhantom ? provider : null;
}

/** Phantom rejects with code 4001 when the person closes or declines the prompt. */
export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; message?: string } | null;
  return e?.code === 4001 || /reject|cancel|denied|declined/i.test(e?.message ?? "");
}

export async function connectPhantom(provider: PhantomProvider, silent = false): Promise<Address> {
  const { publicKey } = await provider.connect(silent ? { onlyIfTrusted: true } : undefined);
  return address(publicKey.toString());
}

export async function signText(provider: PhantomProvider, text: string): Promise<string | null> {
  if (!provider.signMessage) return null;
  const bytes = new Uint8Array(getUtf8Encoder().encode(text));
  const { signature } = await provider.signMessage(bytes, "utf8");
  return getBase58Decoder().decode(signature);
}

export function truncateAddress(value: string, head = 4, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
