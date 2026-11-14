"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../lib/wallet/WalletProvider";
import { truncateAddress } from "../lib/wallet/phantom";
import { PixelAvatar } from "./PixelAvatar";

export interface AccountChipClasses { chip: string; avatar: string; menu: string; menuItem: string }

/** Avatar + short account id with a small menu. Styling comes from the host screen. */
export function AccountChip({ classes, extra }: { classes: AccountChipClasses; extra?: React.ReactNode }) {
  const { session, playerName, signOut } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!playerName) return null;
  const label = session ? truncateAddress(session.address) : playerName;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={classes.chip} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={session ? "Signed in" : "Playing as guest"}>
        <PixelAvatar seed={session?.address ?? playerName} size={20} className={classes.avatar} />
        <span>{label}</span>
      </button>
      {open && (
        <div className={classes.menu} role="menu">
          {extra}
          <button className={classes.menuItem} role="menuitem" onClick={() => { setOpen(false); void signOut(); }}>
            {session ? "Sign out" : "Leave guest mode"}
          </button>
        </div>
      )}
    </div>
  );
}
