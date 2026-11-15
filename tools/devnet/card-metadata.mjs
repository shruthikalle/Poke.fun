import { createGenericFile } from "@metaplex-foundation/umi";
import sharp from "sharp";

export const cards = [
  { name: "Pikachu", number: "58/102", id: "base1-58", hue: "#f8ca58", icon: "P", ownerIndex: 0 },
  { name: "Charmander", number: "46/102", id: "base1-46", hue: "#fa9a62", icon: "C", ownerIndex: 1 },
  { name: "Blastoise", number: "2/102", id: "base1-2", image: "https://images.pokemontcg.io/base1/2.png", ownerIndex: 0 },
  { name: "Raichu", number: "14/102", id: "base1-14", image: "https://images.pokemontcg.io/base1/14.png", ownerIndex: 0 },
  { name: "Venusaur", number: "15/102", id: "base1-15", image: "https://images.pokemontcg.io/base1/15.png", ownerIndex: 1 },
  { name: "Gyarados", number: "6/102", id: "base1-6", image: "https://images.pokemontcg.io/base1/6.png", ownerIndex: 1 },
  { name: "Bulbasaur", number: "44/102", id: "base1-44", image: "https://images.pokemontcg.io/base1/44.png", ownerIndex: 0 },
  { name: "Charmander", number: "46/102", id: "base1-46", image: "https://images.pokemontcg.io/base1/46.png", ownerIndex: 0 },
  { name: "Squirtle", number: "63/102", id: "base1-63", image: "https://images.pokemontcg.io/base1/63.png", ownerIndex: 0 },
  { name: "Charizard", number: "4/102", id: "base1-4", image: "https://images.pokemontcg.io/base1/4.png", ownerIndex: 0 },
  { name: "Venusaur", number: "15/102", id: "base1-15", image: "https://images.pokemontcg.io/base1/15.png", ownerIndex: 0 },
];

function svg(label, icon, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="880" viewBox="0 0 640 880"><rect width="640" height="880" rx="36" fill="#142232"/><rect x="25" y="25" width="590" height="830" rx="25" fill="${color}"/><rect x="52" y="52" width="536" height="776" rx="18" fill="#152332"/><text x="320" y="126" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="38" font-weight="bold">POKE.FUN TEST CARD</text><circle cx="320" cy="388" r="180" fill="${color}"/><text x="320" y="460" text-anchor="middle" fill="#152332" font-family="sans-serif" font-size="210" font-weight="bold">${icon}</text><text x="320" y="665" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="48" font-weight="bold">${label}</text><text x="320" y="745" text-anchor="middle" fill="#ffdb8f" font-family="sans-serif" font-size="33">DEVNET ONLY · NOT VAULTED</text></svg>`;
}

export async function imageFile(label, icon, color, filename) {
  const png = await sharp(Buffer.from(svg(label, icon, color))).png().toBuffer();
  return createGenericFile(new Uint8Array(png), filename, {
    contentType: "image/png",
    tags: [{ name: "Content-Type", value: "image/png" }],
  });
}

export function collectionMetadata(image) {
  return {
    name: "Poke.fun Devnet Test Cards",
    symbol: "POKEFUN",
    description: "Fictional test assets for Poke.fun. No physical card or redemption rights.",
    image,
    category: "image",
    properties: { files: [{ uri: image, type: "image/png" }], category: "image" },
  };
}

export function cardMetadata(card, image) {
  return {
    name: `Poke.fun Devnet Test ${card.name}`,
    symbol: "POKEFUN",
    description: "Demo NFT only. This is not a vaulted collectible and has no physical redemption rights.",
    image,
    category: "image",
    properties: { files: [{ uri: image, type: "image/png" }], category: "image" },
    attributes: [
      { trait_type: "Category", value: "Pokemon" },
      { trait_type: "Card Name", value: card.name },
      { trait_type: "Set", value: "Base Set" },
      { trait_type: "Card Number", value: card.number },
      { trait_type: "Test Asset", value: "Devnet only; not vaulted" },
    ],
  };
}
