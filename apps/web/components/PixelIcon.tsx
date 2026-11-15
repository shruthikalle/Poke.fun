const SHAPES = {
  close: ["X.....X", ".X...X.", "..X.X..", "...X...", "..X.X..", ".X...X.", "X.....X"],
  alert: ["..XXX..", "..XXX..", "..XXX..", "..XXX..", ".......", "..XXX..", "..XXX.."],
  question: [".XXXXX.", "XX...XX", ".....XX", "...XXX.", "...XX..", ".......", "...XX.."],
  external: ["...XXXX", ".....XX", "....X.X", "...X..X", "X.X....", "X......", "XXXXX.."],
} as const;

export type PixelIconName = keyof typeof SHAPES;

/** Tiny hand-drawn 7×7 pixel glyph, rendered with crisp edges in the current text colour. */
export function PixelIcon({ name, size = 12 }: { name: PixelIconName; size?: number }) {
  const rows = SHAPES[name];
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  );
}
