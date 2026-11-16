"use client";

import { useEffect, useMemo, useState } from "react";
import { arenaApi, type ArenaCard } from "../../../lib/arena";
import { collectionService, DEVNET_TEST_COLLECTION_ADDRESS, type DasAsset } from "../../../lib/cards/collection";
import { FAUX_ART_WINDOW, RENTAL_POOL, resolveCard, type CardPick } from "../../../lib/cards/mapping";
import { errorMessage, useLoadoutResource } from "./useLoadoutResource";

export interface CardRow {
  asset: DasAsset | null;
  pick: CardPick | null;
  label: string;
  image: string | null;
  grade: string | null;
  reason: string | null;
}

const RENTAL_SPECIES = [...new Set(["pikachu", "charmander", ...RENTAL_POOL.map((pick) => pick.species)])];
const loadCollection = (address: string) => collectionService.getOwnedCollectibles(address);

function ownedRow(asset: DasAsset): CardRow {
  const resolved = resolveCard(asset);
  if (resolved.eligible) return {
    asset, pick: { ...resolved.pick, rental: !(asset.interface === "MplCoreAsset" && asset.grouping?.some((group) => group.group_value === DEVNET_TEST_COLLECTION_ADDRESS)) }, label: resolved.pick.label,
    image: resolved.pick.image, grade: resolved.pick.grade, reason: null,
  };
  return {
    asset, pick: null,
    label: asset.content.metadata.attributes.find((trait) => trait.trait_type === "Card Name")?.value
      ?? asset.content.metadata.name,
    image: asset.content.links.image, grade: null, reason: resolved.reason,
  };
}

export function useLoadoutCards(address: string | null) {
  const collection = useLoadoutResource(address, loadCollection);
  const owned = useMemo(() => (collection.data ?? []).map(ownedRow), [collection.data]);
  const ids = useMemo(() => [...new Set([
    ...RENTAL_SPECIES, ...owned.flatMap((row) => row.pick ? [row.pick.species] : []),
  ])].sort().join(","), [owned]);
  const [attempt, setAttempt] = useState(0);
  const [fighters, setFighters] = useState<Map<string, ArenaCard | null>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailure(null);
    arenaApi.cardsByIds(ids.split(",")).then((cards) => {
      if (!active) return;
      const byId = new Map(cards.map((card) => [card.id, card]));
      setFighters(new Map(ids.split(",").map((id) => [id, byId.get(id) ?? null])));
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      setFailure(errorMessage(cause));
      setLoading(false);
    });
    return () => { active = false; };
  }, [ids, attempt]);

  const rentals = useMemo<CardRow[]>(() => RENTAL_SPECIES.flatMap((species) => {
    const fighter = fighters.get(species);
    if (!fighter || fighter.tier !== 1) return [];
    const pick: CardPick = {
      key: `arena-rental-${species}`, species, label: fighter.name,
      image: null, grade: null, level: fighter.level, tier: 1,
      rental: true, artWindow: FAUX_ART_WINDOW,
    };
    return [{ asset: null, pick, label: pick.label, image: null, grade: null, reason: null }];
  }), [fighters]);

  // Rentals stay explicit and never replace the signed-in player's identity.
  const rows = useMemo(() => [...owned, ...rentals], [owned, rentals]);
  const eligible = useMemo(() => rows.flatMap((row) => row.pick ? [row.pick] : []), [rows]);
  return {
    collection, rows, eligible, fighters, fighterError: failure, fightersLoading: loading,
    retryFighters: () => setAttempt((value) => value + 1),
    ownedCount: owned.filter((row) => row.pick && !row.pick.rental).length,
  };
}
