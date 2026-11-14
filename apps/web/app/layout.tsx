import type { Metadata } from "next";
import { Pixelify_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const pixel = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel", display: "swap" });

export const metadata: Metadata = {
  title: "Poke.fun",
  description: "Collectible creature battles, one turn at a time",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={pixel.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
