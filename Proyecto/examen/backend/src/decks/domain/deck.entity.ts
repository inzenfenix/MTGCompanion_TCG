/**
 * ROADMAP.md K — a named grouping of a user's own Vault cards (e.g. "Modern
 * deck", "Commander binder", "Bulk"). One deck per card (K1's resolved
 * design decision, see schema.prisma's own Card.deckId comment) — this
 * entity carries no card list/count; DecksService.findAllForOwner() reads
 * cards separately (via CardsService, deckId-filtered) rather than this
 * entity ever embedding them, same "don't duplicate what a real query
 * already answers" posture Offer/Transaction already follow.
 */
export interface DeckEntity {
  id: string;
  ownerId: string;
  name: string;
  createdAt: Date;
}
