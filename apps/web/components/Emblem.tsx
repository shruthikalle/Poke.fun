const SIZE = 15;
const C = 7;

/** Poke.fun crest: nested pixel diamonds with an ember gem. Original artwork. */
const PIXELS = (() => {
  const out: { x: number; y: number; tone: "edge" | "ring" | "gem" }[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.abs(x - C) + Math.abs(y - C);
      if (d === 7 || (d === 6 && (x === C || y === C || (x + y) % 2 === 0))) out.push({ x, y, tone: "edge" });
      else if (d === 4) out.push({ x, y, tone: "ring" });
      else if (d <= 1) out.push({ x, y, tone: "gem" });
    }
  }
  return out;
})();

export function Emblem({ size = 64, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox={`-1 -1 ${SIZE + 2} ${SIZE + 2}`} shapeRendering="crispEdges" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {PIXELS.map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1}
          fill={p.tone === "edge" ? "var(--emblem-edge, var(--text))" : p.tone === "ring" ? "var(--emblem-ring, var(--accent))" : "var(--emblem-gem, var(--accent-hi))"} />
      ))}
      <rect x={-1} y={C} width={2} height={1} fill="var(--emblem-edge, var(--text))" />
      <rect x={SIZE - 1} y={C} width={2} height={1} fill="var(--emblem-edge, var(--text))" />
    </svg>
  );
}
