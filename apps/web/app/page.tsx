"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccountChip } from "../components/AccountChip";
import { SignInDialog } from "../components/SignInDialog";
import { useWallet } from "../lib/wallet/WalletProvider";
import styles from "./landing.module.css";

const NAV = [
  { href: "#about", label: "About" },
  { href: "#battles", label: "Battles" },
  { href: "#leaderboard", label: "Leaderboard" },
];

const SOCIALS = [
  { href: "https://github.com/shruthikalle/Poke.fun", label: "GitHub" },
  { href: "https://discord.com", label: "Discord" },
  { href: "https://x.com", label: "X" },
];

const LIVE_BATTLES = [
  { a: "thar07", b: "mossy_mo", turn: 7, format: "Random Battle" },
  { a: "kiwi.k", b: "drillbit", turn: 3, format: "One-Card Arena" },
  { a: "pyrefly", b: "ottergirl", turn: 12, format: "Random Battle" },
];

const LEADERS = [
  { name: "pyrefly", rating: 1842, record: "128–41" },
  { name: "ottergirl", rating: 1797, record: "102–39" },
  { name: "thar07", rating: 1765, record: "88–35" },
  { name: "kiwi.k", rating: 1720, record: "140–77" },
  { name: "drillbit", rating: 1688, record: "64–30" },
];

const MOTES = Array.from({ length: 14 }, (_, i) => i);

export default function Landing() {
  const router = useRouter();
  const { playerName } = useWallet();
  const [signInOpen, setSignInOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setPaused(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const enter = () => (playerName ? router.push("/battle") : setSignInOpen(true));
  const close = useCallback(() => setSignInOpen(false), []);
  const onSignedIn = useCallback(() => {
    setSignInOpen(false);
    router.push("/battle");
  }, [router]);

  return (
    <div className={styles.page} data-paused={paused || undefined}>
      <section className={styles.hero}>
        <div className={styles.bg} aria-hidden="true" />
        <div className={styles.motes} aria-hidden="true">
          {MOTES.map((i) => <span key={i} style={{ "--i": i } as React.CSSProperties} />)}
        </div>
        <div className={styles.vignette} aria-hidden="true" />

        <header className={styles.top}>
          <Link href="/" className={styles.brand} aria-label="Poke.fun home">
            <span className={styles.mark}>pf.</span>
            <span className={styles.brandText}>
              <strong>Poke.fun</strong>
              <small>Creature card battles.</small>
            </span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
            <Link href="/battle">Play</Link>
            {playerName ? (
              <AccountChip classes={{ chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem }}
                extra={<Link className={styles.menuItem} href="/battle">Go to battle</Link>} />
            ) : (
              <button className={styles.signIn} onClick={() => setSignInOpen(true)}>Sign in ↗</button>
            )}
          </nav>
        </header>

        <button className={styles.enter} onClick={enter}>
          {playerName ? "Enter the arena" : "Sign in to battle"} <span className={styles.arrow}>↓</span>
        </button>

        <footer className={styles.bottomRight}>
          {SOCIALS.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noreferrer">{s.label} ↗</a>)}
          <button className={styles.pause} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "Play motion" : "Pause motion"}
          </button>
        </footer>
      </section>

      <main className={styles.below}>
        <section id="about" className={styles.section}>
          <h2>About</h2>
          <div className={styles.steps}>
            <article><span>01</span><h3>Pick your team</h3><p>Bring the creatures you collect, or start with a random squad of six.</p></article>
            <article><span>02</span><h3>Battle turn by turn</h3><p>Choose a move or a switch each turn. The server referees every hit, so nobody can cheat.</p></article>
            <article><span>03</span><h3>Climb the ladder</h3><p>Win to raise your rating. Friends can watch live and call the winner.</p></article>
          </div>
        </section>

        <section id="battles" className={styles.section}>
          <h2>Live battles</h2>
          <ul className={styles.live}>
            {LIVE_BATTLES.map((b) => (
              <li key={b.a}>
                <span className={styles.dot} />
                <strong>{b.a}</strong> vs. <strong>{b.b}</strong>
                <em>{b.format} · Turn {b.turn}</em>
                <Link href="/battle">Watch →</Link>
              </li>
            ))}
          </ul>
        </section>

        <section id="leaderboard" className={styles.section}>
          <h2>Leaderboard</h2>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Trainer</th><th>Rating</th><th>W–L</th></tr></thead>
            <tbody>
              {LEADERS.map((l, i) => <tr key={l.name}><td>{i + 1}</td><td>{l.name}</td><td>{l.rating}</td><td>{l.record}</td></tr>)}
            </tbody>
          </table>
        </section>

        <footer className={styles.footer}>
          <span>© Poke.fun · Original creatures and art. Not affiliated with any game publisher.</span>
          <Link href="/play">Classic one-card demo →</Link>
        </footer>
      </main>

      <SignInDialog open={signInOpen} onClose={close} onSignedIn={onSignedIn} />
    </div>
  );
}
