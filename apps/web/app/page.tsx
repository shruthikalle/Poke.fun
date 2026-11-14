"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { AccountChip } from "../components/AccountChip";
import { Emblem } from "../components/Emblem";
import { PixelAvatar } from "../components/PixelAvatar";
import { FORMAT_LABEL } from "../lib/cards/mapping";
import { useMotionPreference } from "../lib/motion";
import { speciesService } from "../lib/pokemon/SpeciesService";
import { tierFor } from "../lib/rank/RankService";
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

const SPRITE = (dex: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;

const LIVE_BATTLES = [
  { a: { trainer: "thar07", mon: "Gengar", dex: 94 }, b: { trainer: "mossy_mo", mon: "Kangaskhan", dex: 115 }, turn: 7, format: FORMAT_LABEL.champion },
  { a: { trainer: "kiwi.k", mon: "Pikachu", dex: 25 }, b: { trainer: "drillbit", mon: "Charizard", dex: 6 }, turn: 3, format: FORMAT_LABEL.squad },
  { a: { trainer: "pyrefly", mon: "Mewtwo", dex: 150 }, b: { trainer: "ottergirl", mon: "Blastoise", dex: 9 }, turn: 12, format: FORMAT_LABEL.champion },
];

const SCREEN_ROSTER = ["pikachu", "charizard", "gengar", "mewtwo", "eevee", "blastoise"];

const FLOODLIGHTS = [
  { x: 8.8, y: 8.6, tilt: 18 },
  { x: 22.8, y: 11.8, tilt: 9 },
  { x: 77.2, y: 11.8, tilt: -9 },
  { x: 91.2, y: 8.6, tilt: -18 },
];

const LEADERS = [
  { name: "pyrefly", rating: 1842, record: "128–41" },
  { name: "ottergirl", rating: 1797, record: "102–39" },
  { name: "thar07", rating: 1765, record: "88–35" },
  { name: "kiwi.k", rating: 1720, record: "140–77" },
  { name: "drillbit", rating: 1688, record: "64–30" },
];

const MOTES = Array.from({ length: 14 }, (_, i) => i);

/** Tiny camera-flash flicker over the stands, drawn at the art's pixel scale. */
function CrowdFlicker({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || paused) return;
    const colours = ["#ffffff", "#ffd987", "#9fbcff", "#f4c35a"];
    const flashes: { x: number; y: number; c: string; life: number }[] = [];
    let raf = 0, last = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || t - last < 110) return;
      last = t;
      for (let i = 0; i < 5; i++) flashes.push({ x: Math.random() * canvas.width | 0, y: Math.random() * canvas.height | 0, c: colours[Math.random() * 4 | 0], life: 2 + (Math.random() * 3 | 0) });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        ctx.globalAlpha = Math.min(1, f.life / 3);
        ctx.fillStyle = f.c;
        ctx.fillRect(f.x, f.y, 1, 1);
        if (--f.life <= 0) flashes.splice(i, 1);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [paused]);
  return <canvas ref={ref} className={styles.crowd} width={384} height={80} />;
}

