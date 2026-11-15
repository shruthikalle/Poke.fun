import { CARD_CATALOG } from "../cards/mapping";
import { fakeAddress, GRADES, hash, makeCard, marketplaceService, rng } from "./mockMarketplace";
import type { Card, ImportSource, MarketResult } from "./types";

/** A signed-in outside account that holds vaulted cards. */
export interface ImportAccount { source: ImportSource; label: string; id: string }

/**
 * Brings cards people already own elsewhere into Poke.fun.
 * TODO(import): Collector's Crypt account API, and DAS `getAssetsByOwner` for a linked Phantom address.
 */
export interface CardImportService {
  connect(source: ImportSource, credential: string): Promise<MarketResult<ImportAccount>>;
  findCards(account: ImportAccount): Promise<MarketResult<Card[]>>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FAVORITES = new Set(["charizard", "blastoise", "venusaur", "pikachu", "gengar", "dragonite", "gyarados", "mewtwo", "mew", "snorlax", "lapras", "alakazam", "zapdos", "eevee"]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockCardImportService implements CardImportService {
  async connect(source: ImportSource, credential: string): Promise<MarketResult<ImportAccount>> {
    await wait(900);
    if (source === "collectors-crypt" && !EMAIL_RE.test(credential.trim())) return { ok: false, error: "Enter the email you use on Collector's Crypt." };
    if (source === "phantom" && !credential) return { ok: false, error: "Phantom didn't connect. Try again." };
    const label = credential.trim().toLowerCase();
    return { ok: true, value: { source, label, id: fakeAddress(`import:${source}:${label}`) } };
  }

  async findCards(account: ImportAccount): Promise<MarketResult<Card[]>> {
    await wait(1200);
    const r = rng(hash(account.id));
    const pool = CARD_CATALOG.entries.filter((e) => FAVORITES.has(e.species) && e.rarity && e.rarity !== "Common");
    const picked: Card[] = [];
    const used = new Set<string>();
    while (picked.length < 4 && used.size < pool.length) {
      const e = pool[Math.floor(r() * pool.length)];
      if (used.has(e.id)) continue;
      used.add(e.id);
      picked.push({ ...makeCard(e, GRADES[Math.floor(r() * 4)].grade, `${account.id}:${e.id}`), origin: "Collector's Crypt" });
    }
    const known = marketplaceService.snapshot().cards;
    return { ok: true, value: picked.filter((c) => !known[c.mint]) };
  }
}

export const cardImportService: CardImportService = new MockCardImportService();
