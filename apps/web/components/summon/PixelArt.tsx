"use client";

import { useEffect, useRef, useState } from "react";

/** Shows `src` sharp, then re-renders it at each block resolution in `steps`. */
export function PixelArt({ src, size, steps, startDelay, stepMs, className }: { src: string; size: number; steps: number[]; startDelay: number; stepMs: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    setStep(-1);
    const timers = steps.map((_, i) => setTimeout(() => setStep(i), startDelay + i * stepMs));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startDelay, stepMs, steps.join(",")]);

  useEffect(() => {
    if (step < 0) return;
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const n = steps[step];
      const off = document.createElement("canvas");
      off.width = n;
      off.height = n;
      off.getContext("2d")?.drawImage(img, 0, 0, n, n);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, src]);

  return (
    <div className={className} style={{ width: size, height: size }}>
      {step < 0 ? <img src={src} alt="" width={size} height={size} draggable={false} /> : <canvas ref={ref} width={size} height={size} />}
    </div>
  );
}
