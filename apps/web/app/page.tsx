export default function Home() {
  return (
    <main>
      <p className="eyebrow">POKE.FUN · EARLY BUILD</p>
      <h1>One card. One opponent. Your move.</h1>
      <p>
        The first version is a one-card battle. Each player chooses an attack,
        and the server resolves the turn. Wallets and stakes come after the
        battle loop works.
      </p>
      <section aria-label="Development status">
        <h2>Building now</h2>
        <ol>
          <li>Card stats and attacks</li>
          <li>Two-player turn-based matches</li>
          <li>Battle screen</li>
        </ol>
      </section>
    </main>
  );
}
