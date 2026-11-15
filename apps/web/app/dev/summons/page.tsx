import { notFound } from "next/navigation";
import { SummonGallery } from "./SummonGallery";

export const metadata = { title: "Summon gallery · Poke.fun dev" };

export default function Page() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_DEV_TOOLS !== "1") notFound();
  return <SummonGallery />;
}
