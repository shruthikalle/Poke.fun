function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic 5×5 mirrored pixel avatar for an account or player name. */
export function PixelAvatar({ seed, size = 24, className }: { seed: string; size?: number; className?: string }) {
  const h = hash(seed);
  const hue = h % 360;
  const fg = `hsl(${hue} 65% 48%)`;
  const bg = `hsl(${(hue + 180) % 360} 45% 92%)`;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >> (y * 3 + x)) & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  return (
    <svg className={className} width={size} height={size} viewBox="-1 -1 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="-1" y="-1" width="7" height="7" fill={bg} />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fg} />)}
    </svg>
  );
}
