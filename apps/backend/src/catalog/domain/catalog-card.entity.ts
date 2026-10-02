/**
 * Domain shape for one catalog row — a real Scryfall printing, imported in
 * bulk by prisma/import-catalog.ts (F6 in ROADMAP.md). Read-only from the
 * app's point of view: nothing in this module ever writes to catalog_cards.
 */
export interface CatalogCardEntity {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  rarity: string | null;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colors: string[];
  oracleText: string | null;
  imageUrl: string | null;
  edhrecRank: number | null;

  // Added for ROADMAP.md E3b — client-side Stage 3 (priceFeatures.ts) needs
  // these to build its tabular vector for a catalog-identified card.
  setType: string | null;
  frame: string | null;
  borderColor: string | null;
  colorIdentity: string[];
  finishes: string[];
  frameEffects: string[];
  releasedAt: string | null;
}