/** Big screen above the field, cycling a few real battle sprites. */
function Jumbotron({ paused }: { paused: boolean }) {
  const [sprites, setSprites] = useState<{ name: string; src: string; still: string }[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    let alive = true;
    for (const key of SCREEN_ROSTER) {
      speciesService.getSpecies(key).then((sp) => {
        if (alive) setSprites((list) => [...list, { name: sp.name, src: sp.sprites.front, still: sp.sprites.frontStatic }]);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (paused || sprites.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % sprites.length), 3200);
    return () => clearInterval(t);
  }, [paused, sprites.length]);
  const now = sprites[i];
  return (
    <div className={styles.screen} aria-hidden="true">
      <div className={styles.screenInner}>
        {now ? <img key={now.src} src={paused ? now.still : now.src} alt="" className={styles.screenSprite} /> : <Emblem size={40} />}
        {now && <span className={styles.screenName}>{now.name}</span>}
      </div>
    </div>
  );
}

/** Layered pixel stadium; layers shift slightly with the pointer and scroll for depth. */
function Stadium({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  preload("/landing/stadium-back.webp", { as: "image", fetchPriority: "high" });
  preload("/landing/stadium-front.webp", { as: "image" });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    if (paused) { el.style.setProperty("--px", "0"); el.style.setProperty("--py", "0"); el.style.setProperty("--sy", "0"); return; }
    let raf = 0, px = 0, py = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty("--px", px.toFixed(3));
      el.style.setProperty("--py", py.toFixed(3));
      el.style.setProperty("--sy", String(Math.min(window.scrollY, window.innerHeight)));
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const onMove = (e: PointerEvent) => { px = e.clientX / window.innerWidth * 2 - 1; py = e.clientY / window.innerHeight * 2 - 1; queue(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", queue, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("scroll", queue); cancelAnimationFrame(raf); };
  }, [paused]);
  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <img className={styles.back} src="/landing/stadium-back.webp" alt="" width={1536} height={1024} fetchPriority="high" />
      <CrowdFlicker paused={paused} />
      {FLOODLIGHTS.map((f) => (
        <span key={f.x} className={styles.cone} style={{ left: `${f.x}%`, top: `${f.y}%`, "--tilt": `${f.tilt}deg` } as React.CSSProperties} />
      ))}
      <img className={styles.front} src="/landing/stadium-front.webp" alt="" width={1536} height={484} />
    </div>
  );
}

function Trophy() {
  return (
    <svg viewBox="0 0 9 9" width="36" height="36" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="var(--accent)" d="M1 0h7v1h1v2H8v1H7v1H6v1H5v1h1v1h1v1H2V8h1V7h1V6H3V5H2V4H1V3H0V1h1zm0 1v2h1V1zm6 0v2h1V1z" />
      <path fill="var(--accent-hi)" d="M3 1h1v3H3z" />
    </svg>
  );
}

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
  const { playerName, signIn } = useWallet();
  const motion = useMotionPreference();
  const paused = motion.reduced;

  const enter = () => (playerName ? router.push("/loadout") : signIn({ onSignedIn: () => router.push("/loadout") }));

  return (
    <div className={styles.page} data-paused={paused || undefined}>
      <section className={styles.hero}>
        <Stadium paused={paused} />
        <div className={styles.motes} aria-hidden="true">
          {MOTES.map((i) => <span key={i} style={{ "--i": i } as React.CSSProperties} />)}
        </div>
        <div className={styles.shade} aria-hidden="true" />
        <Jumbotron paused={paused} />

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
              <button className={styles.signIn} onClick={() => signIn()}>Sign in</button>
            )}
          </nav>
        </header>

        <div className={styles.center}>
          <Emblem size={112} className={styles.crest} title="Poke.fun crest" />
          <h1 className={styles.title}>Poke.fun</h1>
          <p className={styles.tagline}>Bring a card. Summon it. Win the pot.</p>
          <button className="pf-btn" data-variant="primary" data-size="lg" onClick={enter}>
            {playerName ? "Play" : "Sign in to play"}
          </button>
          <p className={styles.fine}>{playerName ? <>Playing as <strong>{playerName}</strong></> : null}</p>
        </div>

        <ul className={styles.rail} aria-label="Social links">
          {SOCIALS.map((s) => (
            <li key={s.label}><a href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label}><SocialIcon name={s.label} /></a></li>
          ))}
        </ul>

        <button className={styles.pause} onClick={() => motion.setPaused(!paused)} aria-pressed={paused}>
          <span className={styles.pauseIcon} data-paused={paused || undefined} aria-hidden="true" />
          {paused ? "Play motion" : "Pause motion"}
        </button>

        <a href="#about" className={styles.scroll}><span>Scroll</span><i aria-hidden="true" /></a>
      </section>

      <main className={styles.below}>
        <section id="about" className={styles.section}>
          <h2>How a match works</h2>
          <ol className={styles.steps}>
            <li>
              <div className={styles.art}><PixelAvatar seed="trainer" size={36} /><span className={styles.or}>or</span><img src={SPRITE(133)} alt="" width={56} height={56} /></div>
              <span>01</span><h3>Sign in</h3><p>Connect Phantom, or play free as a guest with rental Pokémon.</p>
            </li>
            <li>
              <div className={styles.art}><img className={styles.thumb} src="https://images.pokemontcg.io/base3/5.png" alt="" width={40} height={56} loading="lazy" /><i className={styles.arrow} /><img src={SPRITE(94)} alt="" width={56} height={56} /></div>
              <span>02</span><h3>Pick a card</h3><p>Choose a card from your collection and it summons into its Pokémon.</p>
            </li>
            <li>
              <div className={styles.art}><span className={styles.mini} /><span className={styles.or}>or</span><span className={styles.stack}><span className={styles.mini} /><span className={styles.mini} /><span className={styles.mini} /></span><b className={styles.coin}>$5</b></div>
              <span>03</span><h3>Set the match</h3><p>Champion 1v1 or Squad of 3. Entry from Free to $25, or custom. Demo money.</p>
            </li>
            <li>
              <div className={styles.art}><img src={SPRITE(94)} alt="" width={56} height={56} className={styles.flip} /><b className={styles.vs}>VS</b><img src={SPRITE(115)} alt="" width={56} height={56} /></div>
              <span>04</span><h3>Find a rival</h3><p>See their card and rank, then battle turn by turn.</p>
            </li>
            <li>
              <div className={styles.art}><Trophy /><b className={styles.coin}>+$10</b></div>
              <span>05</span><h3>Win the pot</h3><p>Take the entry and climb from Bronze to Master.</p>
            </li>
          </ol>
        </section>

        <section id="battles" className={styles.section}>
          <p className="pf-eyebrow">Happening now</p>
          <h2>Live battles</h2>
          <ul className={styles.live}>
            {LIVE_BATTLES.map((b) => (
              <li key={b.a.trainer}>
                <span className={styles.dot} />
                <img src={SPRITE(b.a.dex)} alt="" width={48} height={48} className={styles.flip} />
                <span className={styles.side}><strong>{b.a.mon}</strong><small>{b.a.trainer}</small></span>
                <b className={styles.vsSmall}>vs</b>
                <img src={SPRITE(b.b.dex)} alt="" width={48} height={48} />
                <span className={styles.side}><strong>{b.b.mon}</strong><small>{b.b.trainer}</small></span>
                <em>{b.format} · Turn {b.turn}</em>
                <Link href="/loadout">Play</Link>
              </li>
            ))}
          </ul>
        </section>

        <section id="leaderboard" className={styles.section}>
          <p className="pf-eyebrow">This season</p>
          <h2>Leaderboard</h2>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Trainer</th><th>Rank</th><th>Rating</th><th>W–L</th></tr></thead>
            <tbody>
              {LEADERS.map((l, i) => <tr key={l.name}><td>{i + 1}</td><td>{l.name}</td><td><span className={styles.tier} data-tier={tierFor(l.rating)}>{tierFor(l.rating)}</span></td><td>{l.rating}</td><td>{l.record}</td></tr>)}
            </tbody>
          </table>
        </section>

        <footer className={styles.footer}>
          <span>© Poke.fun · Creature data and sprites from PokéAPI. Pokémon is a trademark of Nintendo / The Pokémon Company; this demo is not affiliated with them.</span>
          <Link href="/play">Classic one-card demo →</Link>
        </footer>
      </main>

    </div>
  );
}
