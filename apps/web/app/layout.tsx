import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poke.fun",
  description: "One-card, turn-based collectible battles",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
