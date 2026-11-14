import type { ReactNode } from "react";

/** Renders `**bold**` segments from engine log text. */
export function richText(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

export function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 75% 70%)`;
}

export const hpPercent = (hp: number, max: number) => (hp <= 0 ? 0 : Math.max(1, Math.round((hp / max) * 100)));

export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
