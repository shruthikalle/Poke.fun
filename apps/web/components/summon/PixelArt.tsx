"use client";

import { useEffect, useRef, useState } from "react";

/** Shows `src` sharp, then re-renders it at each block resolution in `steps`. */
export function PixelArt({ src, size, steps, startDelay, stepMs, className, crop }: {
  src: string; size: number; steps: number[]; startDelay: number; stepMs: number; className?: string;
  /** Source rectangle as fractions of the image, e.g. a card's art window. */
  crop?: { x: number; y: number; w: number; h: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    setStep(-1);
    const timers = steps.map((_, i) => setTimeout(() => setStep(i), startDelay + i * stepMs));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startDelay, stepMs, steps.join(",")]);

  useEffect(() => {
    if (step < 0 && !crop) return;
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const n = step < 0 ? size : steps[step];
      const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
      const sw = img.naturalWidth * c.w;
      const sh = img.naturalHeight * c.h;
      const side = Math.min(sw, sh);
      const off = document.createElement("canvas");
      off.width = n;
      off.height = n;
      off.getContext("2d")?.drawImage(img, img.naturalWidth * c.x + (sw - side) / 2, img.naturalHeight * c.y + (sh - side) / 2, side, side, 0, 0, n, n);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, src, crop?.x, crop?.y, crop?.w, crop?.h]);

  return (
    <div className={className} style={{ width: size, height: size }}>
      {step < 0 && !crop ? <img src={src} alt="" width={size} height={size} draggable={false} /> : <canvas ref={ref} width={size} height={size} />}
    </div>
  );
}
