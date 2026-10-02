import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  OFFER_PLACED_EVENT,
  OfferPlacedEvent,
} from '../../common/events/offer-placed.event';

/**
 * ROADMAP.md J13 — the real-time layer the auction (J12) needed: every
 * connected participant (seller + all active bidders) sees new offers as
 * they happen, and their countdown resets off the same server value
 * (`OfferPlacedEvent.closesAt`), never a client-computed guess.
 *
 * Deliberately narrow in scope, matching this project's own "cheap first"
 * precedent (G4c/G4d/G4e for the CV pipeline, J13's own row for this
 * feature): this gateway ONLY pushes "a new offer landed, here's the new
 * countdown" — it does NOT push the final "you won" resolution. That's
 * because OffersService.resolveIfExpired is lazy/read-triggered (J12's own
 * design: "nothing depends on the auction resolving faster than the next
 * time someone looks at it") — no server-side timer exists to push a
 * "resolved" event from. The client side (Buy.tsx, J14) renders the
 * countdown from `closesAt` and, once it visually reaches zero, makes one
 * REST call to GET /cards/:id/offers — which both triggers and returns the
 * real resolution. This keeps the auction's actual outcome coming from a
 * single source of truth (the lazy-resolution REST endpoint) instead of
 * two independent codepaths (a push AND a pull) that could disagree.
 *
 * No auth on the socket itself — joining a room only grants VISIBILITY
 * into a card's live offers, same public access level GET
 * /cards/:id/offers already has. Placing a bid still requires a real JWT,
 * but only through the existing guarded REST POST route — this gateway
 * never accepts a bid over the socket.
 *
 * CORS wide open (`origin: '*'`), same reasoning s3.tf's bucket CORS and
 * cards.controller.ts's public listing routes already use: the client is a
 * Capacitor WebView with no fixed origin, not a browser page on a known domain.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class OffersGateway {
  private readonly logger = new Logger(OffersGateway.name);

  @WebSocketServer()
  server!: Server;

  private static roomFor(cardId: string): string {
    return `card:${cardId}`;
  }

  @SubscribeMessage('join-auction')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cardId?: string },
  ): void {
    if (!payload?.cardId) return;
    void client.join(OffersGateway.roomFor(payload.cardId));
  }

  @SubscribeMessage('leave-auction')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cardId?: string },
  ): void {
    if (!payload?.cardId) return;
    void client.leave(OffersGateway.roomFor(payload.cardId));
  }

  @OnEvent(OFFER_PLACED_EVENT)
  handleOfferPlaced(event: OfferPlacedEvent): void {
    if (!this.server) {
      // Only possible in a test context that never bootstraps the
      // WS server — fail quiet, not crash a real offer placement over it.
      this.logger.warn('No WS server attached, dropping broadcast');
      return;
    }
    this.server.to(OffersGateway.roomFor(event.cardId)).emit('auction-update', {
      cardId: event.cardId,
      offer: event.offer,
      closesAt: event.closesAt,
    });
  }
}
