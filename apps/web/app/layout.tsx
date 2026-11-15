import type { Metadata } from "next";
import { DotGothic16, Pixelify_Sans, Silkscreen } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const pixel = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel", display: "swap" });
const silk = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-silk", display: "swap" });
const dot = DotGothic16({ subsets: ["latin"], weight: "400", variable: "--font-dot", display: "swap" });

export const metadata: Metadata = {
  title: "Poke.fun",
  description: "Collectible creature battles, one turn at a time",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${pixel.variable} ${silk.variable} ${dot.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
