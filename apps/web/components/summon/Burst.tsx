"use client";

import { useEffect, useRef } from "react";

interface Particle { x: number; y: number; vx: number; vy: number; size: number; life: number; color: string }

/** Canvas pixel-particle burst. Each new `fireKey` spawns one burst; the loop stops when it fades out. */
export function Burst({ fireKey, color, origin, className }: { fireKey: number; color: string; origin: { x: number; y: number }; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || fireKey === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const ox = origin.x * width;
    const oy = origin.y * height;
    const palette = [color, color, "#ffffff", "#ffd987"];
    const parts: Particle[] = Array.from({ length: 90 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 7;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, size: 3 + Math.floor(Math.random() * 4), life: 1, color: palette[Math.floor(Math.random() * palette.length)] };
    });
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 0.18;
        p.life -= 0.016;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, width, height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fireKey, color, origin.x, origin.y]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
