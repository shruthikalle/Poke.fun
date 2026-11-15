"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../lib/wallet/WalletProvider";
import { truncateAddress } from "../lib/wallet/phantom";
import { PixelAvatar } from "./PixelAvatar";

export interface AccountChipClasses { chip: string; avatar: string; menu: string; menuItem: string }

/** Avatar + short account id with a small menu. Styling comes from the host screen. */
export function AccountChip({ classes, extra }: { classes: AccountChipClasses; extra?: React.ReactNode }) {
  const { session, playerName, email, linkedAddress, linkPhantom, signOut } = useWallet();
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState<"idle" | "busy" | "failed">("idle");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!playerName) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={classes.chip} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={session ? "Signed in" : "Playing as guest"}>
        <PixelAvatar seed={session?.address ?? playerName} size={20} className={classes.avatar} />
        <span>{playerName}</span>
        {session && <small style={{ opacity: 0.6, fontSize: "0.85em" }}>{truncateAddress(session.address)}</small>}
      </button>
      {open && (
        <div className={classes.menu} role="menu">
          {email && <div className={classes.menuItem} style={{ opacity: 0.7, cursor: "default" }}>{email}</div>}
          {extra}
          {session && (linkedAddress ? (
            <div className={classes.menuItem} style={{ opacity: 0.7, cursor: "default" }}>Phantom linked · {truncateAddress(linkedAddress)}</div>
          ) : (
            <button className={classes.menuItem} role="menuitem" disabled={linking === "busy"} title="Already collect cards in Phantom? Link it to bring them here."
              onClick={() => { setLinking("busy"); linkPhantom().then(() => setLinking("idle"), () => setLinking("failed")); }}>
              {linking === "busy" ? "Linking…" : linking === "failed" ? "Couldn't link. Try again" : "Link Phantom"}
            </button>
          ))}
          <button className={classes.menuItem} role="menuitem" onClick={() => { setOpen(false); void signOut(); }}>
            {session ? "Sign out" : "Leave guest mode"}
          </button>
        </div>
      )}
    </div>
  );
}
