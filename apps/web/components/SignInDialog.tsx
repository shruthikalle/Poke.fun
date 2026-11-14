"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "../lib/wallet/WalletProvider";
import { Emblem } from "./Emblem";
import { useFocusTrap } from "../lib/useFocusTrap";
import styles from "./SignInDialog.module.css";
import { PixelIcon } from "./PixelIcon";

const COPY = {
  idle: { title: "Sign in to Poke.fun", body: "Your cards, your rank, your battles." },
  connecting: { title: "Check the Phantom window", body: "Approve the sign-in request to continue. It only takes a second." },
  confirming: { title: "Confirm it's you", body: "Phantom will ask you to confirm. It's free and doesn't post anything." },
  "not-installed": { title: "Phantom isn't set up here", body: "Poke.fun uses the Phantom browser extension to keep your account safe. Add it, then come back and sign in." },
  rejected: { title: "Sign-in cancelled", body: "No problem, nothing was shared. You can try again whenever you're ready." },
  error: { title: "Couldn't sign you in", body: "Give it another go." },
} as const;

export function SignInDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn?: () => void }) {
  const { status, signIn, playAsGuest, reset } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open && !wasOpen.current) reset();
    wasOpen.current = open;
  }, [open, reset]);

  useEffect(() => {
    if (open && (status === "signed-in" || status === "guest") && wasOpen.current) {
      onSignedIn?.();
    }
  }, [open, status, onSignedIn]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const key = status === "signed-in" || status === "guest" ? "idle" : status;
  const copy = COPY[key];
  const busy = status === "connecting" || status === "confirming";

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="signin-title" tabIndex={-1} data-status={status}>
        <button className={styles.close} onClick={onClose} aria-label="Close" disabled={busy}><PixelIcon name="close" size={14} /></button>
        <div className={styles.icon} data-tone={key}>
          {key === "rejected" ? <PixelIcon name="alert" size={24} /> : key === "not-installed" ? <PixelIcon name="question" size={24} /> : key === "error" ? <PixelIcon name="close" size={22} /> : <Emblem size={56} />}
          {busy && <span className={styles.spinner} />}
        </div>
        <h2 id="signin-title" className={styles.title}>{copy.title}</h2>
        <p className={styles.body}>{copy.body}</p>

        {key === "not-installed" ? (
          <>
            <a className={`pf-btn ${styles.primary}`} data-variant="primary" href="https://phantom.com/download" target="_blank" rel="noreferrer">Get Phantom <PixelIcon name="external" size={10} /></a>
            <button className={`pf-btn ${styles.secondary}`} data-variant="ghost" onClick={signIn}>I've added it, try again</button>
          </>
        ) : (
          <button className={`pf-btn ${styles.primary}`} data-variant="primary" onClick={signIn} disabled={busy}>
            {busy ? "Waiting…" : key === "idle" ? "Continue with Phantom" : "Try again"}
          </button>
        )}
        <button className={styles.link} onClick={() => { playAsGuest(); }} disabled={busy}>Play as a guest instead</button>
        <p className={styles.fine}>We never ask for your recovery phrase.</p>
      </div>
    </div>
  );
}
