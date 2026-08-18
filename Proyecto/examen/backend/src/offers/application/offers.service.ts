import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { CardEntity } from '../../cards/domain/card.entity';
import { CardsService } from '../../cards/application/cards.service';
import {
  OFFER_REPOSITORY,
  type OfferRepository,
} from '../domain/offer.repository';

/**
 * Every new offer extends a card's auction by this much (ROADMAP.md J12,
 * the user's own "auction style" design: "after 5 seconds the last offer
 * gets the card"). Server-authoritative on purpose — a client-side-only
 * countdown would be trivially gameable (a bidder's own app could just
 * "forget" to report a competing offer that arrived).
 */
const AUCTION_WINDOW_MS = 5_000;

@Injectable()
export class OffersService {
  constructor(
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    private readonly cards: CardsService,
  ) {}

  /**
   * Places a bid and extends the auction window. Rejects: bidding on your
   * own card, bidding on a card whose auction already resolved and is
   * awaiting purchase (wonOfferId set — see Card.entity.ts), and any bid
   * that doesn't strictly exceed the current floor (the highest existing
   * offer, or the card's asking price if this is the first bid).
   *
   * NOT implemented, by deliberate choice (ROADMAP.md J12's own open
   * question, "flag it, don't silently assume either way"): a lone bidder
   * matching/exceeding the ask does NOT win instantly — every bid, first or
   * not, still waits out the full 5s window. A single-bidder fast path is a
   * reasonable, backward-compatible addition later, not something this
   * implementation silently assumed.
   */
  async placeOffer(cardId: string, bidderId: string, amount: number) {
    const card = await this.cards.findOne(cardId);
    if (card.ownerId === bidderId) {
      throw new BadRequestException('Cannot bid on your own card');
    }

    const resolvedCard = await this.resolveIfExpired(card);
    if (resolvedCard.wonOfferId) {
      throw new BadRequestException(
        'Auction already resolved — awaiting purchase completion',
      );
    }

    const latest = await this.offers.findLatestForCard(cardId);
    const floor = latest ? latest.amount : card.guessedPrice;
    const passesFloor = latest ? amount > floor : amount >= floor;
    if (!passesFloor) {
      throw new BadRequestException(
        `Offer must be at least ${floor} (current ${latest ? 'highest offer' : 'asking price'})`,
      );
    }

    const offer = await this.offers.create({ cardId, bidderId, amount });
    const closesAt = new Date(Date.now() + AUCTION_WINDOW_MS);
    await this.cards.setAuctionState(cardId, {
      closesAt,
      wonOfferId: null,
    });
    return { offer, closesAt };
  }

  /**
   * Lazy, read-triggered resolution (no cron job) — every call to
   * placeOffer/getAuctionState checks whether the window has passed and, if
   * so, locks the winner in before doing anything else. Safe to call
   * repeatedly: once wonOfferId is set, resolution is a no-op.
   */
  async getAuctionState(cardId: string) {
    const card = await this.cards.findOne(cardId);
    const resolved = await this.resolveIfExpired(card);
    const offers = await this.offers.findAllForCard(cardId);
    return {
      cardId,
      offers,
      currentOffer: offers[0] ?? null,
      closesAt: resolved.closesAt,
      wonOfferId: resolved.wonOfferId,
    };
  }

  private async resolveIfExpired(card: CardEntity): Promise<CardEntity> {
    if (!card.closesAt || card.wonOfferId) return card;
    if (Date.now() < card.closesAt.getTime()) return card;

    const latest = await this.offers.findLatestForCard(card.id);
    // Shouldn't happen — closesAt is only ever set alongside a real Offer
    // row — but stay safe rather than crash on a corrupt/edge state.
    if (!latest) return card;

    return this.cards.setAuctionState(card.id, {
      closesAt: null,
      wonOfferId: latest.id,
    });
  }
}
