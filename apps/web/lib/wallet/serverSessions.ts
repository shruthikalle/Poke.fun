type WalletSession = { address: string; expiresAt: number };

const globalSessions = globalThis as typeof globalThis & { pokeFunWalletSessions?: Map<string, WalletSession> };
export const walletSessions = globalSessions.pokeFunWalletSessions ??= new Map<string, WalletSession>();

export function sessionAddress(token: string | null): string | null {
  if (!token) return null;
  const saved = walletSessions.get(token);
  if (!saved || saved.expiresAt <= Date.now()) {
    walletSessions.delete(token);
    return null;
  }
  return saved.address;
}
