"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccountChip } from "../components/AccountChip";
import { Emblem } from "../components/Emblem";
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

const MOTES = Array.from({ length: 18 }, (_, i) => i);

function SocialIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    GitHub: "M5 1h6v1h2v2h1v6h-1v2h-2v1h-1v-3H9v-1h2V8h-1V6H6v2H5v1h2v1H6v3H5v-1H3v-2H2V4h1V2h2z",
    Discord: "M3 3h3v1h4V3h3v1h1v3h1v5h-2v1h-2v-1H5v1H3v-1H1V7h1V4h1zm2 5v2h2V8zm4 0v2h2V8z",
    X: "M2 2h3v1h1v1h1v1h1V4h1V3h1V2h3v1h-1v1h-1v1h-1v1H9v1h1v1h1v1h1v1h1v1h1v1h-3v-1h-1v-1H8v-1H7v1H6v1H5v1H2v-1h1v-1h1V9h1V8h1V7H5V6H4V5H3V4H2z",
  };
  return <svg viewBox="0 0 16 16" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true"><path fill="currentColor" d={paths[name]} /></svg>;
}

export default function Landing() {
  const router = useRouter();
  const { playerName } = useWallet();
  const [signInOpen, setSignInOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setPaused(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const enter = () => (playerName ? router.push("/loadout") : setSignInOpen(true));
  const close = useCallback(() => setSignInOpen(false), []);
  const onSignedIn = useCallback(() => {
    setSignInOpen(false);
    router.push("/loadout");
  }, [router]);

  return (
    <div className={styles.page} data-paused={paused || undefined}>
      <section className={styles.hero}>
        <div className={styles.bg} aria-hidden="true" />
        <div className={styles.mist} aria-hidden="true" />
        <div className={styles.motes} aria-hidden="true">
          {MOTES.map((i) => <span key={i} style={{ "--i": i } as React.CSSProperties} />)}
        </div>
        <div className={styles.shade} aria-hidden="true" />

        <header className={styles.top}>
          <Link href="/" className={styles.brand} aria-label="Poke.fun home">
            <Emblem size={26} />
            <span>Poke.fun</span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
            <Link href="/loadout">Play</Link>
            {playerName ? (
              <AccountChip classes={{ chip: styles.chip, avatar: styles.chipAvatar, menu: styles.menu, menuItem: styles.menuItem }}
                extra={<Link className={styles.menuItem} href="/loadout">Play a match</Link>} />
            ) : (
              <button className={styles.signIn} onClick={() => setSignInOpen(true)}>Sign in</button>
            )}
          </nav>
        </header>

        <div className={styles.center}>
          <Emblem size={112} className={styles.crest} title="Poke.fun crest" />
          <p className="pf-eyebrow">Turn-based creature battles</p>
          <h1 className={styles.title}>Poke.fun</h1>
          <p className={styles.tagline}>Collect creatures, pick your six and outthink your rival one turn at a time.</p>
          <button className="pf-btn" data-variant="primary" data-size="lg" onClick={enter}>
            {playerName ? "Enter the arena" : "Sign in to play"}
          </button>
          <p className={styles.fine}>{playerName ? <>Playing as <strong>{playerName}</strong></> : "Free to play · Nothing to download"}</p>
        </div>

        <ul className={styles.rail} aria-label="Social links">
          {SOCIALS.map((s) => (
            <li key={s.label}><a href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label}><SocialIcon name={s.label} /></a></li>
          ))}
        </ul>

        <button className={styles.pause} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          <span className={styles.pauseIcon} data-paused={paused || undefined} aria-hidden="true" />
          {paused ? "Play motion" : "Pause motion"}
        </button>

        <a href="#about" className={styles.scroll}><span>Scroll</span><i aria-hidden="true" /></a>
      </section>

      <main className={styles.below}>
        <section id="about" className={styles.section}>
          <p className="pf-eyebrow">How it works</p>
          <h2>About</h2>
          <div className={styles.steps}>
            <article><span>01</span><h3>Pick your team</h3><p>Bring the creatures you collect, or start with a random squad of six.</p></article>
            <article><span>02</span><h3>Battle turn by turn</h3><p>Choose a move or a switch each turn. The server referees every hit, so nobody can cheat.</p></article>
            <article><span>03</span><h3>Climb the ladder</h3><p>Win to raise your rating. Friends can watch live and call the winner.</p></article>
          </div>
        </section>

        <section id="battles" className={styles.section}>
          <p className="pf-eyebrow">Happening now</p>
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
          <p className="pf-eyebrow">This season</p>
          <h2>Leaderboard</h2>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Trainer</th><th>Rating</th><th>W–L</th></tr></thead>
            <tbody>
              {LEADERS.map((l, i) => <tr key={l.name}><td>{i + 1}</td><td>{l.name}</td><td>{l.rating}</td><td>{l.record}</td></tr>)}
            </tbody>
          </table>
        </section>

        <footer className={styles.footer}>
          <span>© Poke.fun · Creature data and sprites from PokéAPI. Pokémon is a trademark of Nintendo / The Pokémon Company; this demo is not affiliated with them.</span>
          <Link href="/play">Classic one-card demo →</Link>
        </footer>
      </main>

      <SignInDialog open={signInOpen} onClose={close} onSignedIn={onSignedIn} />
    </div>
  );
}
