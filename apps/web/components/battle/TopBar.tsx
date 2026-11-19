"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountChip } from "../AccountChip";
import { Emblem } from "../Emblem";
import { useWallet } from "../../lib/wallet/WalletProvider";
import type { ChatRoom } from "../../lib/lobby/useLobby";
import styles from "./battle.module.css";
import { PixelIcon } from "../PixelIcon";
import { CurrencyToggle } from "../market/CurrencyToggle";
import { SoundControl } from "../sound/SoundControl";

export type TabId = "battle" | string;

interface Props {
  title: string;
  subtitle: string;
  rooms: ChatRoom[];
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
  onCloseRoom: (id: string) => void;
  onNewBattle: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onSignIn: () => void;
}

export function TopBar({ title, subtitle, rooms, activeTab, onSelect, onCloseRoom, onNewBattle, muted, onToggleMute, onSignIn }: Props) {
  const { playerName } = useWallet();
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settings) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setSettings(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [settings]);

  return (
    <header className={styles.topbar}>
      <div className={styles.topLeft}>
      <Link href="/" className={styles.logo} aria-label="Poke.fun home">
        <Emblem size={22} /><span>Poke.fun</span>
      </Link>
      <nav className={styles.mainNav} aria-label="Main">
        <Link href="/market">Marketplace</Link>
        <Link href="/collection">My Cards</Link>
        <Link href="/loadout" aria-current="page">Battle</Link>
      </nav>
      <nav className={styles.tabs} aria-label="Open tabs">
        <div className={styles.tab} data-active={activeTab === "battle" || undefined} role="tab" aria-selected={activeTab === "battle"}>
          <button className={styles.tabMain} onClick={() => onSelect("battle")}>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </button>
          <Link href="/loadout" className={styles.tabClose} aria-label="Leave battle" title="Leave battle"><PixelIcon name="close" size={9} /></Link>
        </div>
        {rooms.map((r) => (
          <div key={r.id} className={styles.tab} data-active={activeTab === r.id || undefined} role="tab" aria-selected={activeTab === r.id}>
            <button className={styles.tabMain} onClick={() => onSelect(r.id)}>
              <strong>{r.name}</strong>
              <span>{r.users} users</span>
            </button>
            <button className={styles.tabClose} onClick={() => onCloseRoom(r.id)} aria-label={`Close ${r.name}`}><PixelIcon name="close" size={9} /></button>
          </div>
        ))}
      </nav>
      <button className={styles.plus} onClick={onNewBattle} title="Find a new battle" aria-label="New battle">+</button>
      </div>
      <div className={styles.topRight}>
      <div className={styles.userArea}>
        <CurrencyToggle />
        {playerName ? (
          <AccountChip classes={{ chip: styles.userChip, avatar: styles.userAvatar, menu: styles.menu, menuItem: styles.menuItem }} />
        ) : (
          <button className={styles.button} onClick={onSignIn}>Sign in</button>
        )}
        <SoundControl />
        <div ref={ref} style={{ position: "relative" }}>
          <button className={styles.iconButton} onClick={() => setSettings((s) => !s)} aria-label="Settings" aria-expanded={settings}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 1h2l.4 2 1.4.6 1.7-1.2 1.4 1.4-1.2 1.7.6 1.4 2 .4v2l-2 .4-.6 1.4 1.2 1.7-1.4 1.4-1.7-1.2-1.4.6L9 15H7l-.4-2-1.4-.6-1.7 1.2-1.4-1.4 1.2-1.7L2.7 9 1 9V7l2-.4.6-1.4-1.2-1.7 1.4-1.4 1.7 1.2L7 3zM8 5.5A2.5 2.5 0 108 10.5 2.5 2.5 0 008 5.5z" /></svg>
          </button>
          {settings && (
            <div className={styles.menu} role="menu">
              <button className={styles.menuItem} onClick={() => { onToggleMute(); setSettings(false); }}>{muted ? "Turn sound on" : "Turn sound off"}</button>
              <Link className={styles.menuItem} href="/loadout">Live 1v1 matchmaking</Link>
              <Link className={styles.menuItem} href="/history">Match history and replays</Link>
              <Link className={styles.menuItem} href="/">Back to home</Link>
            </div>
          )}
        </div>
      </div>
      </div>
    </header>
  );
}
