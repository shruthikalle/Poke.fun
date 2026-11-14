"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../../lib/useFocusTrap";
import styles from "./market.module.css";

export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={styles.modal} data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className={styles.modalHead}><strong>{title}</strong><button onClick={onClose} aria-label="Close">×</button></div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}
