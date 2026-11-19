"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWallet } from "../lib/wallet/WalletProvider";
import { useFocusTrap } from "../lib/useFocusTrap";
import { Emblem } from "./Emblem";
import styles from "./SignInDialog.module.css";

type Step = "email" | "code";
type Mode = "sign-in" | "create";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendly(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/invalid|incorrect|code/i.test(text)) return "That code didn't work. Check it and try again.";
  if (/rate|too many/i.test(text)) return "Too many tries. Wait a minute and try again.";
  return "Something went wrong. Give it another go.";
}

/** Email + one-time code sign-in. Rendered once by WalletProvider; open it with `useWallet().signIn()`. */
export function SignInDialog({ open, initialMode, onClose, onSignedIn }: { open: boolean; initialMode: Mode; onClose: () => void; onSignedIn: () => void }) {
  const { auth, connected, playAsGuest, provider } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode); setStep("email"); setCode(""); setError(null); setBusy(false);
  }, [open, initialMode]);

  useEffect(() => { if (open && connected) onSignedIn(); }, [open, connected, onSignedIn]);
  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const run = async (task: () => Promise<void>, showWalletError = false) => {
    setBusy(true); setError(null);
    try { await task(); } catch (e) { setError(showWalletError && e instanceof Error ? e.message : friendly(e)); } finally { setBusy(false); }
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError("Enter a valid email address."); return; }
    void run(async () => { await auth.sendCode(email.trim()); setStep("code"); });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code from your email."); return; }
    void run(() => auth.verifyCode(code));
  };

  const creating = mode === "create";
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="signin-title" tabIndex={-1}>
        <button className={styles.close} onClick={onClose} disabled={busy} aria-label="Close">×</button>
        <div className={styles.icon}><Emblem size={48} /></div>

        {step === "email" ? (
          <form className={styles.form} onSubmit={submitEmail} noValidate>
            <h2 id="signin-title" className={styles.title}>{creating ? "Create your account" : "Sign in to Poke.fun"}</h2>
            <p className={styles.body}>{provider === "privy" ? "Connect your Solana wallet to play with your cards." : creating ? "Just your email. We'll send a code to confirm it's you." : "Your cards, your rank, your battles."}</p>
            {auth.loginWithPhantom && <button type="button" className={`pf-btn ${styles.primary}`} data-variant="primary" onClick={() => void run(async () => { await auth.loginWithPhantom?.(); }, true)} disabled={busy}>{busy ? "Signing in…" : "Continue with Phantom"}</button>}
            {provider === "privy" && <p className={styles.fine}>Phantom signs a Devnet login message. No transaction is sent.</p>}
            {auth.loginWithPhantom && <p className={styles.or}>or use email</p>}
            <label className={styles.field}>
              <span>Email</span>
              <input className="pf-input" type="email" autoComplete="email" placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} autoFocus disabled={busy} />
            </label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button className={`pf-btn ${auth.loginWithPhantom ? styles.secondary : styles.primary}`} data-variant={auth.loginWithPhantom ? "ghost" : "primary"} disabled={busy}>
              {busy ? "Sending code…" : creating ? "Create account" : "Continue"}
            </button>
            <button type="button" className={styles.link} onClick={() => { setMode(creating ? "sign-in" : "create"); setError(null); }} disabled={busy}>
              {creating ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
            <button type="button" className={styles.link} onClick={() => { playAsGuest(); onSignedIn(); }} disabled={busy}>
              Play as a guest instead
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={submitCode} noValidate>
            <h2 id="signin-title" className={styles.title}>Check your email</h2>
            <p className={styles.body}>We sent a 6-digit code to <b>{email.trim()}</b>.</p>
            <label className={styles.field}>
              <span>Code</span>
              <input ref={codeRef} className={`pf-input ${styles.code}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} />
            </label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button className={`pf-btn ${styles.primary}`} data-variant="primary" disabled={busy}>{busy ? "Signing in…" : creating ? "Create account" : "Sign in"}</button>
            <button type="button" className={styles.link} onClick={() => { setStep("email"); setCode(""); setError(null); }} disabled={busy}>Use a different email</button>
            <button type="button" className={styles.link} onClick={() => void run(() => auth.sendCode(email.trim()))} disabled={busy}>Send a new code</button>
          </form>
        )}

        <p className={styles.fine}>{provider === "mock" ? "Demo mode: any 6-digit code works." : "Phantom signs you in with your wallet. Email uses a one-time code."}</p>
      </div>
    </div>
  );
}
