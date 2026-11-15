"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cardImportService, type ImportAccount } from "../../lib/market/cardImport";
import { useCurrency } from "../../lib/market/currency";
import { estimateSol } from "../../lib/market/mockMarketplace";
import type { Card, ImportSource } from "../../lib/market/types";
import type { Marketplace } from "../../lib/market/useMarketplace";
import { useWallet } from "../../lib/wallet/WalletProvider";
import { Modal } from "./Modal";
import styles from "./market.module.css";

type Step =
  | { kind: "choose" }
  | { kind: "signin" }
  | { kind: "finding"; source: ImportSource; stage: number }
  | { kind: "select"; source: ImportSource; account: ImportAccount; cards: Card[] }
  | { kind: "adding"; source: ImportSource }
  | { kind: "done"; cards: Card[] };

const STAGES: Record<ImportSource, string[]> = {
  "collectors-crypt": ["Signing in to Collector's Crypt", "Finding your cards…", "Checking vault records…"],
  phantom: ["Opening Phantom", "Finding your cards…", "Checking vault records…"],
};
const SOURCE_NAME: Record<ImportSource, string> = { "collectors-crypt": "Collector's Crypt", phantom: "Phantom" };

/** "Add your cards": bring graded cards you already own on Collector's Crypt or in Phantom into Poke.fun. */
export function ImportCardsModal({ market, onClose, onImported }: { market: Marketplace; onClose: () => void; onImported: (count: number) => void }) {
  const { email, linkedAddress, linkPhantom } = useWallet();
  const { format } = useCurrency();
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [ccEmail, setCcEmail] = useState(email ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const run = async (source: ImportSource, credential: () => Promise<string>) => {
    setError(null);
    setStep({ kind: "finding", source, stage: 0 });
    try {
      const cred = await credential();
      const acct = await cardImportService.connect(source, cred);
      if (!live.current) return;
      if (!acct.ok) { setError(acct.error); setStep(source === "phantom" ? { kind: "choose" } : { kind: "signin" }); return; }
      setStep({ kind: "finding", source, stage: 1 });
      const found = cardImportService.findCards(acct.value);
      await new Promise((r) => setTimeout(r, 700));
      if (!live.current) return;
      setStep({ kind: "finding", source, stage: 2 });
      const r = await found;
      await new Promise((r) => setTimeout(r, 600));
      if (!live.current) return;
      if (!r.ok) { setError(r.error); setStep({ kind: "choose" }); return; }
      setPicked(new Set(r.value.map((c) => c.mint)));
      setStep({ kind: "select", source, account: acct.value, cards: r.value });
    } catch {
      if (!live.current) return;
      setError(source === "phantom" ? "Phantom didn't connect. Try again." : "Something went wrong. Try again.");
      setStep(source === "phantom" ? { kind: "choose" } : { kind: "signin" });
    }
  };

  const add = async (source: ImportSource, cards: Card[]) => {
    const chosen = cards.filter((c) => picked.has(c.mint));
    setStep({ kind: "adding", source });
    const r = await market.importCards(chosen, source);
    if (!live.current) return;
    if (!r.ok) { setError(r.error); setStep({ kind: "choose" }); return; }
    setStep({ kind: "done", cards: r.value });
    onImported(r.value.length);
  };

  const toggle = (mint: string) => setPicked((p) => { const n = new Set(p); if (n.has(mint)) n.delete(mint); else n.add(mint); return n; });

  return (
    <Modal title="Add your cards" onClose={onClose} wide={step.kind === "select" || step.kind === "done"}>
      {step.kind === "choose" && (
        <div className={styles.listForm}>
          <h3>Bring in cards you already own</h3>
          <p className={styles.mutedNote}>Already collect graded cards somewhere else? Add them here to battle with, sell or trade. They stay in the same insured vault.</p>
          {error && <p className={styles.notice} data-tone="bad" role="alert">{error}</p>}
          <div className={styles.sources}>
            <button className={`pf-frame ${styles.source}`} onClick={() => { setError(null); setStep({ kind: "signin" }); }}>
              <span className={styles.sourceIcon} aria-hidden="true">CC</span>
              <span><strong>Collector&apos;s Crypt account</strong><small>Sign in and pick the vaulted cards to bring over.</small></span>
              <span className="pf-eyebrow">Sign in ›</span>
            </button>
            <button className={`pf-frame ${styles.source}`} onClick={() => void run("phantom", async () => linkedAddress ?? (await linkPhantom(), "phantom"))}>
              <span className={styles.sourceIcon} data-src="phantom" aria-hidden="true">P</span>
              <span><strong>Phantom</strong><small>{linkedAddress ? "Already linked. We'll look for eligible cards." : "Link it once and we'll find your eligible cards."}</small></span>
              <span className="pf-eyebrow">{linkedAddress ? "Find cards ›" : "Link ›"}</span>
            </button>
          </div>
        </div>
      )}

      {step.kind === "signin" && (
        <form className={styles.listForm} onSubmit={(e) => { e.preventDefault(); void run("collectors-crypt", async () => ccEmail); }}>
          <h3>Sign in to Collector&apos;s Crypt</h3>
          <p className={styles.mutedNote}>Use the email on your Collector&apos;s Crypt account. We only read which graded cards you hold there.</p>
          <label className={styles.fieldLabel}>Email
            <input className="pf-input" type="email" value={ccEmail} autoFocus onChange={(e) => setCcEmail(e.target.value)} placeholder="you@example.com" aria-invalid={!!error || undefined} />
          </label>
          {error && <p className={styles.notice} data-tone="bad" role="alert">{error}</p>}
          <div className={styles.actionsRow}>
            <button className="pf-btn" data-variant="primary" type="submit" disabled={!ccEmail.trim()}>Continue</button>
            <button className="pf-btn" type="button" onClick={() => { setError(null); setStep({ kind: "choose" }); }}>Back</button>
          </div>
          <p className={styles.mutedNote}>Demo: any email works.</p>
        </form>
      )}

      {(step.kind === "finding" || step.kind === "adding") && (
        <div className={styles.progress} role="status" aria-live="polite">
          <div className={styles.dots} aria-hidden="true"><i /><i /><i /></div>
          <strong>{step.kind === "adding" ? "Adding to My Cards…" : STAGES[step.source][step.kind === "finding" ? step.stage : 2]}</strong>
          {step.kind === "finding" && (
            <ul className={styles.steps}>
              {STAGES[step.source].map((s, i) => <li key={s} data-state={i < step.stage ? "done" : i === step.stage ? "active" : undefined}>{s}</li>)}
            </ul>
          )}
        </div>
      )}

      {step.kind === "select" && (
        <div className={styles.listForm}>
          {step.cards.length ? (
            <>
              <h3>We found {step.cards.length} {step.cards.length === 1 ? "card" : "cards"} on {SOURCE_NAME[step.source]}</h3>
              <p className={styles.mutedNote}>All vault records check out. Choose which ones to add.</p>
              <div className={styles.found} role="group" aria-label="Cards to add">
                {step.cards.map((c) => (
                  <button key={c.mint} role="checkbox" aria-checked={picked.has(c.mint)} className={`pf-frame ${styles.foundCard}`} onClick={() => toggle(c.mint)}>
                    <i aria-hidden="true">{picked.has(c.mint) ? "✓" : ""}</i>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.imageUri} alt="" />
                    <b>{c.name}</b>
                    <small>{c.set} · {c.grade}</small>
                    <small>Worth ~{format(estimateSol(c))}</small>
                  </button>
                ))}
              </div>
              {error && <p className={styles.notice} data-tone="bad" role="alert">{error}</p>}
              <div className={styles.actionsRow}>
                <button className="pf-btn" data-variant="primary" disabled={!picked.size} onClick={() => void add(step.source, step.cards)}>Add {picked.size} {picked.size === 1 ? "card" : "cards"}</button>
                <button className="pf-btn" onClick={() => setStep({ kind: "choose" })}>Back</button>
              </div>
            </>
          ) : (
            <>
              <h3>No new cards found</h3>
              <p className={styles.mutedNote}>Everything on this account is already in My Cards.</p>
              <div className={styles.actionsRow}><button className="pf-btn" onClick={() => setStep({ kind: "choose" })}>Back</button></div>
            </>
          )}
        </div>
      )}

      {step.kind === "done" && (
        <div className={styles.listForm}>
          <h3>Added {step.cards.length} {step.cards.length === 1 ? "card" : "cards"}</h3>
          <p className={styles.notice} data-tone="good" role="status">They&apos;re in My Cards now, secured to physical storage. Battle with them, list them for sale or trade them.</p>
          <div className={styles.found}>
            {step.cards.map((c) => (
              <div key={c.mint} className={`pf-frame ${styles.foundCard}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUri} alt="" />
                <b>{c.name}</b>
                <small>{c.grade} · Imported</small>
              </div>
            ))}
          </div>
          <div className={styles.actionsRow}><button className="pf-btn" data-variant="primary" onClick={() => { onClose(); if (pathname !== "/collection") router.push("/collection"); }}>View My Cards</button></div>
        </div>
      )}
    </Modal>
  );
}
